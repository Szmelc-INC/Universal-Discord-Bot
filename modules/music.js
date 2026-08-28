const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  entersState,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  getVoiceConnection,
} = require('@discordjs/voice');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { customId, parseCustomId, reply, panel, updatePanel, notice, buttons } = require('../lib/interactions');

const MODULE = 'music';
const COOKIES_FILE = path.join(__dirname, '..', 'cookies.txt');

// How long to wait for the voice connection to actually become Ready (UDP/RTP up).
const READY_TIMEOUT_MS = 20_000;

// Per-guild music state
const musicStates = new Map();

function getState(guildId) {
  if (!musicStates.has(guildId)) {
    musicStates.set(guildId, {
      queue: [],
      player: null,
      connection: null,
      isPlaying: false,
      currentProcess: null, // the yt-dlp child currently feeding the audio resource
      currentTrack: null,
      panelMessage: null, // the persistent "now playing" control panel, edited in place
    });
  }
  return musicStates.get(guildId);
}

// One control panel per guild: buttons mutate the SAME message (Message#edit,
// not a token-bound editReply — the panel must outlive the 15-min interaction
// window since tracks can play for hours). See INTERACTIONS.md "long-lived panels".
function panelPayload(guildId) {
  const state = getState(guildId);
  const status = state.player?.state?.status;
  const lines = state.currentTrack
    ? [`${status === AudioPlayerStatus.Paused ? '⏸️' : '▶️'} **${state.currentTrack.title || state.currentTrack.url}**`]
    : ['⏹️ Nic nie jest odtwarzane.'];
  if (state.queue.length) lines.push(`📜 W kolejce: ${state.queue.length}`);

  const rows = buttons([
    { id: customId(MODULE, 'pause'), label: 'Pauza', style: 'secondary', emoji: '⏸️', disabled: status !== AudioPlayerStatus.Playing },
    { id: customId(MODULE, 'resume'), label: 'Wznów', style: 'secondary', emoji: '▶️', disabled: status !== AudioPlayerStatus.Paused },
    { id: customId(MODULE, 'skip'), label: 'Pomiń', style: 'primary', emoji: '⏭️', disabled: !state.isPlaying },
    { id: customId(MODULE, 'stop'), label: 'Stop', style: 'danger', emoji: '⏹️', disabled: !state.isPlaying && state.queue.length === 0 },
    { id: customId(MODULE, 'queue'), label: 'Kolejka', style: 'secondary', emoji: '📜' }
  ]);
  return { content: lines.join('\n'), components: rows };
}

async function syncPanel(guildId) {
  const state = getState(guildId);
  if (state.panelMessage) await state.panelMessage.edit(panelPayload(guildId)).catch(() => {});
}

function doPause(guildId) {
  const state = getState(guildId);
  if (state.player && state.player.state.status === AudioPlayerStatus.Playing) {
    state.player.pause();
    return { ok: true };
  }
  return { ok: false, reason: 'Nothing is playing.' };
}

function doResume(guildId) {
  const state = getState(guildId);
  if (state.player && state.player.state.status === AudioPlayerStatus.Paused) {
    state.player.unpause();
    return { ok: true };
  }
  return { ok: false, reason: 'Nothing is paused.' };
}

function doStop(guildId) {
  const state = getState(guildId);
  killStream(state);
  if (state.player) state.player.stop(true);
  state.queue = [];
  state.isPlaying = false;
  state.currentTrack = null;
  return { ok: true };
}

function doSkip(guildId) {
  const state = getState(guildId);
  if (state.player && state.isPlaying) {
    killStream(state);
    state.player.stop(true); // playNext is triggered by the resulting Idle event
    return { ok: true };
  }
  return { ok: false, reason: 'Nothing is playing.' };
}

// Kill the yt-dlp process that is currently streaming, if any.
// We own this process; the ffmpeg process lives *inside* the audio resource and is
// torn down by the resource itself. Killing yt-dlp explicitly on every teardown path
// avoids orphaning it (a yt-dlp blocked in a network read won't get SIGPIPE when the
// pipe closes, so relying on that alone leaks a process per skip/stop).
function killStream(state) {
  if (state && state.currentProcess) {
    try { state.currentProcess.kill('SIGKILL'); } catch {}
    state.currentProcess = null;
  }
}

// Spawn yt-dlp streaming the raw audio to stdout.
//
// IMPORTANT: we pipe yt-dlp's stdout straight into ffmpeg rather than resolving a
// direct googlevideo URL via `yt-dlp -g` and handing that URL to ffmpeg. The `-g`
// URLs are minted for a specific yt-dlp client (e.g. ANDROID_VR) and reject ffmpeg's
// plain HTTP GET, so ffmpeg reads 0 bytes and the track "plays" for 0 seconds (silent,
// no error). Letting yt-dlp do the fetching sidesteps all of that.
function spawnYtdlpStream(url) {
  const args = [
    '--no-warnings',
    '--no-playlist',
    '-f', 'bestaudio/best',
    '-o', '-', // stream to stdout
    url,
  ];
  if (fs.existsSync(COOKIES_FILE)) {
    args.push('--cookies', COOKIES_FILE);
  }
  return spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

async function playNext(guildId, interaction) {
  const state = getState(guildId);
  if (state.queue.length === 0) {
    state.isPlaying = false;
    state.currentTrack = null;
    if (interaction) await reply(interaction, panelPayload(guildId));
    else await syncPanel(guildId);
    return;
  }

  // Make sure the voice connection is actually Ready before we push audio into it.
  // Without this the player silently buffers forever: the bot "says" it is playing
  // but no packets ever leave (classic UDP-not-ready / NAT / Docker port issue).
  if (!state.connection) {
    console.error('[music] playNext called without a voice connection');
    if (interaction) await reply(interaction, 'Not connected to a voice channel. Use `/music join` first.');
    return;
  }
  if (state.connection.state.status !== VoiceConnectionStatus.Ready) {
    try {
      console.log(`[music] Waiting for voice connection to become Ready (current: ${state.connection.state.status})...`);
      await entersState(state.connection, VoiceConnectionStatus.Ready, READY_TIMEOUT_MS);
    } catch (e) {
      console.error('[music] Voice connection never reached Ready:', e.message);
      if (interaction) {
        await reply(interaction, '⚠️ Could not establish the voice connection (never reached **Ready**). '
          + 'This is usually a network/UDP issue — if the bot runs in Docker, make sure outbound UDP is not blocked.');
      }
      return;
    }
  }

  // Starting a fresh track: make sure no previous yt-dlp is left running.
  killStream(state);

  const nextItem = state.queue.shift();
  state.currentTrack = nextItem;

  const child = spawnYtdlpStream(nextItem.url);
  state.currentProcess = child;

  // Track whether any audio actually came out, and keep the tail of stderr for diagnostics.
  let gotData = false;
  let stderrTail = '';

  child.stdout.once('data', () => { gotData = true; });
  // A Readable that emits 'error' with no listener throws and crashes the process.
  child.stdout.on('error', e => console.error('[music] yt-dlp stdout error:', e.message));
  child.stderr.on('data', d => {
    stderrTail = (stderrTail + d.toString()).split('\n').slice(-4).join('\n');
  });
  child.on('error', e => {
    console.error('[music] yt-dlp spawn error:', e.message);
    if (interaction) reply(interaction, `⚠️ Could not start playback (is \`yt-dlp\` installed?): ${e.message}`).catch(() => {});
  });
  child.on('close', code => {
    if (state.currentProcess === child) state.currentProcess = null;
    // Non-zero exit with no audio produced = the same user-visible symptom as the old bug
    // (says "Now playing", then silence). Surface it explicitly instead of failing silently.
    if (code && code !== 0 && !gotData) {
      console.error(`[music] yt-dlp exited ${code} with no audio for "${nextItem.title || nextItem.url}": ${stderrTail.trim()}`);
      if (interaction) {
        reply(interaction, `⚠️ Could not play **${nextItem.title || nextItem.url}** — yt-dlp failed to fetch the audio `
          + '(the video may be private, age-restricted, region-locked, or removed).').catch(() => {});
      }
    }
  });

  const resource = createAudioResource(child.stdout, {
    metadata: { title: nextItem.title || 'Unknown' },
  });

  console.log(`[music] Starting playback: ${nextItem.title || nextItem.url}`);
  state.player.play(resource);
  state.isPlaying = true;

  // The control panel is the ONE message for this guild's player: created on
  // the first track (from the command interaction) and edited in place for
  // every subsequent track/state change, instead of a new message each time.
  if (interaction) {
    state.panelMessage = await panel(interaction, panelPayload(guildId)).catch(e => {
      console.error('[music] panel creation failed:', e.message);
      return state.panelMessage;
    });
  } else {
    await syncPanel(guildId);
  }
}

function setupPlayerEvents(guildId, player) {
  // Surface every player transition so a stalled/silent playback is diagnosable in logs.
  player.on('stateChange', (oldState, newState) => {
    if (oldState.status !== newState.status) {
      console.log(`[music] Player: ${oldState.status} -> ${newState.status}`);
    }
  });

  player.on(AudioPlayerStatus.Idle, () => {
    const state = getState(guildId);
    if (state.queue.length > 0) {
      // Continue queue
      playNext(guildId).catch(e => console.error('[music] playNext error:', e));
    } else {
      state.isPlaying = false;
    }
  });

  player.on('error', (error) => {
    console.error('[music] Audio player error:', error);
    const state = getState(guildId);
    killStream(state);
    state.isPlaying = false;
    playNext(guildId).catch(e => console.error('[music] playNext error:', e));
  });
}

function setupConnectionEvents(guildId, connection) {
  // Log connection lifecycle — the readiness of this (UDP/RTP) layer is what determines
  // whether audio is actually heard, independent of "the bot appears in the channel".
  connection.on('stateChange', (oldState, newState) => {
    if (oldState.status !== newState.status) {
      console.log(`[music] Voice connection: ${oldState.status} -> ${newState.status}`);
    }
  });

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    // Try a short reconnect; if it can't recover, tear the connection down cleanly.
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
      console.log('[music] Voice connection is reconnecting...');
    } catch {
      console.warn('[music] Voice connection lost and could not recover; destroying.');
      killStream(getState(guildId));
      try { connection.destroy(); } catch {}
      musicStates.delete(guildId);
    }
  });

  connection.on('error', (err) => {
    console.error('[music] Voice connection error:', err);
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('music')
    .setDescription('Voice music player (YouTube)')
    .addSubcommand(sc => sc.setName('join').setDescription('Join your voice channel'))
    .addSubcommand(sc =>
      sc.setName('play')
        .setDescription('Play a song (URL or search query)')
        .addStringOption(o => o.setName('query').setDescription('YouTube URL or search query').setRequired(true))
    )
    .addSubcommand(sc => sc.setName('pause').setDescription('Pause current playback'))
    .addSubcommand(sc => sc.setName('resume').setDescription('Resume playback'))
    .addSubcommand(sc => sc.setName('stop').setDescription('Stop playback and clear queue'))
    .addSubcommand(sc => sc.setName('skip').setDescription('Skip the current song'))
    .addSubcommand(sc => sc.setName('leave').setDescription('Leave the voice channel'))
    .addSubcommand(sc => sc.setName('queue').setDescription('Show the current queue')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const state = getState(guildId);

    if (sub === 'join') {
      if (!interaction.member.voice.channel) {
        return interaction.reply({ content: 'You need to be in a voice channel first!', flags: MessageFlags.Ephemeral });
      }

      const channel = interaction.member.voice.channel;

      await interaction.deferReply();

      try {
        const connection = joinVoiceChannel({
          channelId: channel.id,
          guildId: guildId,
          adapterCreator: interaction.guild.voiceAdapterCreator,
        });

        const player = createAudioPlayer();
        connection.subscribe(player);

        state.connection = connection;
        state.player = player;
        setupConnectionEvents(guildId, connection);
        setupPlayerEvents(guildId, player);

        // Wait until the voice connection is actually usable (UDP handshake done),
        // instead of reporting success the moment the gateway state updates.
        try {
          await entersState(connection, VoiceConnectionStatus.Ready, READY_TIMEOUT_MS);
        } catch (e) {
          console.error('[music] Voice connection did not become Ready after join:', e.message);
          try { connection.destroy(); } catch {}
          musicStates.delete(guildId);
          return interaction.editReply({
            content: `⚠️ Joined **${channel.name}** on the gateway, but the voice connection never became **Ready** `
              + `(${e.message}). Audio will not play. This is almost always a network/UDP problem — check firewall/NAT, `
              + `and if running in Docker make sure outbound UDP is allowed.`,
          });
        }

        console.log(`[music] Voice connection Ready in "${channel.name}" (${guildId})`);
        await interaction.editReply(`Joined **${channel.name}** ✅`);
      } catch (e) {
        console.error('[music] Failed to join voice channel:', e);
        await interaction.editReply({ content: `Failed to join: ${e.message}` });
      }
      return;
    }

    if (sub === 'leave') {
      const connection = getVoiceConnection(guildId) || state.connection;
      if (connection) {
        killStream(state);
        try { connection.destroy(); } catch {}
        if (state.panelMessage) await state.panelMessage.edit({ content: '👋 Bot opuścił kanał głosowy.', components: [] }).catch(() => {});
        musicStates.delete(guildId);
        await interaction.reply('Left the voice channel.');
      } else {
        await interaction.reply({ content: 'Not connected to a voice channel.', flags: MessageFlags.Ephemeral });
      }
      return;
    }

    if (sub === 'play') {
      if (!state.connection || state.connection.state.status === VoiceConnectionStatus.Destroyed) {
        return interaction.reply({ content: 'Use `/music join` first!', flags: MessageFlags.Ephemeral });
      }

      const query = interaction.options.getString('query');
      await interaction.deferReply();

      let url = query;
      let title = query;

      // If it doesn't look like a URL, treat as search
      if (!query.startsWith('http')) {
        // Use yt-dlp search
        try {
          const searchUrl = await new Promise((resolve, reject) => {
            const args = [`ytsearch1:${query}`, '--print', '%(webpage_url)s', '--no-warnings'];
            const child = spawn('yt-dlp', args);
            let out = '';
            let err = '';
            child.stdout.on('data', d => out += d);
            child.stderr.on('data', d => err += d);
            child.on('close', (code) => {
              if (code !== 0) return reject(new Error(err.trim() || 'yt-dlp search failed'));
              resolve(out.trim().split('\n')[0]);
            });
            child.on('error', reject);
          });
          if (searchUrl) url = searchUrl;
        } catch (e) {
          console.error('[music] Search failed:', e.message);
          return interaction.editReply('Search failed. Try pasting a direct YouTube URL.');
        }
      }

      // Add to queue
      state.queue.push({ url, title });

      if (!state.isPlaying) {
        await playNext(guildId, interaction);
      } else {
        await interaction.editReply(`Added to queue: **${title}**`);
      }
      return;
    }

    if (sub === 'pause') {
      const r = doPause(guildId);
      await interaction.reply({ content: r.ok ? 'Paused.' : r.reason, flags: r.ok ? undefined : MessageFlags.Ephemeral });
      if (r.ok) await syncPanel(guildId);
      return;
    }

    if (sub === 'resume') {
      const r = doResume(guildId);
      await interaction.reply({ content: r.ok ? 'Resumed.' : r.reason, flags: r.ok ? undefined : MessageFlags.Ephemeral });
      if (r.ok) await syncPanel(guildId);
      return;
    }

    if (sub === 'stop') {
      doStop(guildId);
      await interaction.reply('Stopped and cleared the queue.');
      await syncPanel(guildId);
      return;
    }

    if (sub === 'skip') {
      const r = doSkip(guildId);
      await interaction.reply({ content: r.ok ? 'Skipped current track.' : r.reason, flags: r.ok ? undefined : MessageFlags.Ephemeral });
      // playNext (triggered by the resulting Idle event) syncs the panel once the next track starts.
      return;
    }

    if (sub === 'queue') {
      await interaction.reply({ content: queueListText(state), flags: MessageFlags.Ephemeral });
      return;
    }
  },

  // Central component router (main.js) dispatches here for any customId
  // prefixed "music:" — see lib/interactions.js and INTERACTIONS.md.
  async handleComponent(interaction) {
    const { action } = parseCustomId(interaction.customId);
    const guildId = interaction.guildId;
    const state = getState(guildId);

    if (action === 'queue') {
      await notice(interaction, queueListText(state));
      return;
    }

    const handlers = { pause: doPause, resume: doResume, stop: doStop, skip: doSkip };
    const handler = handlers[action];
    if (!handler) return;

    const r = handler(guildId);
    if (!r.ok) {
      await notice(interaction, r.reason);
      return;
    }
    // Button click IS the panel update — acknowledges the interaction and
    // mutates the same message in one step (interaction.update() under the hood).
    await updatePanel(interaction, panelPayload(guildId));
  }
};

function queueListText(state) {
  if (state.queue.length === 0) return 'The queue is empty.';
  const list = state.queue.slice(0, 10).map((item, i) => `${i + 1}. ${item.title || item.url}`).join('\n');
  return `**Current Queue:**\n${list}${state.queue.length > 10 ? `\n...and ${state.queue.length - 10} more` : ''}`;
}
