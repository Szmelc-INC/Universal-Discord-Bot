#!/bin/bash

set -e

echo "========================================"
echo "  Universal Discord Bot - Setup Script"
echo "========================================"
echo

# Check for node
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

echo "✅ Node.js found: $(node -v)"

# Check for npm
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed."
    exit 1
fi

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
else
    echo "✅ Dependencies already installed."
fi

# Handle .env
ENV_FILE=".env"
CONFIG_FILE="config.json"

if [ -f "$ENV_FILE" ]; then
    echo "✅ .env file already exists."
    read -p "Do you want to add another bot to .env? (y/N): " ADD_BOT
    if [[ ! "$ADD_BOT" =~ ^[Yy]$ ]]; then
        echo "Skipping .env creation."
    else
        CREATE_ENV=true
    fi
else
    echo "📄 .env not found. Creating it..."
    CREATE_ENV=true
fi

if [ "$CREATE_ENV" = true ]; then
    read -p "Enter bot name (e.g. SkyNET, MyBot): " BOT_NAME
    read -p "Enter bot token: " BOT_TOKEN

    if [ -z "$BOT_NAME" ] || [ -z "$BOT_TOKEN" ]; then
        echo "❌ Bot name and token are required."
        exit 1
    fi

    if [ -f "$ENV_FILE" ]; then
        # Try to use jq if available for clean merge
        if command -v jq &> /dev/null; then
            jq --arg name "$BOT_NAME" --arg token "$BOT_TOKEN" \
               '. + {($name): $token}' "$ENV_FILE" > "${ENV_FILE}.tmp" && mv "${ENV_FILE}.tmp" "$ENV_FILE"
            echo "✅ Added $BOT_NAME to existing .env"
        else
            echo "⚠️  jq not found. Please manually add this to your .env:"
            echo "  \"$BOT_NAME\": \"$BOT_TOKEN\""
        fi
    else
        # Create new .env
        cat > "$ENV_FILE" << EOF
{
  "$BOT_NAME": "$BOT_TOKEN"
}
EOF
        echo "✅ Created .env with bot: $BOT_NAME"
    fi
fi

# Update config.json with the bot if it doesn't exist
if command -v jq &> /dev/null; then
    if [ -f "$CONFIG_FILE" ]; then
        BOT_EXISTS=$(jq -r --arg name "$BOT_NAME" 'has($name)' "$CONFIG_FILE" 2>/dev/null || echo "false")

        if [ "$BOT_EXISTS" != "true" ]; then
            echo "📝 Adding $BOT_NAME to config.json..."
            jq --arg name "$BOT_NAME" '
                .bots += {
                    ($name): {
                        "modules_folder": "modules",
                        "enabled_modules": [],
                        "disabled_modules": []
                    }
                }
            ' "$CONFIG_FILE" > "${CONFIG_FILE}.tmp" && mv "${CONFIG_FILE}.tmp" "$CONFIG_FILE"
            echo "✅ Added $BOT_NAME to config.json"
        else
            echo "✅ $BOT_NAME already exists in config.json"
        fi
    else
        echo "⚠️  config.json not found. Please create it manually or copy from example."
    fi
else
    echo "⚠️  jq not found. Please manually ensure '$BOT_NAME' exists under 'bots' in config.json."
fi

echo
echo "✅ Basic setup complete!"
echo
echo "You can now run the bot with:"
echo "  node main.js"
echo "  node main.js --bot $BOT_NAME"
echo "  node main.js --bot $BOT_NAME --debug"
echo

# Future Docker section (stub)
echo "----------------------------------------"
echo "Docker Support (Coming Soon)"
echo "----------------------------------------"
echo "Planned: This script will eventually support building and deploying"
echo "a Docker image for this bot."
echo
echo "For now, you can run the bot directly with Node.js."
echo

read -p "Would you like to start the bot now? (y/N): " START_NOW

if [[ "$START_NOW" =~ ^[Yy]$ ]]; then
    echo "Starting bot..."
    if [ -n "$BOT_NAME" ]; then
        node main.js --bot "$BOT_NAME"
    else
        node main.js
    fi
fi
