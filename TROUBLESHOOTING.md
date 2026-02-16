# Browser MCP Bridge - Troubleshooting

## Quick Status Check

```bash
# Check everything
browser-mcp-status

# View logs
browser-mcp-logs

# Run tests
browser-mcp-test
```

## Common Issues

### 1. Kimi Shows "Failed to Connect"

**Symptoms:**
- `kimi mcp list` shows browser as failed
- `browser_tabs_list` hangs

**Check:**
```bash
# 1. Is the service running?
systemctl --user status browser-mcp

# 2. Is the port listening?
curl http://localhost:6277/health

# 3. Is the extension connected?
# Check if response shows "extension_connected":true
```

**Solution:**
1. Make sure the service is running:
   ```bash
   systemctl --user start browser-mcp
   ```

2. Reload the browser extension:
   - Open `brave://extensions/` (or `chrome://extensions/`)
   - Find "Browser MCP Bridge"
   - Click the refresh icon
   - Click the extension icon - should show "Connected"

### 2. Extension Not Connecting

**Symptoms:**
- Extension popup shows "Not connected"
- `extension_connected` is false in health check

**Check:**
```bash
# Check WebSocket endpoint
websocat ws://localhost:6277/ws 2>&1 || echo "WebSocket not available"

# Check logs
journalctl --user -u browser-mcp -n 50
```

**Solution:**
1. Check if port 6277 is blocked:
   ```bash
   sudo ss -tlnp | grep 6277
   ```

2. Try restarting the service:
   ```bash
   systemctl --user restart browser-mcp
   ```

3. Check extension console:
   - Open browser developer tools on any page
   - Look for `[BrowserMCP]` logs
   - Check for WebSocket connection errors

### 3. Tools Timeout

**Symptoms:**
- `browser_tabs_list` takes forever
- No response from tool calls

**Cause:** Extension not connected - the Go server waits for the extension to respond.

**Solution:** Same as #2 - ensure extension is connected.

### 4. Port Already in Use

**Symptoms:**
- Service fails to start
- Log shows "bind: address already in use"

**Solution:**
```bash
# Kill existing processes
pkill -f browser-mcp-host
pkill -f native-host/host

# Restart service
systemctl --user restart browser-mcp
```

## Debugging with Kimi CLI

```bash
# Test MCP connection
kimi mcp test browser

# List available tools
kimi mcp list

# Use kimi interactively
kimi
# Then type: "List my browser tabs"
```

## Service Management

```bash
# Start/stop/restart
systemctl --user start browser-mcp
systemctl --user stop browser-mcp
systemctl --user restart browser-mcp

# Enable auto-start
systemctl --user enable browser-mcp

# View logs
journalctl --user -u browser-mcp -f

# Check status
systemctl --user status browser-mcp
```

## Extension Debugging

1. **Open extension popup** - click the extension icon
2. **Check for errors** in the popup
3. **Open browser console** (F12) and look for `[BrowserMCP]` logs
4. **Reload extension** if needed:
   - `brave://extensions/`
   - Toggle Developer Mode
   - Click refresh on Browser MCP Bridge

## Direct HTTP Testing

```bash
# Health
curl http://localhost:6277/health

# MCP Initialize
curl -X POST http://localhost:6277/ \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize"}'

# List tools
curl -X POST http://localhost:6277/ \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# Call tool (requires extension connected)
curl -X POST http://localhost:6277/ \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"browser_tabs_list","arguments":{}}}'
```

## Still Having Issues?

1. Check the logs: `browser-mcp-logs`
2. Run tests: `browser-mcp-test`
3. Verify extension is loaded and showing "Connected"
4. Try reloading the extension
5. Restart the service: `systemctl --user restart browser-mcp`
