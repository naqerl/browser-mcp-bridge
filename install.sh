#!/bin/bash
# Browser MCP Bridge Installation Script

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_NAME="com.browsermcp.host"
HOST_PATH="$SCRIPT_DIR/native-host/host.py"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Browser MCP Bridge Installer ===${NC}"
echo

# Make host executable
chmod +x "$HOST_PATH"

# Detect browser
CHROME_DIR=""
CHROMIUM_DIR=""

if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux
    CHROME_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
    CHROMIUM_DIR="$HOME/.config/chromium/NativeMessagingHosts"
    BRAVE_DIR="$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"
    EDGE_DIR="$HOME/.config/microsoft-edge/NativeMessagingHosts"
    FIREFOX_DIR="$HOME/.mozilla/native-messaging-hosts"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    CHROME_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
    CHROMIUM_DIR="$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
    BRAVE_DIR="$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"
    EDGE_DIR="$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"
    FIREFOX_DIR="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"
fi

# Create native messaging host manifest
MANIFEST=$(cat "$SCRIPT_DIR/native-host/$HOST_NAME.json" | sed "s|HOST_PATH|$HOST_PATH|g")

install_for_browser() {
    local dir="$1"
    local name="$2"
    
    if [ -d "$(dirname "$dir")" ]; then
        mkdir -p "$dir"
        echo "$MANIFEST" > "$dir/$HOST_NAME.json"
        echo -e "${GREEN}✓${NC} Installed for $name"
    fi
}

# Install for all detected browsers
install_for_browser "$CHROME_DIR" "Google Chrome"
install_for_browser "$CHROMIUM_DIR" "Chromium"
install_for_browser "$BRAVE_DIR" "Brave"
install_for_browser "$EDGE_DIR" "Microsoft Edge"

# Firefox uses a different manifest format
if [ -d "$(dirname "$FIREFOX_DIR")" ]; then
    mkdir -p "$FIREFOX_DIR"
    # Firefox needs allowed_extensions instead of allowed_origins
    echo "$MANIFEST" | sed 's/"allowed_origins"/"allowed_extensions": ["browser-mcp@example.com"],\n  "allowed_origins"/' > "$FIREFOX_DIR/$HOST_NAME.json"
    echo -e "${GREEN}✓${NC} Installed for Firefox"
fi

echo
echo -e "${GREEN}Native host installed!${NC}"
echo
echo "Next steps:"
echo "1. Open Chrome/Chromium/Brave/Edge and go to chrome://extensions/"
echo "2. Enable 'Developer mode' (toggle in top right)"
echo "3. Click 'Load unpacked' and select: $SCRIPT_DIR/extension"
echo "4. The extension icon should appear in your toolbar"
echo
echo "The MCP HTTP server will run on: http://localhost:6277"
echo
echo "Test with:"
echo "  curl http://localhost:6277/health"
echo "  curl http://localhost:6277/tabs"
echo
