# Problem

Refactor Browser MCP Bridge from Python/HTTP architecture to Go/WebSocket architecture with improved tooling:

1. **Current**: Python native host with HTTP server, no UI feedback
2. **Target**: Go native binary with WebSocket communication, popup UI for status, automated CI/CD builds

# Solution

## Architecture Change
```
Old: Extension → Native Messaging → Python HTTP Server → HTTP Clients
New: Extension ←→ WebSocket ←→ Go Binary (embedded in extension)
```

## Key Decisions
1. **Go 1.21+** for native binary (single static binary, easy distribution)
2. **WebSocket** for bidirectional real-time communication between extension and Go host
3. **Native messaging** still used for initial handshake/binary launch
4. **Extension popup** for status/errors using standard HTML/JS
5. **GitHub Actions** workflow triggered on tag push to main
6. **Makefile** for consistent local and CI builds
7. **staticcheck v0.7.0** for Go linting

## File Structure
```
browser-mcp-bridge/
├── cmd/
│   └── host/              # Go native host entry point
├── internal/
│   ├── server/            # WebSocket server
│   ├── browser/           # Browser automation logic
│   └── mcp/               # MCP protocol implementation
├── extension/
│   ├── manifest.json
│   ├── background.js      # WebSocket client + native messaging
│   ├── popup.html         # Status UI
│   ├── popup.js           # Popup logic
│   └── host/              # Compiled Go binaries (gitignored, CI-populated)
├── .github/
│   └── workflows/
│       └── release.yml    # Build on tag push
├── Makefile               # Build targets
├── go.mod
└── go.sum
```

# Tasks

## Phase 1: Setup Go Project Structure
- [ ] Initialize Go module (`go mod init github.com/naqerl/browser-mcp-bridge`)
- [ ] Create directory structure (`cmd/host`, `internal/server`, `internal/browser`, `internal/mcp`)
- [ ] Create `Makefile` with targets: `build`, `lint`, `install-tools`, `clean`, `all`
  - [ ] `make install-tools`: installs staticcheck v0.7.0 via `go install`
  - [ ] `make lint`: runs staticcheck on all packages
  - [ ] `make build`: compiles `cmd/host` to `extension/host/browser-mcp-host`
  - [ ] `make build-linux`, `make build-darwin`, `make build-windows` for cross-compilation
  - [ ] `make all`: lint + build
- [ ] Add `go.mod` with dependencies: `gorilla/websocket`, `chromedp` (optional for headless)

## Phase 2: Go Native Host Implementation
- [ ] `internal/server/websocket.go`: WebSocket server implementation
  - [ ] Upgrader to handle WebSocket connections from extension
  - [ ] Message router for MCP commands
  - [ ] Connection state management
- [ ] `internal/browser/controller.go`: Browser automation interface
  - [ ] Tab listing, navigation, screenshot methods
  - [ ] Script execution wrapper
  - [ ] Error handling
- [ ] `internal/mcp/protocol.go`: MCP protocol types and handlers
  - [ ] Request/Response message structs
  - [ ] Tool definitions (tabs/list, tabs/navigate, etc.)
- [ ] `cmd/host/main.go`: Entry point
  - [ ] Native messaging handshake
  - [ ] Start WebSocket server on ephemeral port
  - [ ] Send port back to extension via native messaging
  - [ ] Keep-alive and graceful shutdown

## Phase 3: Extension Refactoring
- [ ] Update `extension/manifest.json`
  - [ ] Add `action` key for popup
  - [ ] Keep native messaging permissions
- [ ] Rewrite `extension/background.js`
  - [ ] Native messaging to launch Go binary
  - [ ] Receive WebSocket port from binary
  - [ ] Connect WebSocket client
  - [ ] Handle reconnection logic
  - [ ] Expose MCP methods via message passing
- [ ] Create `extension/popup.html`
  - [ ] Connection status indicator
  - [ ] Active operations list
  - [ ] Error display area
  - [ ] Basic styling
- [ ] Create `extension/popup.js`
  - [ ] Query background script for status
  - [ ] Display connection state
  - [ ] Show recent errors/logs
- [ ] Create `extension/popup.css`
  - [ ] Clean, minimal styling
  - [ ] Status colors (green/red/yellow)

## Phase 4: GitHub Actions CI/CD
- [ ] Create `.github/workflows/release.yml`
  - [ ] Trigger: `push` to `main` with tags matching `v*`
  - [ ] Jobs:
    - [ ] Lint: run `make lint`
    - [ ] Build matrix: Linux (amd64, arm64), macOS (amd64, arm64), Windows (amd64)
    - [ ] For each platform: compile binary, package extension with binary
    - [ ] Create GitHub Release with all artifacts
- [ ] Update native host manifest template to point to correct binary path

## Phase 5: Documentation and Polish
- [ ] Update `README.md` with new architecture
- [ ] Update `install.sh` or replace with manual instructions
- [ ] Delete old Python code (`native-host/host.py`, `example_client.py`)
- [ ] Add `.gitignore` for Go binaries and build artifacts
- [ ] Test end-to-end locally with `make all`
- [ ] Commit and push, verify CI works
