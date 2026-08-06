#!/bin/bash

# =============================================================================
# Universal Discord Bot - Docker Manager (docker.sh)
# =============================================================================
#
# DESIGN RULES (per project requirements - DO NOT VIOLATE):
# - .env is a JSON file {"BotName": "token..."}  -- NEVER a volume or bind-mount.
#   We use `docker cp` AFTER container start to inject/refresh it inside /app/.env.
#   This prevents Docker from creating a .env *directory* (EISDIR crash when main.js
#   tries fs.readFileSync on what became a dir).
# - container_name and --bot argument are set PERMANENTLY via sed when you choose a bot.
#   Once set, they are not reverted. Changing bot later will update the compose file.
# - All persistent data goes under ./docker/* (logs, downloads, backups, dm-logs, config).
#   Never pollute the project root with these.
# - Uses node:22-alpine + correct yt-dlp/ffmpeg/su-exec for @discordjs/voice (>=22.12).
# - Multi-bot friendly: pick which token from .env at "choose bot" time.
#
# Usage: ./docker.sh   (interactive menu)
# =============================================================================

set -e

COMPOSE_FILE="docker-compose.yml"
ENV_FILE=".env"
PROJECT_NAME="universal-discord-bot"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

print_header() {
    echo -e "${BLUE}========================================"
    echo -e "  Universal Discord Bot - Docker Manager"
    echo -e "========================================${NC}"
    echo -e "${CYAN}Bot: ${BOT_NAME:-none selected} | Container: $(grep -oP 'container_name:\s*\K\w+' "$COMPOSE_FILE" 2>/dev/null || echo 'n/a')${NC}"
    echo
}

check_docker() {
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}❌ Docker is not installed.${NC}"
        exit 1
    fi
    if docker compose version &> /dev/null 2>&1; then
        BASE_COMPOSE="docker compose"
    elif command -v docker-compose &> /dev/null; then
        BASE_COMPOSE="docker-compose"
    else
        echo -e "${RED}❌ Docker Compose is not installed.${NC}"
        exit 1
    fi
}

# Critical: Docker Compose auto-loads a file named ".env" in the current directory
# and tries to parse it as KEY=VALUE pairs. Our .env is JSON ({"Name":"token"}).
# Passing --env-file /dev/null prevents that auto-load entirely.
# This means we NEVER have to mv .env .env.bak / restore, never hide the file,
# and never make .env a volume. This is the correct, user-mandated approach.
setup_compose() {
    COMPOSE="$BASE_COMPOSE --env-file /dev/null"
}

# Parse bot names from the JSON .env
get_bot_names() {
    if [ ! -f "$ENV_FILE" ]; then
        echo ""
        return
    fi
    if command -v jq &> /dev/null; then
        jq -r 'keys[]' "$ENV_FILE" 2>/dev/null || echo ""
    else
        # Fallback parser (fragile but works for simple {"Name":"token"})
        grep -o '"[^"]*"' "$ENV_FILE" | head -30 | sed 's/"//g' | grep -v '{' | grep -v '}' | grep -v ':' | sort -u || echo ""
    fi
}

choose_bot() {
    local bots=($(get_bot_names))

    if [ ${#bots[@]} -eq 0 ]; then
        echo -e "${YELLOW}No bots found in $ENV_FILE${NC}"
        read -p "Enter bot name manually: " BOT_NAME
        export BOT_NAME
        configure_bot_in_compose
        return
    fi

    echo "Available bots from $ENV_FILE:"
    for i in "${!bots[@]}"; do
        echo "  $((i+1)). ${bots[$i]}"
    done
    echo "  0. Enter custom name"

    read -p "Select bot [1-${#bots[@]} or 0]: " choice

    if [ "$choice" -eq 0 ]; then
        read -p "Enter bot name: " BOT_NAME
    elif [ "$choice" -ge 1 ] && [ "$choice" -le ${#bots[@]} ]; then
        BOT_NAME="${bots[$((choice-1))]}"
    else
        echo -e "${RED}Invalid selection${NC}"
        exit 1
    fi

    export BOT_NAME
    echo -e "${GREEN}Selected bot: $BOT_NAME${NC}"
    configure_bot_in_compose
}

# Permanently configure compose file for the chosen bot (container name + CLI arg).
# This is the ONLY way bot selection affects Docker. No env var interpolation, no .env file tricks.
configure_bot_in_compose() {
    if [ -z "$BOT_NAME" ]; then
        return
    fi
    echo -e "${YELLOW}→ Configuring $COMPOSE_FILE permanently for bot '$BOT_NAME' (no revert)${NC}"

    # 1. container_name (simple and reliable)
    sed -i "s|^\(\s*container_name:\s*\).*|\1${BOT_NAME}|" "$COMPOSE_FILE"

    # 2. Replace the entire command line with a clean hardcoded version.
    #    This is safer than trying to edit inside the JSON-like array with multiple seds.
    sed -i 's|^\(\s*command:\s*\).*|\1["node", "main.js", "--bot", "'${BOT_NAME}'"]|' "$COMPOSE_FILE"

    echo -e "${GREEN}   container_name and --bot now permanently set to ${BOT_NAME}${NC}"
}

ensure_env_file() {
    if [ ! -f "$ENV_FILE" ]; then
        echo -e "${YELLOW}WARNING: $ENV_FILE not found. Creating empty placeholder.${NC}"
        echo '{}' > "$ENV_FILE"
    fi
}

# Create (and own) the clean docker/ volume layout on the HOST
ensure_docker_dirs() {
    mkdir -p docker/logs docker/downloads docker/backups docker/dm-logs docker/config
    # Best-effort: make current user own them so we don't get root-owned dirs
    if [ -w docker ]; then
        chown -R "$(id -u):$(id -g)" docker 2>/dev/null || true
    fi
    chmod -R u+rwX docker 2>/dev/null || true
}

# The critical function: copy the JSON .env into the running container.
# Called AFTER `up` so the container exists. This is what replaces any "volume" idea.
inject_env_into_container() {
    local bot="$1"
    if [ -z "$bot" ]; then
        bot="$BOT_NAME"
    fi
    local container
    container=$($COMPOSE -f "$COMPOSE_FILE" ps -q discord-bot 2>/dev/null | head -1)

    if [ -z "$container" ]; then
        # Fallback: try the literal container name we just configured
        container="$bot"
        if ! docker ps -q -f "name=^${container}$" >/dev/null 2>&1; then
            echo -e "${YELLOW}Could not determine container ID for injection. Skipping .env cp (bot may still work if .env was baked).${NC}"
            return 0
        fi
    fi

    if [ -f "$ENV_FILE" ]; then
        echo -e "${CYAN}→ Injecting $ENV_FILE into container for bot '$bot' ...${NC}"
        docker cp "$ENV_FILE" "$container:/app/.env" || {
            echo -e "${RED}docker cp failed. Container may not be ready yet.${NC}"
            return 1
        }
        # Also make sure node user can read it (entrypoint should have fixed, but belt+suspenders)
        docker exec "$container" chown node:node /app/.env 2>/dev/null || true
        echo -e "${GREEN}   .env injected successfully (never a volume).${NC}"
    else
        echo -e "${YELLOW}No $ENV_FILE on host to inject.${NC}"
    fi
}

run_compose() {
    ensure_env_file
    $COMPOSE -f "$COMPOSE_FILE" "$@"
}

show_status() {
    echo -e "${BLUE}=== Container Status ===${NC}"
    run_compose ps
    echo
}

build() {
    echo -e "${YELLOW}Building Docker image (using .dockerignore)...${NC}"
    run_compose build --no-cache
    echo -e "${GREEN}Build complete.${NC}"
}

up() {
    echo -e "${YELLOW}Starting containers...${NC}"

    ensure_docker_dirs
    ensure_env_file

    # configure_bot_in_compose already called when bot was chosen
    run_compose up -d --build

    echo -e "${GREEN}Containers started.${NC}"

    # THIS IS THE KEY STEP (replaces any volume mount of .env)
    inject_env_into_container "${BOT_NAME}"

    show_status
    echo -e "${CYAN}Tip: Use option 4 to follow logs. Use 'docker exec -it ${BOT_NAME} sh' for shell.${NC}"
}

down() {
    echo -e "${YELLOW}Stopping containers...${NC}"
    run_compose down
    echo -e "${GREEN}Containers stopped.${NC}"
}

restart() {
    echo -e "${YELLOW}Restarting...${NC}"
    ensure_env_file
    run_compose restart
    # Re-inject in case .env changed on host while container was up
    sleep 1
    inject_env_into_container "${BOT_NAME}"
    echo -e "${GREEN}Restarted and .env re-injected.${NC}"
}

logs() {
    echo -e "${BLUE}Following logs (Ctrl+C to exit)...${NC}"
    run_compose logs -f --tail=100
}

shell() {
    echo -e "${BLUE}Opening shell in container...${NC}"
    local container
    container=$($COMPOSE -f "$COMPOSE_FILE" ps -q discord-bot 2>/dev/null | head -1)
    if [ -z "$container" ]; then
        # try by name
        container=$(docker ps -q -f "name=${BOT_NAME}" | head -1)
    fi
    if [ -z "$container" ]; then
        echo -e "${RED}Container not running. Start it first.${NC}"
        return
    fi

    echo "  1) Shell as node user (normal)"
    echo "  2) Shell as root (for debugging chown/perms)"
    read -p "Choice [1]: " sh_choice
    if [ "$sh_choice" = "2" ]; then
        docker exec -it -u root "$container" sh
    else
        docker exec -it "$container" sh
    fi
}

rebuild() {
    echo -e "${YELLOW}Full rebuild (down + build + up + inject)...${NC}"
    run_compose down
    ensure_docker_dirs
    run_compose build --no-cache
    run_compose up -d
    inject_env_into_container "${BOT_NAME}"
    echo -e "${GREEN}Rebuild complete.${NC}"
    show_status
}

edit_files() {
    echo "Which file do you want to edit?"
    echo "  1. docker-compose.yml (container name, command, volumes)"
    echo "  2. Dockerfile"
    echo "  3. docker-entrypoint.sh"
    read -p "Choice: " edit_choice

    case $edit_choice in
        1) ${EDITOR:-nano} docker-compose.yml ;;
        2) ${EDITOR:-nano} Dockerfile ;;
        3) ${EDITOR:-nano} docker-entrypoint.sh ;;
        *) echo "Invalid choice" ;;
    esac

    echo -e "${YELLOW}Would you like to rebuild now? (y/N)${NC}"
    read -p "> " rebuild_now
    if [[ "$rebuild_now" =~ ^[Yy]$ ]]; then
        rebuild
    fi
}

clean() {
    echo -e "${RED}WARNING: This will remove containers, volumes, and images for this project.${NC}"
    read -p "Are you sure? (y/N): " confirm
    if [[ "$confirm" =~ ^[Yy]$ ]]; then
        run_compose down -v --rmi all
        echo -e "${YELLOW}Also removing local ./docker data? (y/N)${NC}"
        read -p "> " rm_data
        if [[ "$rm_data" =~ ^[Yy]$ ]]; then
            rm -rf docker
            echo "docker/ data removed."
        fi
        echo -e "${GREEN}Cleanup complete.${NC}"
    fi
}

show_env_info() {
    echo -e "${BLUE}=== Environment & Config ===${NC}"
    if [ -f "$ENV_FILE" ]; then
        echo "Bots defined in $ENV_FILE:"
        get_bot_names | while read -r bot; do
            [ -n "$bot" ] && echo "  - $bot"
        done
    else
        echo "No $ENV_FILE file found."
    fi
    echo
    echo "Current compose container_name / bot:"
    grep -E 'container_name:|--bot' "$COMPOSE_FILE" | head -2 || true
    echo
}

host_cleanup() {
    echo -e "${YELLOW}This will remove legacy root-level data dirs (backups/, logs/, etc.) that were created by old volume mounts.${NC}"
    echo "They should be empty. You may need sudo."
    read -p "Proceed? (y/N): " ok
    if [[ "$ok" =~ ^[Yy]$ ]]; then
        rm -rf backups dm-logs logs .downloads 2>/dev/null || sudo rm -rf backups dm-logs logs .downloads 2>/dev/null || true
        echo -e "${GREEN}Legacy dirs cleaned (if permissions allowed).${NC}"
    fi
}

main_menu() {
    while true; do
        echo
        print_header
        echo "  1)  Start / Up (build if needed + inject .env)"
        echo "  2)  Stop / Down"
        echo "  3)  Restart (re-injects .env)"
        echo "  4)  View Logs"
        echo "  5)  Open Shell in Container"
        echo "  6)  Full Rebuild"
        echo "  7)  Show Status"
        echo "  8)  Edit docker files"
        echo "  9)  Choose / Change Bot (updates compose permanently)"
        echo " 10)  Show .env / Bot Info"
        echo " 11)  Clean Everything (containers + optional data)"
        echo " 12)  Host cleanup (remove legacy root-level data dirs)"
        echo "  0)  Exit"
        echo
        read -p "Select option: " choice

        case $choice in
            1) up ;;
            2) down ;;
            3) restart ;;
            4) logs ;;
            5) shell ;;
            6) rebuild ;;
            7) show_status ;;
            8) edit_files ;;
            9) choose_bot ;;
           10) show_env_info ;;
           11) clean ;;
           12) host_cleanup ;;
            0) echo "Goodbye!"; exit 0 ;;
            *) echo -e "${RED}Invalid option${NC}" ;;
        esac
    done
}

# === Main ===
check_docker
setup_compose

# Auto-select if only one bot and none chosen yet
bots=($(get_bot_names))
if [ ${#bots[@]} -eq 1 ] && [ -z "$BOT_NAME" ]; then
    BOT_NAME="${bots[0]}"
    export BOT_NAME
    configure_bot_in_compose
fi

# If still no bot, let user pick
if [ -z "$BOT_NAME" ]; then
    choose_bot
fi

main_menu
