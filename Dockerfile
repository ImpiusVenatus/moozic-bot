# Moozic: Discord music bot. No web port; it only connects out to Discord and YouTube.
FROM node:22-bookworm-slim

# ffmpeg (with libopus) turns YouTube audio into Opus for Discord voice.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

# yt-dlp standalone build. YouTube changes often, so the container also updates it on every start.
# yt-dlp needs a JavaScript runtime for YouTube; Node is already here.
RUN curl -fsSL -o /usr/local/bin/yt-dlp https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux \
 && chmod 755 /usr/local/bin/yt-dlp \
 && chown node:node /usr/local/bin/yt-dlp \
 && printf -- '--js-runtimes node\n' > /etc/yt-dlp.conf

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .

USER node
ENV NODE_ENV=production
CMD ["sh", "-c", "yt-dlp -U || true; exec node index.js"]
