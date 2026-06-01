const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, getVoiceConnection } = require('@discordjs/voice');
const { spawn } = require('child_process');
const path = require('path');

const COOKIES_FILE = path.join(__dirname, '..', 'cookies.txt');

// Per-guild music state
const musicStates = new Map();

function getState(guildId) {
  if (!musicStates.has(guildId)) {
    musicStates.set(guildId, {
      queue: [],
      player: null,
      connection: null,
      isPlaying: false,
    });
  }
  return musicStates.get(guildId);
}

async function getAudioStreamUrl(url) {
  return new Promise((resolve, reject) => {
    const args = [
      '--no-warnings',
      '--no-playlist',
      '-f', 'bestaudio/best',
      '-g', url
    ];
    if (require('fs').existsSync(COOKIES_FILE)) {
      args.push('--cookies', COOKIES_FILE);
    }

    const child = spawn('yt-dlp', args);
    let output = '';
    let errorOutput = '';

    child.stdout.on('data', (data) => output += data);
    child.stderr.on('data', (data) => errorOutput += data);

    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(errorOutput.trim() || 'yt-dlp failed to extract audio URL'));
      }
      const streamUrl = output.trim().split('\n').pop();
      if (!streamUrl) return reject(new Error('No audio stream URL found'));
      resolve(streamUrl);
    });

    child.on('error', reject);
  });
}

async function playNext(guildId, interaction) {
  const state = getState(guildId);
  if (state.queue.length === 0) {
    state.isPlaying = false;
    if (interaction) {
      await interaction.followUp({ content: 'Queue is empty. Playback stopped.' }).catch(() => {});
    }
    return;
  }

  const nextItem = state.queue.shift();
  const streamUrl = await getAudioStreamUrl(nextItem.url).catch(e => {
    console.error('[music] Failed to get stream:', e);
    return null;
  });

  if (!streamUrl) {
    if (interaction) await interaction.followUp({ content: `Failed to play: ${nextItem.title || nextItem.url}` }).catch(() => {});
    return playNext(guildId, interaction);
  }

  const resource = createAudioResource(streamUrl, {
    metadata: { title: nextItem.title || 'Unknown' }
  });

  state.player.play(resource);
  state.isPlaying = true;

  if (interaction) {
    await interaction.followUp({ content: `▶️ Now playing: **${nextItem.title || nextItem.url}**` }).catch(() => {});
  }
}

function setupPlayerEvents(guildId, player) {
  player.on(AudioPlayerStatus.Idle, () => {
    const state = getState(guildId);
    if (state.queue.length > 0) {
      // Continue queue
      playNext(guildId).catch(console.error);
    } else {
      state.isPlaying = false;
    }
  });

  player.on('error', (error) => {
    console.error('[music] Audio player error:', error);
    const state = getState(guildId);
    state.isPlaying = false;
    playNext(guildId).catch(console.error);
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
        setupPlayerEvents(guildId, player);

        await interaction.reply(`Joined **${channel.name}**`);
      } catch (e) {
        await interaction.reply({ content: `Failed to join: ${e.message}`, flags: MessageFlags.Ephemeral });
      }
      return;
    }

    if (sub === 'leave') {
      const connection = getVoiceConnection(guildId);
      if (connection) {
        connection.destroy();
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
            child.stdout.on('data', d => out += d);
            child.on('close', () => resolve(out.trim().split('\n')[0]));
            child.on('error', reject);
          });
          if (searchUrl) url = searchUrl;
        } catch (e) {
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
      if (state.player) {
        state.player.stop();
      }
      state.queue = [];
      state.isPlaying = false;
      await interaction.reply('Stopped and cleared the queue.');
      return;
    }

    if (sub === 'skip') {
      if (state.player && state.isPlaying) {
        state.player.stop();
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
