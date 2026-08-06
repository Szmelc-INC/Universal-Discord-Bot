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
    });
  }
  return musicStates.get(guildId);
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
    if (interaction) {
      await interaction.followUp({ content: 'Queue is empty. Playback stopped.' })
        .catch(e => console.error('[music] followUp failed:', e.message));
    }
    return;
  }

  // Make sure the voice connection is actually Ready before we push audio into it.
  // Without this the player silently buffers forever: the bot "says" it is playing
  // but no packets ever leave (classic UDP-not-ready / NAT / Docker port issue).
  if (!state.connection) {
    console.error('[music] playNext called without a voice connection');
    if (interaction) await interaction.followUp({ content: 'Not connected to a voice channel. Use `/music join` first.' }).catch(() => {});
    return;
  }
  if (state.connection.state.status !== VoiceConnectionStatus.Ready) {
    try {
      console.log(`[music] Waiting for voice connection to become Ready (current: ${state.connection.state.status})...`);
      await entersState(state.connection, VoiceConnectionStatus.Ready, READY_TIMEOUT_MS);
    } catch (e) {
      console.error('[music] Voice connection never reached Ready:', e.message);
      if (interaction) {
        await interaction.followUp({
          content: '⚠️ Could not establish the voice connection (never reached **Ready**). '
            + 'This is usually a network/UDP issue — if the bot runs in Docker, make sure outbound UDP is not blocked.',
        }).catch(() => {});
      }
      return;
    }
  }

  // Starting a fresh track: make sure no previous yt-dlp is left running.
  killStream(state);

  const nextItem = state.queue.shift();

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
    if (interaction) {
      interaction.followUp({ content: `⚠️ Could not start playback (is \`yt-dlp\` installed?): ${e.message}` }).catch(() => {});
    }
  });
  child.on('close', code => {
    if (state.currentProcess === child) state.currentProcess = null;
    // Non-zero exit with no audio produced = the same user-visible symptom as the old bug
    // (says "Now playing", then silence). Surface it explicitly instead of failing silently.
    if (code && code !== 0 && !gotData) {
      console.error(`[music] yt-dlp exited ${code} with no audio for "${nextItem.title || nextItem.url}": ${stderrTail.trim()}`);
      if (interaction) {
        interaction.followUp({
          content: `⚠️ Could not play **${nextItem.title || nextItem.url}** — yt-dlp failed to fetch the audio `
            + '(the video may be private, age-restricted, region-locked, or removed).',
        }).catch(() => {});
      }
    }
  });

  const resource = createAudioResource(child.stdout, {
    metadata: { title: nextItem.title || 'Unknown' },
  });

  console.log(`[music] Starting playback: ${nextItem.title || nextItem.url}`);
  state.player.play(resource);
  state.isPlaying = true;

  if (interaction) {
    await interaction.followUp({ content: `▶️ Now playing: **${nextItem.title || nextItem.url}**` })
      .catch(e => console.error('[music] followUp failed:', e.message));
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
      if (state.player && state.player.state.status === AudioPlayerStatus.Playing) {
        state.player.pause();
        await interaction.reply('Paused.');
      } else {
        await interaction.reply({ content: 'Nothing is playing.', flags: MessageFlags.Ephemeral });
      }
      return;
    }

    if (sub === 'resume') {
      if (state.player && state.player.state.status === AudioPlayerStatus.Paused) {
        state.player.unpause();
        await interaction.reply('Resumed.');
      } else {
        await interaction.reply({ content: 'Nothing is paused.', flags: MessageFlags.Ephemeral });
      }
      return;
    }

    if (sub === 'stop') {
      killStream(state);
      if (state.player) {
        state.player.stop(true);
      }
      state.queue = [];
      state.isPlaying = false;
      await interaction.reply('Stopped and cleared the queue.');
      return;
    }

    if (sub === 'skip') {
      if (state.player && state.isPlaying) {
        killStream(state);
        state.player.stop(true);
        await interaction.reply('Skipped current track.');
        // playNext will be triggered by the Idle event
      } else {
        await interaction.reply({ content: 'Nothing is playing.', flags: MessageFlags.Ephemeral });
      }
      return;
    }

    if (sub === 'queue') {
      if (state.queue.length === 0) {
        await interaction.reply('The queue is empty.');
      } else {
        const list = state.queue.slice(0, 10).map((item, i) => `${i + 1}. ${item.title || item.url}`).join('\n');
        await interaction.reply(`**Current Queue:**\n${list}${state.queue.length > 10 ? `\n...and ${state.queue.length - 10} more` : ''}`);
      }
      return;
    }
  }
};
