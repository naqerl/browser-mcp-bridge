# Browser MCP Bridge - E2E Tests

This directory contains Playwright-based end-to-end (E2E) tests for the Browser MCP Bridge.

## Test Coverage

### Health & Connectivity
- ✅ Health endpoint returns correct status
- ✅ MCP initialize returns correct protocol version
- ✅ MCP tools/list returns all 11 tools
- ✅ Extension connection detection

### Tab Management Tools
- ✅ `browser_tabs_list` - Returns array of tabs with ID, title, URL, status
- ✅ `browser_tab_navigate` - Navigates tab to specified URL
- ✅ `browser_tab_activate` - Switches to specified tab
- ✅ `browser_tab_close` - Closes specified tab

### Page Interaction Tools
- ✅ `browser_page_content` - Returns page HTML, text, links
- ✅ `browser_page_find` - Finds elements by CSS selector
- ✅ `browser_page_click` - Clicks elements
- ✅ `browser_page_fill` - Fills input fields
- ✅ `browser_page_scroll` - Scrolls page to coordinates
- ✅ `browser_page_execute` - Executes JavaScript
- ✅ `browser_tab_screenshot` - Takes screenshots (base64)

### Error Handling
- ✅ Unknown tool returns error
- ✅ Disconnected extension handling

### Direct HTTP Endpoints
- ✅ GET /tabs returns tabs array
- ✅ GET /mcp/info returns server info
- ✅ GET /health returns status

## Running Tests

### Prerequisites

1. Install dependencies:
```bash
npm install
npx playwright install chromium
```

2. Build the host binary:
```bash
go build -o native-host/host ./cmd/host/
# or
make build
```

### Run All Tests

```bash
npm test
# or
npx playwright test
```

### Run Specific Test

```bash
npx playwright test --grep "browser_tabs_list"
```

### Run with UI

```bash
npm run test:ui
```

### Run in Debug Mode

```bash
npm run test:debug
```

### Run with Browser Visible

```bash
npm run test:headed
```

## Test Structure

```
tests/
├── mcp-e2e.spec.js    # Main E2E test suite
├── README.md           # This file
└── ...
```

## How Tests Work

1. **Before All**: Builds and starts the Go MCP host binary
2. **Before Each**: Launches Chromium with the extension loaded
3. **Tests**: Makes MCP tool calls via HTTP and verifies responses
4. **After Each**: Closes browser context
5. **After All**: Stops the MCP host

## Writing New Tests

Example test pattern:

```javascript
test('browser_tool_name does something', async ({ page }) => {
  // Get active tab ID
  const listResult = await callTool('browser_tabs_list');
  const tabs = JSON.parse(listResult.result.content[0].text);
  const activeTab = tabs.find(t => t.active);
  
  // Call the tool
  const result = await callTool('browser_tool_name', {
    tab_id: activeTab.id,
    // other params
  });
  
  // Verify response
  expect(result.jsonrpc).toBe('2.0');
  expect(result.result.content[0].text).toContain('expected');
  
  // Verify browser state
  const element = await page.locator('#selector');
  await expect(element).toHaveText('expected');
});
```

## CI/CD

Tests run automatically on GitHub Actions for:
- Every push to main/master
- Every pull request

Test reports are uploaded as artifacts.

## Troubleshooting

### Extension not connecting
- Ensure extension is built and files exist in `extension/` directory
- Check that manifest.json is valid
- Look at test output for extension errors

### Host binary not found
- Run `make build` or `go build -o native-host/host ./cmd/host/`

### Tests timing out
- Increase timeout in `playwright.config.js`
- Check if extension is loading properly

### Port already in use
- Kill existing host process: `pkill -f browser-mcp-host`
- Or use different port in tests
