#!/bin/bash
# Browser MCP Bridge Installation Script

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_NAME="com.browsermcp.host"
HOST_BINARY="$SCRIPT_DIR/native-host/host"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== Browser MCP Bridge Installer ===${NC}"
echo -e "${BLUE}Native Go binary with WebSocket support (no Python needed!)${NC}"
echo

# Check if host binary exists, build if not
if [ ! -f "$HOST_BINARY" ]; then
    echo -e "${YELLOW}Native host binary not found. Building from source...${NC}"
    
    # Check for Go
    if ! command -v go &> /dev/null; then
        echo -e "${RED}Error: Go is not installed.${NC}"
        echo "Please install Go 1.21+ from https://golang.org/dl/"
        echo "Or use a pre-built binary from the releases page."
        exit 1
    fi
    
    # Build the binary
    echo "Building..."
    cd "$SCRIPT_DIR"
    go mod tidy
    go build -o "$HOST_BINARY" ./cmd/host/
    
    echo -e "${GREEN}✓${NC} Built native host binary"
fi

# Make sure binary is executable
chmod +x "$HOST_BINARY"

# Create native messaging host manifest
MANIFEST=$(cat "$SCRIPT_DIR/native-host/com.browsermcp.host.json" | sed "s|HOST_PATH|$HOST_BINARY|g")

install_for_browser() {
    local dir="$1"
    local name="$2"
    
    if [ -d "$(dirname "$dir")" ]; then
        mkdir -p "$dir"
        echo "$MANIFEST" > "$dir/$HOST_NAME.json"
        echo -e "${GREEN}✓${NC} Installed for $name"
        return 0
    fi
    return 1
}

# Detect OS
if [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux - Standard locations
    CHROME_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
    CHROMIUM_DIR="$HOME/.config/chromium/NativeMessagingHosts"
    BRAVE_DIR="$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"
    EDGE_DIR="$HOME/.config/microsoft-edge/NativeMessagingHosts"
    
    # Flatpak locations
    FLATPAK_BRAVE_DIR="$HOME/.var/app/com.brave.Browser/config/BraveSoftware/Brave-Browser/NativeMessagingHosts"
    FLATPAK_CHROME_DIR="$HOME/.var/app/com.google.Chrome/config/google-chrome/NativeMessagingHosts"
    FLATPAK_CHROMIUM_DIR="$HOME/.var/app/org.chromium.Chromium/config/chromium/NativeMessagingHosts"
    
elif [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    CHROME_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
    CHROMIUM_DIR="$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
    BRAVE_DIR="$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"
    EDGE_DIR="$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"
fi

# Install for standard browsers
echo "Installing native messaging manifests..."
install_for_browser "$CHROME_DIR" "Google Chrome"
install_for_browser "$CHROMIUM_DIR" "Chromium"
install_for_browser "$BRAVE_DIR" "Brave"
install_for_browser "$EDGE_DIR" "Microsoft Edge"

# Install for Flatpak browsers (manifest only - WebSocket is the primary method)
install_for_browser "$FLATPAK_BRAVE_DIR" "Brave (Flatpak)"
install_for_browser "$FLATPAK_CHROME_DIR" "Chrome (Flatpak)"
install_for_browser "$FLATPAK_CHROMIUM_DIR" "Chromium (Flatpak)"

echo
echo -e "${GREEN}Installation complete!${NC}"
echo
echo "The host is a native binary (no Python/dependencies required)."
echo
echo -e "${YELLOW}For Flatpak/Snap browsers (recommended method):${NC}"
echo "  1. Start the host: ./native-host/host"
echo "  2. Load the extension in your browser"
echo "  3. The extension connects via WebSocket automatically"
echo
echo -e "${YELLOW}For regular browsers:${NC}"
echo "  1. The browser can auto-start the host via native messaging"
echo "  2. Or run it manually: ./native-host/host"
echo
echo "WebSocket endpoint: ws://localhost:6277/ws"
echo "HTTP health check:  http://localhost:6277/health"
echo
