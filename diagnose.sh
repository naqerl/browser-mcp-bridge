#!/bin/bash
# Diagnostic script for Browser MCP Bridge

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOST_NAME="com.browsermcp.host"
HOST_BINARY="$SCRIPT_DIR/native-host/host"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${GREEN}=== Browser MCP Bridge Diagnostic ===${NC}"
echo

# Check if host binary exists
echo -n "Native host binary exists: "
if [ -f "$HOST_BINARY" ]; then
    echo -e "${GREEN}✓${NC} $(ls -lh "$HOST_BINARY" | awk '{print $5}')"
else
    echo -e "${RED}✗${NC} Not found at $HOST_BINARY"
    echo "  Run: make build"
fi

# Check if binary is executable
echo -n "Binary is executable: "
if [ -x "$HOST_BINARY" ]; then
    echo -e "${GREEN}✓${NC}"
else
    echo -e "${RED}✗${NC}"
    echo "  Run: chmod +x $HOST_BINARY"
fi

# Check port
echo -n "Port 6277 (HTTP) available: "
if command -v ss &> /dev/null && ss -tlnp 2>/dev/null | grep -q ':6277'; then
    echo -e "${YELLOW}⚠${NC} Port is in use"
elif command -v lsof &> /dev/null && lsof -i :6277 &> /dev/null; then
    echo -e "${YELLOW}⚠${NC} Port is in use"
else
    echo -e "${GREEN}✓${NC}"
fi

echo -n "Port 6278 (WebSocket) available: "
if command -v ss &> /dev/null && ss -tlnp 2>/dev/null | grep -q ':6278'; then
    echo -e "${YELLOW}⚠${NC} Port is in use"
elif command -v lsof &> /dev/null && lsof -i :6278 &> /dev/null; then
    echo -e "${YELLOW}⚠${NC} Port is in use"
else
    echo -e "${GREEN}✓${NC}"
fi

echo -e "\n${GREEN}=== Detected Browsers ===${NC}"

# Detect running browsers
BROWSERS=""
if pgrep -x "chrome" > /dev/null || pgrep -f "google-chrome" > /dev/null; then
    BROWSERS="$BROWSERS Chrome"
fi
if pgrep -x "chromium" > /dev/null || pgrep -f "chromium-browser" > /dev/null; then
    BROWSERS="$BROWSERS Chromium"
fi
if pgrep -x "brave" > /dev/null || pgrep -f "brave-browser" > /dev/null; then
    BROWSERS="$BROWSERS Brave"
fi
if pgrep -f "flatpak.*brave" > /dev/null; then
    BROWSERS="$BROWSERS Brave(Flatpak)"
fi
if pgrep -f "flatpak.*chrome" > /dev/null; then
    BROWSERS="$BROWSERS Chrome(Flatpak)"
fi

if [ -z "$BROWSERS" ]; then
    echo -e "${YELLOW}⚠${NC} No browsers currently running"
else
    echo -e "${GREEN}✓${NC} Running:$BROWSERS"
fi

# Check for Snap/Flatpak
if snap list 2>/dev/null | grep -qE "chrome|chromium|brave"; then
    echo -e "${YELLOW}⚠${NC} Snap browsers detected (sandboxed)"
fi
if flatpak list 2>/dev/null | grep -qE "brave|chrome|chromium"; then
    echo -e "${YELLOW}⚠${NC} Flatpak browsers detected (sandboxed)"
fi

echo -e "\n${GREEN}=== Native Messaging Manifests ===${NC}"

# Check various browser manifest locations
check_manifest() {
    local dir="$1"
    local name="$2"
    local manifest_path="$dir/$HOST_NAME.json"
    
    echo -n "$name: "
    if [ -f "$manifest_path" ]; then
        local path_in_manifest=$(grep '"path"' "$manifest_path" 2>/dev/null | sed 's/.*"path": "\(.*\)".*/\1/')
        if [ -n "$path_in_manifest" ] && [ -f "$path_in_manifest" ]; then
            echo -e "${GREEN}✓${NC}"
        else
            echo -e "${RED}✗${NC} Path in manifest not found: $path_in_manifest"
        fi
    else
        echo -e "${YELLOW}⚠${NC} Not installed"
    fi
}

# Standard locations
check_manifest "$HOME/.config/google-chrome/NativeMessagingHosts" "Chrome"
check_manifest "$HOME/.config/chromium/NativeMessagingHosts" "Chromium"
check_manifest "$HOME/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts" "Brave"
check_manifest "$HOME/.config/microsoft-edge/NativeMessagingHosts" "Edge"

# Snap locations
check_manifest "$HOME/snap/google-chrome/current/.config/google-chrome/NativeMessagingHosts" "Chrome (Snap)"
check_manifest "$HOME/snap/chromium/current/.config/chromium/NativeMessagingHosts" "Chromium (Snap)"
check_manifest "$HOME/snap/brave/current/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts" "Brave (Snap)"

# Flatpak locations
check_manifest "$HOME/.var/app/com.brave.Browser/config/BraveSoftware/Brave-Browser/NativeMessagingHosts" "Brave (Flatpak)"
check_manifest "$HOME/.var/app/com.google.Chrome/config/google-chrome/NativeMessagingHosts" "Chrome (Flatpak)"
check_manifest "$HOME/.var/app/org.chromium.Chromium/config/chromium/NativeMessagingHosts" "Chromium (Flatpak)"

# macOS locations
if [[ "$OSTYPE" == "darwin"* ]]; then
    check_manifest "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" "Chrome (macOS)"
    check_manifest "$HOME/Library/Application Support/Chromium/NativeMessagingHosts" "Chromium (macOS)"
fi

echo -e "\n${GREEN}=== Testing Native Host ===${NC}"

if [ ! -f "$HOST_BINARY" ]; then
    echo -e "${RED}✗${NC} Host binary not found. Build it with: make build"
else
    echo "Running quick test of native host..."
    
    # Test if the host runs
    timeout 2 "$HOST_BINARY" &
    PID=$!
    sleep 0.5
    if kill -0 $PID 2>/dev/null; then
        echo -e "${GREEN}✓${NC} Native host starts successfully"
        
        # Test HTTP endpoint
        sleep 0.5
        if curl -s http://localhost:6277/health > /dev/null 2>&1; then
            echo -e "${GREEN}✓${NC} HTTP server responding"
            curl -s http://localhost:6277/health | python3 -m json.tool 2>/dev/null || curl -s http://localhost:6277/health
        else
            echo -e "${YELLOW}⚠${NC} HTTP server not responding (may need more time)"
        fi
        
        kill $PID 2>/dev/null || true
        wait $PID 2>/dev/null || true
    else
        echo -e "${RED}✗${NC} Native host failed to start"
    fi
fi

echo -e "\n${BLUE}=== Troubleshooting ===${NC}"

echo "1. Build the native host:"
echo "   make build"
echo "   # or if Go is not installed:"
echo "   make build-go"

echo -e "\n2. For Flatpak/Snap browsers (no browser modifications needed):"
echo "   - Start the host: ./native-host/host"
echo "   - The extension will auto-connect via WebSocket on port 6278"
echo "   - No Flatpak override or browser restart needed!"

echo -e "\n3. For regular browsers (Chrome, Chromium, Brave):"
echo "   - Native messaging should work automatically after ./install.sh"
echo "   - Check brave://version for 'Profile Path'"
echo "   - Ensure com.browsermcp.host.json is in [Profile Path]/NativeMessagingHosts/"

echo -e "\n4. Common fixes:"
echo "   - Reload the extension in chrome://extensions/"
echo "   - Restart the browser completely"
echo "   - Run ./install.sh again if you moved the project folder"
