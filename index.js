require('dotenv').config();
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  Client,
  Events,
  GatewayIntentBits,
} = require('discord.js');
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  NoSubscriberBehavior,
  AudioPlayerStatus,
  getVoiceConnection,
} = require('@discordjs/voice');
const YouTube = require('youtube-sr').default;

// Per-guild state: { connection, player, queue, currentTrack, voiceChannelId }
const guildPlayers = new Map();
let nextQueueId = 1;

const ALBUMS_PATH = path.join(__dirname, 'albums.json');

function loadAlbums() {
  try {
    const data = fs.readFileSync(ALBUMS_PATH, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Failed to load albums.json:', err.message);
    return {};
  }
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function resolveSong(query) {
  if (typeof query === 'object' && query?.url) {
    return { title: query.title || 'YouTube video', url: query.url };
  }
  const trimmed = String(query).trim();
  const isYoutubeUrl = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/.test(trimmed);

  if (isYoutubeUrl) {
    try {
      const video = await YouTube.getVideo(trimmed);
      return { title: video?.title || 'YouTube video', url: trimmed };
    } catch {
      return { title: 'YouTube video', url: trimmed };
    }
  }
  const video = await YouTube.searchOne(trimmed);
  if (!video || !video.url) return null;
  return { title: video.title, url: video.url };
}

// Stream audio from YouTube using yt-dlp
function createYoutubeStream(url) {
  const ytdlp = spawn('yt-dlp', [
    '-f', 'bestaudio/best',
    '-o', '-',
    '--no-warnings',
    '--quiet',
    '--no-playlist',
    url,
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  ytdlp.stderr?.on('data', (data) => {
    const msg = data.toString().trim();
    if (msg && !msg.includes('WARNING')) console.error('yt-dlp:', msg);
  });

  ytdlp.on('error', () => {
    throw new Error('yt-dlp not found. Install it from https://github.com/yt-dlp/yt-dlp/releases and add to PATH.');
  });

  return ytdlp.stdout;
}

function getOrCreateGuildPlayer(guildId, voiceChannelId, adapterCreator) {
  let state = guildPlayers.get(guildId);
  if (!state) {
    const player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Play },
    });

    player.on('error', (error) => console.error('Audio player error:', error));

    player.on(AudioPlayerStatus.Idle, (oldState, newState) => {
      const guildState = guildPlayers.get(guildId);
      if (!guildState) return;
      if (oldState.status === AudioPlayerStatus.Playing && newState.status === AudioPlayerStatus.Idle) {
        guildState.currentTrack = null;
        playNextInQueue(guildId);
      }
    });

    const connection = joinVoiceChannel({
      channelId: voiceChannelId,
      guildId,
      adapterCreator,
    });
    connection.subscribe(player);

    state = {
      connection,
      player,
      queue: [],
      currentTrack: null,
      voiceChannelId,
      textChannel: null,
    };
    guildPlayers.set(guildId, state);
  } else if (state.voiceChannelId !== voiceChannelId) {
    state.voiceChannelId = voiceChannelId;
    state.connection.rejoin({ channelId: voiceChannelId });
  }
  return state;
}

function playNextInQueue(guildId) {
  const state = guildPlayers.get(guildId);
  if (!state || state.queue.length === 0) return;

  const track = state.queue.shift();
  state.currentTrack = track;

  try {
    const audioStream = createYoutubeStream(track.url);
    const resource = createAudioResource(audioStream, { metadata: { title: track.title } });
    state.player.play(resource);
    if (state.textChannel) {
      state.textChannel.send(`**Now playing:** ${track.title}`);
    }
  } catch (error) {
    console.error('Play error:', error);
    if (state.textChannel) state.textChannel.send(`Failed to play: ${error.message}`);
    playNextInQueue(guildId);
  }
}

function playTrack(guildId, voiceChannelId, adapterCreator, track, textChannel) {
  const state = getOrCreateGuildPlayer(guildId, voiceChannelId, adapterCreator);
  state.textChannel = textChannel;

  const startPlaying = (t) => {
    state.currentTrack = t;
    try {
      const audioStream = createYoutubeStream(t.url);
      const resource = createAudioResource(audioStream, { metadata: { title: t.title } });
      state.player.play(resource);
      textChannel.send(`**Now playing:** ${t.title}`);
    } catch (error) {
      console.error('Play error:', error);
      textChannel.send(`Failed to play: ${error.message}`);
      playNextInQueue(guildId);
    }
  };

  const isPlaying = state.player.state.status === AudioPlayerStatus.Playing ||
    state.player.state.status === AudioPlayerStatus.Buffering;

  if (isPlaying) {
    const id = nextQueueId++;
    state.queue.push({ id, title: track.title, url: track.url });
    textChannel.send(`**Added to queue** (#${id}): ${track.title}`);
  } else {
    startPlaying(track);
  }
}

function playTracks(guildId, voiceChannelId, adapterCreator, tracks, textChannel) {
  if (!tracks || tracks.length === 0) return;
  const state = getOrCreateGuildPlayer(guildId, voiceChannelId, adapterCreator);
  state.textChannel = textChannel;

  const isPlaying = state.player.state.status === AudioPlayerStatus.Playing ||
    state.player.state.status === AudioPlayerStatus.Buffering;

  if (isPlaying) {
    for (const t of tracks) {
      const id = nextQueueId++;
      state.queue.push({ id, title: t.title, url: t.url });
    }
    textChannel.send(`**Added album to queue:** ${tracks.length} songs`);
  } else {
    const [first, ...rest] = tracks;
    for (const t of rest) {
      const id = nextQueueId++;
      state.queue.push({ id, title: t.title, url: t.url });
    }
    playTrack(guildId, voiceChannelId, adapterCreator, first, textChannel);
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

client.once(Events.ClientReady, () => {
  console.log(`Moozic is online as ${client.user.tag}!`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  const content = message.content.trim();
  if (!content.startsWith('!')) return;

  const args = content.slice(1).split(/\s+/);
  const cmd = args[0].toLowerCase();
  const rest = args.slice(1).join(' ').trim();

  const voiceChannel = message.member?.voice?.channel;
  const guildId = message.guild.id;
  const state = guildPlayers.get(guildId);

  // Commands that don't require voice channel
  if (cmd === 'albums' || cmd === 'albumlist') {
    const albums = loadAlbums();
    const names = Object.keys(albums);
    if (names.length === 0) {
      return message.reply('No albums defined. Edit `albums.json` to add your custom albums.');
    }
    const list = names.map((n, i) => `${i + 1}. **${n}** (${albums[n].songs?.length || 0} songs)`).join('\n');
    return message.reply(`**Available albums:**\n${list}\n\nUse \`!album <name>\` to play an album.`);
  }

  if (cmd === 'queue' || cmd === 'q') {
    if (!state) {
      return message.reply('Nothing is playing. Use `!play <song>` to start.');
    }
    const lines = [];
    if (state.currentTrack) {
      lines.push(`**▶ Now playing:** ${state.currentTrack.title}`);
    } else {
      lines.push('*Nothing playing*');
    }
    if (state.queue.length > 0) {
      lines.push('');
      lines.push('**Queue:**');
      state.queue.forEach((t, i) => {
        lines.push(`  ${i + 1}. [#${t.id}] ${t.title}`);
      });
    } else if (!state.currentTrack) {
      lines.push('*Queue is empty*');
    }
    return message.reply(lines.join('\n') || 'Queue is empty.');
  }

  // Commands that require voice channel
  if (!voiceChannel) {
    return message.reply('You need to be in a voice channel for this command.');
  }

  if (cmd === 'play' || cmd === 'p') {
    if (!rest) {
      return message.reply('Please provide a YouTube URL or song name. Example: `!play Its my life - Bon Jovi`');
    }

    try {
      let videoUrl;
      let songTitle = rest;

      const isYoutubeUrl = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/.test(rest);

      if (isYoutubeUrl) {
        videoUrl = rest;
        try {
          const video = await YouTube.getVideo(videoUrl);
          if (video?.title) songTitle = video.title;
        } catch {
          songTitle = 'YouTube video';
        }
      } else {
        const video = await YouTube.searchOne(rest);
        if (!video || !video.url) {
          return message.reply('No results found for that search.');
        }
        videoUrl = video.url;
        songTitle = video.title || rest;
      }

      if (!videoUrl) {
        return message.reply('Could not get a valid video URL.');
      }

      playTrack(guildId, voiceChannel.id, message.guild.voiceAdapterCreator, { title: songTitle, url: videoUrl }, message.channel);
    } catch (error) {
      console.error('Play error:', error);
      message.reply(`Failed to play: ${error.message}`);
    }
    return;
  }

  if (cmd === 'album' || cmd === 'a') {
    if (!rest) {
      return message.reply('Usage: `!album <album name>`. Use `!albums` to see available albums.');
    }
    const albums = loadAlbums();
    const parts = rest.split(/\s+/);
    let shuffleOverride = null;
    if (parts.length > 1) {
      const last = parts[parts.length - 1].toLowerCase();
      if (last === 'shuffle') {
        shuffleOverride = true;
        parts.pop();
      } else if (last === 'order') {
        shuffleOverride = false;
        parts.pop();
      }
    }
    const albumName = parts.join(' ');
    const match = Object.keys(albums).find((k) => k.toLowerCase() === albumName.toLowerCase());
    if (!match) {
      return message.reply(`Album **${albumName}** not found. Use \`!albums\` to see available albums.`);
    }
    const album = albums[match];
    const songs = album.songs;
    if (!songs || songs.length === 0) {
      return message.reply(`Album **${match}** has no songs.`);
    }
    const shuffle = shuffleOverride !== null ? shuffleOverride : (album.shuffle === true);
    let trackList = songs.map((s) => (typeof s === 'string' ? s : (s && (s.url || s.title)) ? s : String(s)));
    if (shuffle) trackList = shuffleArray(trackList);

    const loadingMsg = await message.reply(`Loading **${match}** (${trackList.length} songs)...`);

    try {
      const resolved = [];
      for (const s of trackList) {
        const track = await resolveSong(s);
        if (track) resolved.push(track);
        else await message.channel.send(`Could not find: ${s}`).catch(() => {});
      }
      if (resolved.length === 0) {
        return loadingMsg.edit('No songs could be resolved from this album.');
      }
      await loadingMsg.delete().catch(() => {});
      playTracks(guildId, voiceChannel.id, message.guild.voiceAdapterCreator, resolved, message.channel);
      message.channel.send(`**Playing album:** ${match} (${resolved.length} songs)${shuffle ? ' · shuffled' : ''}`);
    } catch (error) {
      console.error('Album play error:', error);
      loadingMsg.edit(`Failed to play album: ${error.message}`).catch(() => {});
    }
    return;
  }

  if (cmd === 'remove' || cmd === 'rm' || cmd === 'delete') {
    if (!state) return message.reply('Nothing is playing.');
    const idOrNum = rest;
    if (!idOrNum) return message.reply('Usage: `!remove <number>` or `!remove #<id>` (e.g. `!remove 2` or `!remove #5`)');

    const parsed = idOrNum.replace(/^#/, '').trim();
    const asNum = parseInt(parsed, 10);

    let removeIdx = state.queue.findIndex((t) => t.id === asNum);
    if (removeIdx < 0 && !Number.isNaN(asNum) && asNum >= 1 && asNum <= state.queue.length) {
      removeIdx = asNum - 1;
    }
    if (removeIdx < 0) {
      return message.reply('Song not found in queue. Use `!queue` to see queue numbers and IDs.');
    }
    const removed = state.queue.splice(removeIdx, 1)[0];
    return message.reply(`Removed from queue: **${removed.title}**`);
  }

  if (cmd === 'pause') {
    if (!state) return message.reply('Nothing is playing.');
    if (state.player.state.status === AudioPlayerStatus.Paused) {
      state.player.unpause();
      return message.reply('Resumed playback.');
    }
    state.player.pause();
    return message.reply('Paused.');
  }

  if (cmd === 'stop') {
    if (!state) return message.reply('Nothing is playing.');
    state.player.stop();
    state.queue = [];
    state.currentTrack = null;
    return message.reply('Stopped and cleared queue.');
  }

  if (cmd === 'disconnect' || cmd === 'dc' || cmd === 'leave') {
    const conn = getVoiceConnection(guildId);
    if (conn) {
      conn.destroy();
      guildPlayers.delete(guildId);
      return message.reply('Disconnected.');
    }
    return message.reply('Bot is not in a voice channel.');
  }
});

const token = process.env.DISCORD_BOT_TOKEN;
if (!token) {
  console.error('Missing DISCORD_BOT_TOKEN in .env file.');
  process.exit(1);
}

client.login(token);
