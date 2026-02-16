# Browser MCP Bridge

Control your browser via WebSocket MCP (Model Context Protocol). A Go-native host with a Chrome extension for browser automation.

**Works with Flatpak browsers!** No native messaging required.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Browser Extension                       │
│  ┌─────────────┐    ┌──────────────┐                       │
│  │  Popup UI   │◄──►│  Background  │◄──► WebSocket         │
│  │  (status)   │    │  (client)    │     (port 6277)       │
│  └─────────────┘    └──────────────┘                       │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              │ ws://localhost:6277/ws
┌─────────────────────────────┼───────────────────────────────┐
│  Go Native Host             │                               │
│  ┌──────────────────────────┴──┐                            │
│  │  WebSocket Server (port 6277)│                           │
│  │  - MCP message routing      │                            │
│  │  - Request/response handling│                            │
│  └─────────────────────────────┘                            │
└─────────────────────────────────────────────────────────────┘
```

**For Flatpak/Snap browsers:** Run the Go binary manually, extension connects via WebSocket directly.

**For regular browsers:** Can optionally use native messaging (see Legacy Mode).

## Features

- **Flatpak Support**: No native messaging required - works with sandboxed browsers
- **WebSocket Communication**: Real-time bidirectional messaging
- **MCP Protocol**: Standard Model Context Protocol for tool invocation
- **Popup UI**: Visual status, errors, and active operations
- **Cross-Platform**: Linux (amd64/arm64), macOS (amd64/arm64), Windows (amd64)
- **Static Binary**: Single binary distribution, no runtime dependencies

## Quick Start

### 1. Download Pre-built Release

Download the latest release for your platform from [Releases](https://github.com/naqerl/browser-mcp-bridge/releases)

### 2. Start the Host

Extract and run the binary:

```bash
# Linux/macOS
./browser-mcp-host

# Windows
browser-mcp-host.exe
```

The host will start a WebSocket server on port 6277.

**Optional flags:**
```bash
./browser-mcp-host -port 8080        # Use different port
./browser-mcp-host -log-level debug  # Enable debug logging
```

### 3. Load the Extension

1. Open Chrome/Brave/Chromium/Edge
2. Go to `chrome://extensions/`
3. Enable "Developer mode"
4. Click "Load unpacked"
5. Select the `extension` folder from the release

The extension will automatically connect to `ws://localhost:6277/ws`.

### 4. Verify Connection

Click the extension icon - you should see "Connected" with a green indicator.

If you see "Disconnected" and instructions to start the host, make sure the binary is running.

---

## Flatpak Browser Support

For Flatpak browsers (like Brave from Flathub), native messaging is blocked by sandboxing. This extension bypasses that by using direct WebSocket connections.

**Setup:**
1. Download and extract the release
2. Run `./browser-mcp-host` in a terminal (keep it running)
3. Load the extension in your Flatpak browser
4. The extension connects via WebSocket - no native messaging needed!

---

## Legacy Mode (Native Messaging)

For non-Flatpak browsers, you can optionally use native messaging so the browser auto-starts the host:

```bash
# Install native host manifest
./install.sh

# Or run with -native flag
./browser-mcp-host -native
```

This requires the browser to have native messaging permissions (not available in Flatpak).

---

## MCP Tools Available

| Tool | Description | Parameters |
|------|-------------|------------|
| `browser_tabs_list` | List all open tabs | - |
| `browser_tab_activate` | Focus a tab | `tab_id` |
| `browser_tab_navigate` | Navigate to URL | `tab_id`, `url` |
| `browser_tab_close` | Close a tab | `tab_id` |
| `browser_tab_screenshot` | Screenshot tab | `tab_id` |
| `browser_page_content` | Get page content | `tab_id` |
| `browser_page_click` | Click element | `tab_id`, `selector` |
| `browser_page_fill` | Fill input field | `tab_id`, `selector`, `value` |
| `browser_page_scroll` | Scroll page | `tab_id`, `x`, `y` |
| `browser_page_execute` | Execute JavaScript | `tab_id`, `script` |
| `browser_page_find` | Find elements | `tab_id`, `selector` |

## WebSocket API

The Go host exposes a WebSocket endpoint at `ws://127.0.0.1:6277/ws`

### Message Format

**Request (Extension → Go):**
```json
{
  "id": 1,
  "method": "tabs/list",
  "params": "{}"
}
```

**Response (Go → Extension):**
```json
{
  "id": 1,
  "result": [...]
}
```

**Error Response:**
```json
{
  "id": 1,
  "error": {
    "code": -32603,
    "message": "error description"
  }
}
```

### HTTP Health Check

```bash
curl http://localhost:6277/health
```

Response:
```json
{
  "status": "ok",
  "extension_connected": true
}
```

---

## Build from Source

**Prerequisites:** Go 1.21+

```bash
git clone https://github.com/naqerl/browser-mcp-bridge.git
cd browser-mcp-bridge

# Install tools
make install-tools

# Build
make all  # lint + build

# Run
./extension/host/browser-mcp-host
```

### Makefile Targets

| Target | Description |
|--------|-------------|
| `make all` | Lint + build for current platform |
| `make build` | Build for current platform |
| `make build-all` | Cross-compile all platforms |
| `make lint` | Run staticcheck and go vet |
| `make install-tools` | Install staticcheck v0.7.0 |

---

## Troubleshooting

### Extension shows "Disconnected"

1. **Make sure the host is running:**
   ```bash
   ./browser-mcp-host
   # Should print: WebSocket server started port=6277
   ```

2. **Check if port 6277 is available:**
   ```bash
   lsof -i :6277
   ```

3. **Check extension popup for errors**

4. **Try different port:**
   ```bash
   ./browser-mcp-host -port 8080
   ```
   Then update `DEFAULT_WS_PORT` in `extension/background.js`

### Flatpak-specific issues

If using Flatpak Brave/Chrome and still get "Disconnected":
- Flatpak apps can access localhost by default
- If blocked, you may need to grant network permission:
  ```bash
  flatpak override --user com.brave.Browser --share=network
  ```

### Build errors

Ensure Go 1.21+ is installed:
```bash
go version
```

---

## Development

### Project Structure

```
browser-mcp-bridge/
├── cmd/
│   └── host/              # Go native host entry point
├── internal/
│   ├── server/            # WebSocket server
│   ├── browser/           # Browser automation logic
│   └── mcp/               # MCP protocol types
├── extension/
│   ├── manifest.json
│   ├── background.js      # WebSocket client
│   ├── popup.html         # Status UI
│   ├── popup.js           # Popup logic
│   └── popup.css
├── .github/workflows/     # CI/CD
├── Makefile               # Build automation
└── README.md
```

### Linting

Uses `staticcheck` v0.7.0:

```bash
make install-tools
make lint
```

---

## Security

- WebSocket server only binds to `127.0.0.1` (localhost)
- No external network access
- For Flatpak: browser cannot access host filesystem, only localhost network

## License

MIT

## Contributing

Pull requests welcome! Please run `make all` before submitting.
