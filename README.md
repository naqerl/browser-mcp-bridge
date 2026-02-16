# Browser MCP Bridge

Control your browser via HTTP MCP (Model Context Protocol). This tool exposes browser automation capabilities through an HTTP API that follows MCP conventions.

## Architecture

```
┌─────────────────┐      Native Messaging      ┌──────────────────┐
│  HTTP Clients   │◄──────────────────────────►│  Browser Ext     │
│  (MCP/Curl)     │                            │  (content script)│
└────────┬────────┘                            └────────┬─────────┘
         │                                              │
         │ HTTP (port 6277)                    ┌───────▼───────┐
         │                                       │  Web Pages    │
┌────────▼────────┐                            └───────────────┘
│  Native Host    │
│  (Python HTTP)  │
└─────────────────┘
```

## Components

1. **Browser Extension** - Runs in Chrome/Chromium/Brave/Edge, has full tab access
2. **Native Host** - Python HTTP server bridging MCP to the extension
3. **MCP Protocol** - Standard tool-based interface for automation

## Installation

### 1. Install Native Host

```bash
chmod +x install.sh
./install.sh
```

This installs the native messaging host manifest for your browsers.

### 2. Load Extension

1. Open Chrome/Chromium/Brave/Edge
2. Go to `chrome://extensions/`
3. Enable "Developer mode" (toggle top right)
4. Click "Load unpacked"
5. Select the `extension/` folder

### 3. Verify

The extension icon should appear. Click it to verify connection.

Test the HTTP server:
```bash
# Check health
curl http://localhost:6277/health

# List all tabs
curl http://localhost:6277/tabs

# Get page content
curl http://localhost:6277/tabs/123/content
```

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
| `browser_page_fill` | Fill input | `tab_id`, `selector`, `value` |
| `browser_page_scroll` | Scroll page | `tab_id`, `x`, `y` |
| `browser_page_execute` | Execute JS | `tab_id`, `script` |
| `browser_page_find` | Find elements | `tab_id`, `selector` |

## HTTP API Reference

### GET Endpoints

- `GET /health` - Server status
- `GET /mcp/info` - Available tools
- `GET /tabs` - List all tabs
- `GET /tabs/{id}/content` - Get page content
- `GET /tabs/{id}/screenshot` - Screenshot as base64

### POST Endpoints

- `POST /tabs` - Create new tab (`{"url": "..."}`)
- `POST /tabs/{id}/activate` - Focus tab
- `POST /tabs/{id}/navigate` - Navigate (`{"url": "..."}`)
- `POST /tabs/{id}/close` - Close tab
- `POST /tabs/{id}/execute` - Execute JS (`{"script": "..."}`)
- `POST /tabs/{id}/click` - Click element (`{"selector": "..."}`)
- `POST /tabs/{id}/fill` - Fill input (`{"selector": "...", "value": "..."}`)
- `POST /tabs/{id}/scroll` - Scroll (`{"x": 0, "y": 100}`)
- `POST /tabs/{id}/find` - Find elements (`{"selector": "..."}`)
- `POST /mcp/call/{tool}` - MCP tool invocation

## Usage Examples

### List Tabs
```bash
curl http://localhost:6277/tabs
```

### Navigate to URL
```bash
curl -X POST http://localhost:6277/tabs/123/navigate \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
```

### Click Element
```bash
curl -X POST http://localhost:6277/tabs/123/click \
  -H "Content-Type: application/json" \
  -d '{"selector": "button.submit"}'
```

### Fill Form
```bash
curl -X POST http://localhost:6277/tabs/123/fill \
  -H "Content-Type: application/json" \
  -d '{"selector": "input[name=search]", "value": "hello"}'
```

### MCP Tool Call
```bash
curl -X POST http://localhost:6277/mcp/call/browser_page_content \
  -H "Content-Type: application/json" \
  -d '{"tab_id": 123}'
```

## Surf Browser Support

For Surf browser (or other WebKit-based browsers), you may need to:

1. Check if the browser supports Chrome extensions
2. If not, use a WebKit extension format (different manifest)
3. Or use a proxy approach with `webkit2gtk` + custom extension

For pure Surf automation without extension support, consider:
- Using `xdotool` for keyboard/mouse automation
- Or running Surf with remote debugging: `surf -d` (if supported)

## Security Considerations

- The HTTP server only binds to localhost (127.0.0.1)
- Native messaging is restricted to the extension origin
- The extension has broad permissions (`<all_urls>`) - use carefully

## Troubleshooting

**Extension not connecting:**
- Check browser console for errors
- Verify native host manifest is installed in correct location
- Ensure Python 3 is available at `/usr/bin/env python3`

**HTTP server not responding:**
- Check if port 6277 is free: `lsof -i :6277`
- Verify extension is loaded and running
- Check native host stderr logs

**Permission errors:**
- The extension needs broad permissions for full automation
- Some actions may fail on restricted pages (chrome://, etc.)

## Development

### Project Structure
```
browser-mcp-bridge/
├── extension/
│   ├── manifest.json       # Extension manifest
│   ├── background.js       # Service worker
│   ├── content.js          # Content script
│   └── icon.svg            # Icon
├── native-host/
│   ├── host.py             # Native messaging host
│   └── com.browsermcp.host.json  # Native manifest template
├── install.sh              # Installation script
└── README.md
```

### Adding New Tools

1. Add method handler in `extension/background.js`
2. Add tool mapping in `native-host/host.py` MCPHandler.call_tool()
3. Update `/mcp/info` endpoint

## License

MIT
