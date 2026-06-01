# Use official Node.js LTS image (Alpine for smaller size)
# node:22-alpine satisfies @discordjs/voice (>=22.12) and is lightweight.
FROM node:22-alpine

# Set working directory
WORKDIR /app

# Install system dependencies + su-exec for safe privilege dropping in entrypoint
# - ffmpeg: required for music/voice features (@discordjs/voice)
# - yt-dlp: required for /yt and /music (used instead of pip to avoid PEP 668 issues on Alpine)
# - su-exec: tiny tool to drop from root -> node user after volume chown at runtime
RUN apk add --no-cache \
    ffmpeg \
    yt-dlp \
    su-exec

# Copy package files first (better layer caching)
COPY package*.json ./

# Install Node.js dependencies (production only)
RUN npm ci --only=production && npm cache clean --force

# Copy the rest of the application (see .dockerignore for what is excluded)
COPY . .

# Create directories in image (will be bind-mounted at runtime; entrypoint fixes host perms)
RUN mkdir -p logs .downloads backups dm-logs config && \
    chown -R node:node /app

# Copy and prepare entrypoint (runs as root for chown, then drops to node)
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# IMPORTANT: Do NOT set USER here. Entrypoint starts as root to fix mounted volume
# ownership (bind mounts appear as root on host), then uses su-exec to drop to 'node'.
# This prevents "EACCES: permission denied" on logs/.downloads etc. while keeping
# the bot process itself non-root.
ENTRYPOINT ["docker-entrypoint.sh"]

# Default command (args passed to entrypoint which will exec as node)
# Override example: docker run ... node main.js --bot SkyNET --debug
CMD ["node", "main.js"]
