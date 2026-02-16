# Browser MCP Bridge

Control your browser via WebSocket MCP (Model Context Protocol). A Go-native host with a Chrome extension for browser automation.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Browser Extension                       │
│  ┌─────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │  Popup UI   │◄──►│  Background  │◄──►│ Content      │  │
│  │  (status)   │    │  (WebSocket) │    │ Script       │  │
│  └─────────────┘    └──────┬───────┘    └──────────────┘  │
└─────────────────────────────┼───────────────────────────────┘
                              │ WebSocket
┌─────────────────────────────┼───────────────────────────────┐
│  Go Native Host             │                               │
│  ┌──────────────────────────┴──┐                            │
│  │  WebSocket Server           │                            │
│  │  - MCP message routing      │                            │
│  │  - Request/response handling│                            │
│  └─────────────────────────────┘                            │
└─────────────────────────────────────────────────────────────┘
        ▲
        │ Native Messaging (stdio)
        ▼
┌─────────────────────────────────────────────────────────────┐
│  Chrome/Chromium/Brave/Edge                                 │
└─────────────────────────────────────────────────────────────┘
```

## Features

- **WebSocket Communication**: Real-time bidirectional messaging between Go host and extension
- **MCP Protocol**: Standard Model Context Protocol for tool invocation
- **Popup UI**: Visual status, errors, and active operations
- **Cross-Platform**: Linux (amd64/arm64), macOS (amd64/arm64), Windows (amd64)
- **Static Binary**: Single binary distribution, no runtime dependencies

## Quick Start

### Option 1: Download Pre-built Release

1. Download the latest release for your platform from [Releases](https://github.com/naqerl/browser-mcp-bridge/releases)
2. Extract the zip file
3. Run the installer:
   ```bash
   chmod +x install.sh
   ./install.sh
   ```
4. Load the extension in Chrome:
   - Go to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `extension` folder

### Option 2: Build from Source

**Prerequisites:** Go 1.21+

```bash
git clone https://github.com/naqerl/browser-mcp-bridge.git
cd browser-mcp-bridge

# Install tools
make install-tools

# Build
make all  # lint + build

# Or build for specific platform
make build-linux
make build-darwin
make build-windows

# Install native host
./install.sh
```

## Usage

Once installed, the extension icon will show the connection status. Click it to see:
- Connection status (green = ready)
- Active operations
- Recent errors
- Recent logs

The Go host binary starts automatically when the browser loads the extension. It:
1. Launches via native messaging
2. Starts a WebSocket server on an ephemeral port
3. Notifies the extension of the port
4. Handles MCP requests

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

The Go host exposes a WebSocket endpoint at `ws://127.0.0.1:<port>/ws`

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
curl http://localhost:<port>/health
```

Response:
```json
{
  "status": "ok",
  "extension_connected": true
}
```

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
├── native-host/
│   └── com.browsermcp.host.json  # Native manifest
├── .github/workflows/
│   └── release.yml        # CI/CD
├── Makefile               # Build automation
├── go.mod
├── install.sh
└── README.md
```

### Makefile Targets

| Target | Description |
|--------|-------------|
| `make all` | Lint + build for current platform |
| `make build` | Build for current platform |
| `make build-all` | Cross-compile all platforms |
| `make lint` | Run staticcheck and go vet |
| `make install-tools` | Install staticcheck v0.7.0 |
| `make test` | Run tests |
| `make clean` | Clean build artifacts |
| `make package` | Create distribution zips |

### Linting

Uses `staticcheck` v0.7.0 for Go linting:

```bash
make install-tools  # One-time setup
make lint           # Run linter
```

## Troubleshooting

### Extension shows "Disconnected"

1. Check that the native host is installed:
   ```bash
   ls ~/.config/google-chrome/NativeMessagingHosts/com.browsermcp.host.json
   ```
2. Check the path in the manifest points to the binary
3. Open browser console (F12) → Service Worker → look for errors
4. Click extension icon → check error logs

### WebSocket connection fails

1. Check if binary runs manually:
   ```bash
   ./extension/host/browser-mcp-host
   ```
2. Check firewall settings (should allow localhost)
3. Extension popup shows connection attempts

### Build errors

Ensure Go 1.21+ is installed:
```bash
go version
```

## Security

- WebSocket server only binds to `127.0.0.1` (localhost)
- Native messaging is restricted to the extension origin
- No external network access required

## License

MIT

## Contributing

Pull requests welcome! Please run `make all` before submitting.
