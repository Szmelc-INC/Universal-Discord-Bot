#!/bin/sh
# docker-entrypoint.sh
# Runs as root (temporarily), fixes permissions on bind-mounted volumes,
# then drops privileges to the 'node' user before executing the bot.
# This ensures the bot (running as non-root) can always write to logs, downloads, etc.
# even when Docker bind-mounts create root-owned dirs on the host.

set -e

# Directories that may be bind-mounted from host (created by docker/ in docker.sh)
DATA_DIRS="/app/logs /app/.downloads /app/backups /app/dm-logs /app/config"

echo "[entrypoint] Fixing ownership on mounted volumes for node user..."
for d in $DATA_DIRS; do
  if [ -d "$d" ]; then
    chown -R node:node "$d" 2>/dev/null || true
    chmod -R u+rwX "$d" 2>/dev/null || true
  fi
done

# Also ensure the app root is traversable
chmod 755 /app 2>/dev/null || true

echo "[entrypoint] Dropping to node user and starting: $@"

# Use su-exec (lightweight, installed in image) to drop privileges
# All args (from CMD or overridden command in compose) are passed through.
exec su-exec node "$@"
