#!/bin/bash
# Browser MCP Bridge - Native Host Installation Script

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_NAME="com.browsermcp.host"

# Detect platform
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

# Map architecture names
case "$ARCH" in
  x86_64) ARCH="amd64" ;;
  arm64|aarch64) ARCH="arm64" ;;
esac

# Binary path (relative to manifest)
HOST_DIR="$SCRIPT_DIR/extension/host"
BINARY_PATH="$HOST_DIR/browser-mcp-host"
PLATFORM_BINARY="$HOST_DIR/${OS}-${ARCH}/browser-mcp-host"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}=== Browser MCP Bridge Installer ===${NC}"
echo "Detected platform: $OS-$ARCH"
echo

# Check for pre-built binary
if [ -f "$PLATFORM_BINARY" ]; then
  echo -e "${GREEN}Found pre-built binary for $OS-$ARCH${NC}"
  mkdir -p "$HOST_DIR"
  cp "$PLATFORM_BINARY" "$BINARY_PATH"
  chmod +x "$BINARY_PATH"
elif [ -f "$BINARY_PATH" ]; then
  echo -e "${YELLOW}Using existing binary at $BINARY_PATH${NC}"
else
  echo -e "${YELLOW}No pre-built binary found. Building from source...${NC}"
  
  # Check for Go
  if ! command -v go &> /dev/null; then
    echo -e "${RED}Error: Go is not installed${NC}"
    echo "Please install Go 1.21+ or download a pre-built release from:"
    echo "  https://github.com/naqerl/browser-mcp-bridge/releases"
    exit 1
  fi
  
  echo "Building native host binary..."
  make build
fi

# Detect browser config directories
CHROME_DIR=""
CHROMIUM_DIR=""
BRAVE_DIR=""
EDGE_DIR=""

if [[ "$OSTYPE" == "linux-gnu"* ]]; then
  CHROME_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
  CHROMIUM_DIR="$HOME/.config/chromium/NativeMessagingHosts"
  BRAVE_DIR="$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts"
  EDGE_DIR="$HOME/.config/microsoft-edge/NativeMessagingHosts"
elif [[ "$OSTYPE" == "darwin"* ]]; then
  CHROME_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
  CHROMIUM_DIR="$HOME/Library/Application Support/Chromium/NativeMessagingHosts"
  BRAVE_DIR="$HOME/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts"
  EDGE_DIR="$HOME/Library/Application Support/Microsoft Edge/NativeMessagingHosts"
fi

# Create native messaging host manifest
MANIFEST=$(cat "$SCRIPT_DIR/native-host/$HOST_NAME.json" | sed "s|HOST_PATH|$BINARY_PATH|g")

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

# Track if any browser was found
INSTALLED=0

# Install for all detected browsers
install_for_browser "$CHROME_DIR" "Google Chrome" && INSTALLED=1
install_for_browser "$CHROMIUM_DIR" "Chromium" && INSTALLED=1
install_for_browser "$BRAVE_DIR" "Brave" && INSTALLED=1
install_for_browser "$EDGE_DIR" "Microsoft Edge" && INSTALLED=1

echo

if [ $INSTALLED -eq 0 ]; then
  echo -e "${YELLOW}No supported browsers detected in standard locations.${NC}"
  echo "Please manually install the native host manifest from:"
  echo "  $SCRIPT_DIR/native-host/$HOST_NAME.json"
  echo
  echo "Update the 'path' field to point to:"
  echo "  $BINARY_PATH"
  exit 1
fi

echo -e "${GREEN}Native host installed!${NC}"
echo
echo "Next steps:"
echo "1. Open your browser and go to chrome://extensions/"
echo "2. Enable 'Developer mode' (toggle in top right)"
echo "3. Click 'Load unpacked' and select: $SCRIPT_DIR/extension"
echo "4. Click the extension icon to see status"
echo
echo "The MCP WebSocket server will start automatically when the extension loads."
echo
