# Moozic - Discord Music Bot

A Discord bot that plays music from YouTube. Supports both direct URLs and search by song name.

## Features

- **Play by URL**: `!play https://www.youtube.com/watch?v=...`
- **Play by search**: `!play Its my life - Bon Jovi`
- **Queue** - Songs automatically queue when one is playing
- **Queue view** - `!queue` to see current track and queue
- **Remove from queue** - `!remove 2` or `!remove #5` (number or ID)
- **Pause/Resume** - `!pause` toggles playback
- **Stop** - `!stop` stops playback and clears queue
- **Disconnect** - `!disconnect` makes the bot leave the voice channel
- **Custom albums** - Define albums in `albums.json`, play with `!album <name>`

## Custom Albums

Edit `albums.json` to add your own albums. Each album has:
- `shuffle`: `true` or `false` – shuffle order when playing
- `songs`: array of song names (searched on YouTube) or YouTube URLs

```json
{
  "My Album": {
    "shuffle": true,
    "songs": [
      "Artist - Song Name",
      "https://www.youtube.com/watch?v=xxxxx"
    ]
  }
}
```

- `!albums` – list all albums
- `!album <name>` – play album (uses shuffle from JSON)
- `!album <name> shuffle` – force shuffle
- `!album <name> order` – play in order (no shuffle)

## Setup

### 1. Prerequisites

Install these **before** running the bot (all must be in your system PATH):

#### FFmpeg (required for audio conversion)
- **Windows:** 
  1. Download from [gyan.dev/ffmpeg](https://www.gyan.dev/ffmpeg/builds/) → get `ffmpeg-release-essentials.zip`
  2. Extract the zip (e.g. to `C:\ffmpeg`)
  3. Add `C:\ffmpeg\bin` to your PATH ([how to add to PATH](https://www.architectryan.com/2018/03/17/add-to-the-path-on-windows-10/))
  4. Open a **new** terminal and run `ffmpeg -version` to verify
- **Mac:** `brew install ffmpeg`
- **Linux:** `sudo apt install ffmpeg` (Ubuntu/Debian)

#### yt-dlp (required for YouTube)
- **Windows:** Download `yt-dlp.exe` from [github.com/yt-dlp/yt-dlp/releases](https://github.com/yt-dlp/yt-dlp/releases), place in a folder, add folder to PATH
- **Mac/Linux:** `pip install yt-dlp` or download the binary

### 2. Get Your Bot Token

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Select your **Moozic** application
3. Click **Bot** in the left sidebar
4. Under "Token", click **Reset Token** or **Copy** to get your bot token
5. **Important**: Enable the **Message Content Intent** under "Privileged Gateway Intents"

### 3. Invite the Bot to Your Server

1. In the Developer Portal, go to **OAuth2** → **URL Generator**
2. Select scopes: `bot`
3. Select bot permissions: `Connect`, `Speak`, `Send Messages`
4. Copy the generated URL and open it to invite the bot

### 4. Install and Run

```bash
npm install
```

Create a `.env` file in the project root:

```
DISCORD_BOT_TOKEN=your_actual_bot_token_here
```

Then run:

```bash
npm start
```

## Usage

1. Join a voice channel
2. In any text channel:

| Command | Description |
|---------|-------------|
| `!play <query>` | Play a song (URL or search) - queued if something is playing |
| `!queue` | Show now playing and queue |
| `!remove <n>` or `!remove #<id>` | Remove song from queue by position or ID |
| `!pause` | Pause or resume playback |
| `!stop` | Stop and clear queue |
| `!disconnect` | Bot leaves the voice channel |
| `!albums` | List custom albums |
| `!album <name>` | Play an album from albums.json |

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DISCORD_BOT_TOKEN` | Your Discord bot token from the Developer Portal |

cd "d:\My Development Journey\moozic-bot"
## Deployment (Docker / Coolify)

The `Dockerfile` bundles Node 22, FFmpeg and yt-dlp (updated on every container start), so nothing needs installing on the host.

- Build pack: Dockerfile. No domain or port is needed; the bot only connects out to Discord and YouTube.
- Environment variable: `DISCORD_BOT_TOKEN`.
- Run only one copy with the same token. If it also runs locally, both reply to every command.
- If songs stop playing after a YouTube change, restart the container to pick up the newest yt-dlp.
