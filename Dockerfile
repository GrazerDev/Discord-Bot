# ─────────────────────────────────────────────────────────────────────────────
# Nexus — Discord bot container
# Includes yt-dlp + ffmpeg so /play works out of the box.
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim

ENV NODE_ENV=production \
    DB_PATH=/data/bot.db \
    PORT=8080

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ffmpeg python3 python3-pip ca-certificates curl tini \
 && pip3 install --break-system-packages --no-cache-dir -U yt-dlp \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY . .
RUN mkdir -p /data

EXPOSE 8080
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/index.js"]

# Rebuild at least monthly — yt-dlp goes stale and YouTube breaks it.
