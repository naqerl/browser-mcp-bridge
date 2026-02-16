# MCP Setup for Kimi

This browser MCP bridge supports multiple transport methods for connecting to Kimi.

## Quick Start

1. **Start the browser host:**
   ```bash
   ./native-host/host
   ```

2. **Load the browser extension** in your browser (Chrome/Brave/Chromium)

3. **Kimi will automatically connect** via the configured transport

## Transport Options

### Option 1: SSE (Server-Sent Events) - Recommended

Uses HTTP SSE for real-time bidirectional communication.

**Configuration:** `~/.config/kimi/mcp.json`
```json
{
  "mcpServers": {
    "browser": {
      "transport": "sse",
      "url": "http://localhost:6277/sse",
      "enabled": true
    }
  }
}
```

**Pros:**
- Works with remote connections
- Auto-reconnection support
- HTTP-compatible

### Option 2: stdio (Native Messaging)

Kimi launches the host binary directly and communicates via stdin/stdout.

**Configuration:** `~/.config/kimi/mcp_stdio.json`
```json
{
  "mcpServers": {
    "browser": {
      "command": "/path/to/browser-mcp-bridge/native-host/host",
      "args": [],
      "enabled": true
    }
  }
}
```

**Pros:**
- Kimi manages the process lifecycle
- No need to manually start the host

### Option 3: HTTP POST

Direct HTTP calls to MCP endpoints.

**Configuration:** `~/.config/kimi/mcp_http.json`
```json
{
  "mcpServers": {
    "browser": {
      "url": "http://localhost:6277/mcp/call/",
      "enabled": true
    }
  }
}
```

## Available Tools

Once connected, Kimi can use these tools:

| Tool | Purpose |
|------|---------|
| `browser_tabs_list` | List all open tabs |
| `browser_tab_activate` | Focus a specific tab |
| `browser_tab_navigate` | Navigate to URL |
| `browser_tab_close` | Close a tab |
| `browser_tab_screenshot` | Take screenshot |
| `browser_page_content` | Get page HTML/text |
| `browser_page_click` | Click element |
| `browser_page_fill` | Fill input field |
| `browser_page_scroll` | Scroll page |
| `browser_page_execute` | Run JavaScript |
| `browser_page_find` | Find elements |

## Testing

```bash
# Test HTTP endpoints
curl http://localhost:6277/health
curl http://localhost:6277/mcp/info

# Test SSE
curl -N http://localhost:6277/sse

# List tabs (requires extension connected)
curl http://localhost:6277/tabs
```

## Troubleshooting

**"Extension not connected" error:**
- Make sure the browser extension is loaded
- Check that the extension icon shows "Connected"
- Reload the extension if needed

**"Connection refused" error:**
- Make sure `./native-host/host` is running
- Check port 6277 is not in use: `lsof -i :6277`

**Flatpak browser issues:**
- Flatpak browsers work via WebSocket on port 6277
- No special permissions needed
- Just start the host and load the extension
