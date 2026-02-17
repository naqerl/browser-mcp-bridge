// @ts-check
const { test: base, expect, chromium } = require('@playwright/test');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Configuration
const EXTENSION_PATH = path.join(__dirname, '..', 'extension');
const HOST_BINARY = path.join(__dirname, '..', 'native-host', 'host');
const MCP_PORT = 6278;
const MCP_URL = `http://localhost:${MCP_PORT}`;

// Custom test fixture that creates context with extension loaded once
const test = base.extend({
  // Launch browser with extension - shared across all tests in worker
  extContext: [async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
      ],
    });
    
    // Wait for service worker
    let [serviceWorker] = context.serviceWorkers();
    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent('serviceworker');
    }
    
    // Configure extension to use test port
    await serviceWorker.evaluate(async (port) => {
      if (typeof MCP !== 'undefined' && MCP.reconnect) {
        await MCP.reconnect(port);
      }
    }, MCP_PORT);
    
    // Wait for connection
    await new Promise(r => setTimeout(r, 3000));
    
    // Verify connection
    let connected = false;
    for (let i = 0; i < 10; i++) {
      try {
        const response = await fetch(`${MCP_URL}/health`);
        const health = await response.json();
        if (health.extension_connected) {
          connected = true;
          break;
        }
      } catch (e) {
        // Retry
      }
      await new Promise(r => setTimeout(r, 500));
    }
    
    console.log('Extension connected:', connected);
    
    await use(context);
    await context.close();
  }, { scope: 'worker' }],
});

// Helper for MCP HTTP calls
async function mcpCall(method, params = {}) {
  const response = await fetch(`${MCP_URL}/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method,
      params
    })
  });
  return await response.json();
}

// Helper for direct tool calls
async function callTool(name, args = {}) {
  return mcpCall('tools/call', { name, arguments: args });
}

// Helper to extract text from MCP result
function getResultText(result) {
  if (result.result && result.result.content && result.result.content[0]) {
    return result.result.content[0].text;
  }
  if (result.content && result.content[0]) {
    return result.content[0].text;
  }
  return null;
}

test.describe('Browser MCP Bridge - E2E Tests', () => {
  test.beforeAll(async () => {
    // Build host if needed
    if (!fs.existsSync(HOST_BINARY)) {
      console.log('Building host binary...');
      execSync('go build -o native-host/host ./cmd/host/', { 
        cwd: path.join(__dirname, '..'),
        stdio: 'inherit'
      });
    }

    // Wait for server (started by playwright webServer)
    let serverReady = false;
    for (let i = 0; i < 30; i++) {
      try {
        const response = await fetch(`${MCP_URL}/health`);
        if (response.ok) {
          serverReady = true;
          break;
        }
      } catch (e) {
        // Retry
      }
      await new Promise(r => setTimeout(r, 500));
    }
    
    if (!serverReady) {
      throw new Error('Server failed to start');
    }
    
    console.log('Server ready on port', MCP_PORT);
  });

  test.describe('Health & Connectivity', () => {
    test('health endpoint returns ok', async ({ extContext: context }) => {
      const page = context.pages()[0] || await context.newPage();
      const response = await page.request.get(`${MCP_URL}/health`);
      const data = await response.json();
      
      expect(data.status).toBe('ok');
    });

    test('MCP initialize returns correct protocol version', async () => {
      const result = await mcpCall('initialize', {});
      
      expect(result.jsonrpc).toBe('2.0');
      expect(result.result.protocolVersion).toBe('2024-11-05');
      expect(result.result.serverInfo.name).toBe('browser-mcp');
    });

    test('MCP tools/list returns all 11 tools', async () => {
      const result = await mcpCall('tools/list', {});
      
      expect(result.jsonrpc).toBe('2.0');
      expect(result.result.tools).toHaveLength(11);
      
      const toolNames = result.result.tools.map(t => t.name);
      expect(toolNames).toContain('browser_tabs_list');
      expect(toolNames).toContain('browser_tab_navigate');
      expect(toolNames).toContain('browser_tab_screenshot');
      expect(toolNames).toContain('browser_page_content');
      expect(toolNames).toContain('browser_page_click');
      expect(toolNames).toContain('browser_page_fill');
      expect(toolNames).toContain('browser_page_scroll');
      expect(toolNames).toContain('browser_page_execute');
      expect(toolNames).toContain('browser_page_find');
      expect(toolNames).toContain('browser_tab_activate');
      expect(toolNames).toContain('browser_tab_close');
    });
  });

  test.describe('Tab Management Tools', () => {
    test('browser_tabs_list returns array of tabs @smoke', async ({ extContext: context }) => {
      const result = await callTool('browser_tabs_list');
      
      expect(result.jsonrpc).toBe('2.0');
      
      const text = getResultText(result);
      expect(text).toBeDefined();
      
      // Parse the tab data
      const tabs = JSON.parse(text);
      expect(Array.isArray(tabs)).toBe(true);
      expect(tabs.length).toBeGreaterThanOrEqual(1);
      
      // Verify tab structure
      const tab = tabs[0];
      expect(tab).toHaveProperty('id');
      expect(tab).toHaveProperty('title');
      expect(tab).toHaveProperty('url');
      expect(tab).toHaveProperty('active');
    });

    test('browser_tab_navigate navigates to URL', async ({ extContext: context }) => {
      const page = context.pages()[0] || await context.newPage();
      
      // First get current tabs
      const listResult = await callTool('browser_tabs_list');
      const tabs = JSON.parse(getResultText(listResult));
      const activeTab = tabs.find(t => t.active) || tabs[0];
      
      // Navigate to example.com
      const result = await callTool('browser_tab_navigate', {
        tabId: activeTab.id,
        url: 'https://example.com'
      });
      
      expect(result.jsonrpc).toBe('2.0');
      
      const text = getResultText(result);
      expect(text).toContain('Navigated');
      
      // Wait for navigation and verify
      await page.waitForTimeout(2000);
      const currentUrl = page.url();
      expect(currentUrl).toContain('example.com');
    });

    test('browser_tab_activate switches tabs', async ({ extContext: context }) => {
      const page = context.pages()[0] || await context.newPage();
      
      // Open a new tab
      const newPage = await context.newPage();
      await newPage.goto('https://example.org');
      await page.waitForTimeout(1000);
      
      // Get tabs
      const listResult = await callTool('browser_tabs_list');
      const tabs = JSON.parse(getResultText(listResult));
      expect(tabs.length).toBeGreaterThanOrEqual(2);
      
      // Activate first tab
      const result = await callTool('browser_tab_activate', {
        tabId: tabs[0].id
      });
      
      expect(result.jsonrpc).toBe('2.0');
      
      const text = getResultText(result);
      expect(text).toContain('activated');
      
      await newPage.close();
    });

    test('browser_tab_close closes a tab', async ({ extContext: context }) => {
      const page = context.pages()[0] || await context.newPage();
      
      // Open a new tab to close
      const newPage = await context.newPage();
      await newPage.goto('about:blank');
      await page.waitForTimeout(1000);
      
      // Get initial tab count
      let listResult = await callTool('browser_tabs_list');
      const initialTabs = JSON.parse(getResultText(listResult));
      
      // Find and close the blank tab
      const blankTab = initialTabs.find(t => t.url === 'about:blank');
      if (blankTab) {
        const result = await callTool('browser_tab_close', {
          tabId: blankTab.id
        });
        
        expect(result.jsonrpc).toBe('2.0');
        
        const text = getResultText(result);
        expect(text).toContain('closed');
        
        // Verify tab count decreased
        await page.waitForTimeout(500);
        listResult = await callTool('browser_tabs_list');
        const finalTabs = JSON.parse(getResultText(listResult));
        expect(finalTabs.length).toBe(initialTabs.length - 1);
      }
    });
  });

  test.describe('Page Interaction Tools', () => {
    test('browser_page_content returns page data', async ({ extContext: context }) => {
      const page = context.pages()[0] || await context.newPage();
      
      // Navigate to a test page (use real URL for extension permissions)
      await page.goto('https://example.com');
      await page.waitForTimeout(1000);
      
      // Get tab ID
      const listResult = await callTool('browser_tabs_list');
      const tabs = JSON.parse(getResultText(listResult));
      const activeTab = tabs.find(t => t.active);
      
      // Get page content
      const result = await callTool('browser_page_content', {
        tabId: activeTab.id
      });
      
      expect(result.jsonrpc).toBe('2.0');
      
      const text = getResultText(result);
      const content = JSON.parse(text);
      expect(content).toHaveProperty('title');
      expect(content).toHaveProperty('url');
      expect(content).toHaveProperty('text');
      expect(content).toHaveProperty('html');
      expect(content).toHaveProperty('links');
    });

    test('browser_page_find finds elements', async ({ extContext: context }) => {
      const page = context.pages()[0] || await context.newPage();
      
      await page.goto('https://example.com');
      await page.waitForTimeout(1000);
      
      const listResult = await callTool('browser_tabs_list');
      const tabs = JSON.parse(getResultText(listResult));
      const activeTab = tabs.find(t => t.active);
      
      // Find all paragraphs
      const result = await callTool('browser_page_find', {
        tabId: activeTab.id,
        selector: 'p'
      });
      
      expect(result.jsonrpc).toBe('2.0');
      
      const text = getResultText(result);
      const findResult = JSON.parse(text);
      expect(findResult).toHaveProperty('count');
      expect(findResult).toHaveProperty('elements');
      expect(typeof findResult.count).toBe('number');
    });

    test.skip('browser_page_click clicks elements', async ({ extContext: context }) => {
      // SKIPPED: Requires page without CSP or special permissions
      // CSP on most websites blocks the extension's executeScript approach
      const page = context.pages()[0] || await context.newPage();
      
      // Navigate to a real page first (extension needs real URL for permissions)
      await page.goto('https://example.com');
      await page.waitForTimeout(500);
      
      // Inject test content via script (since setContent creates data: URL)
      await page.evaluate(() => {
        document.body.innerHTML = '<button id="test-btn" onclick="window.clicked = true">Click Me</button>';
      });
      await page.waitForTimeout(500);
      
      const listResult = await callTool('browser_tabs_list');
      const tabs = JSON.parse(getResultText(listResult));
      const activeTab = tabs.find(t => t.active);
      
      // Click the button
      const result = await callTool('browser_page_click', {
        tabId: activeTab.id,
        selector: '#test-btn'
      });
      
      expect(result.jsonrpc).toBe('2.0');
      
      const text = getResultText(result);
      expect(text).toContain('Clicked');
      
      // Verify click happened
      const clicked = await page.evaluate(() => window.clicked);
      expect(clicked).toBe(true);
    });

    test.skip('browser_page_fill fills input fields', async ({ extContext: context }) => {
      // SKIPPED: Requires page without CSP or special permissions
      const page = context.pages()[0] || await context.newPage();
      
      // Navigate to a real page first
      await page.goto('https://example.com');
      await page.waitForTimeout(500);
      
      // Inject test content
      await page.evaluate(() => {
        document.body.innerHTML = '<input id="test-input" type="text" />';
      });
      await page.waitForTimeout(500);
      
      const listResult = await callTool('browser_tabs_list');
      const tabs = JSON.parse(getResultText(listResult));
      const activeTab = tabs.find(t => t.active);
      
      // Fill the input
      const result = await callTool('browser_page_fill', {
        tabId: activeTab.id,
        selector: '#test-input',
        value: 'Hello World'
      });
      
      expect(result.jsonrpc).toBe('2.0');
      
      const text = getResultText(result);
      expect(text).toContain('Filled');
      
      // Verify value was set
      const value = await page.inputValue('#test-input');
      expect(value).toBe('Hello World');
    });

    test('browser_page_scroll scrolls the page', async ({ extContext: context }) => {
      const page = context.pages()[0] || await context.newPage();
      
      // Navigate to a real page first
      await page.goto('https://example.com');
      await page.waitForTimeout(500);
      
      // Make page tall via script
      await page.evaluate(() => {
        document.body.style.height = '2000px';
      });
      await page.waitForTimeout(500);
      
      const listResult = await callTool('browser_tabs_list');
      const tabs = JSON.parse(getResultText(listResult));
      const activeTab = tabs.find(t => t.active);
      
      // Scroll down
      const result = await callTool('browser_page_scroll', {
        tabId: activeTab.id,
        x: 0,
        y: 500
      });
      
      expect(result.jsonrpc).toBe('2.0');
      
      const text = getResultText(result);
      expect(text).toContain('Scrolled');
    });

    test.skip('browser_page_execute runs JavaScript', async ({ extContext: context }) => {
      // SKIPPED: CSP on most websites blocks eval() used by executeScript
      const page = context.pages()[0] || await context.newPage();
      
      // Navigate to a real page (extension can't execute on about:blank)
      await page.goto('https://example.com');
      await page.waitForTimeout(500);
      
      const listResult = await callTool('browser_tabs_list');
      const tabs = JSON.parse(getResultText(listResult));
      const activeTab = tabs.find(t => t.active);
      
      // Execute script
      const result = await callTool('browser_page_execute', {
        tabId: activeTab.id,
        script: 'return { url: window.location.href, title: document.title }'
      });
      
      expect(result.jsonrpc).toBe('2.0');
      
      const text = getResultText(result);
      const execResult = JSON.parse(text);
      expect(execResult).toHaveProperty('url');
      expect(execResult).toHaveProperty('title');
    });

    test('browser_tab_screenshot takes screenshot', async ({ extContext: context }) => {
      const page = context.pages()[0] || await context.newPage();
      
      await page.goto('https://example.com');
      await page.waitForTimeout(1000);
      
      const listResult = await callTool('browser_tabs_list');
      const tabs = JSON.parse(getResultText(listResult));
      const activeTab = tabs.find(t => t.active);
      
      // Take screenshot
      const result = await callTool('browser_tab_screenshot', {
        tabId: activeTab.id
      });
      
      expect(result.jsonrpc).toBe('2.0');
      
      // Should return base64 data URL
      const text = getResultText(result);
      expect(text).toContain('data:image');
      expect(text).toContain('base64');
    });
  });

  test.describe('Error Handling', () => {
    test('returns error for unknown tool', async () => {
      const result = await callTool('unknown_tool');
      
      expect(result.jsonrpc).toBe('2.0');
      expect(result.error).toBeDefined();
      expect(result.error.message).toContain('unknown tool');
    });

    test('returns error for invalid tab ID', async () => {
      const result = await callTool('browser_tab_navigate', {
        tabId: 999999999,
        url: 'https://example.com'
      });
      
      expect(result.jsonrpc).toBe('2.0');
      // Should either return error or result with error message
      const hasError = result.error || 
        (result.result && result.result.isError) ||
        (getResultText(result) && getResultText(result).toLowerCase().includes('error'));
      expect(hasError).toBeTruthy();
    });

    test('returns error for malformed JSON-RPC request', async () => {
      const response = await fetch(`${MCP_URL}/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json'
      });
      
      expect(response.status).toBe(400);
    });

    test('handles missing tool parameters gracefully', async () => {
      const result = await callTool('browser_tab_navigate', {});
      
      expect(result.jsonrpc).toBe('2.0');
      // Should handle missing params gracefully
      expect(result.result || result.error).toBeDefined();
    });
  });

  test.describe('Connection Stability', () => {
    test('handles rapid successive tool calls', async () => {
      // Make rapid calls sequentially (not parallel) to avoid overwhelming
      const results = [];
      for (let i = 0; i < 3; i++) {
        const result = await callTool('browser_tabs_list');
        results.push(result);
        await new Promise(r => setTimeout(r, 100)); // Small delay between calls
      }
      
      // All should succeed
      results.forEach(result => {
        expect(result.jsonrpc).toBe('2.0');
        expect(result.result).toBeDefined();
      });
    });

    test('maintains connection across multiple operations', async ({ extContext: context }) => {
      const [sw] = context.serviceWorkers();
      
      // Perform multiple operations
      await callTool('browser_tabs_list');
      await callTool('browser_tabs_list');
      await callTool('browser_tabs_list');
      
      // Check still connected
      const status = await sw.evaluate(() => MCP.getStatus());
      expect(status.connected).toBe(true);
    });
  });

  test.describe('Tool Schema Validation', () => {
    test('all tools have required fields', async () => {
      const result = await mcpCall('tools/list', {});
      
      expect(result.result.tools).toBeDefined();
      
      for (const tool of result.result.tools) {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
        expect(tool.name).toMatch(/^browser_/);
      }
    });

    test('tool names match expected pattern', async () => {
      const result = await mcpCall('tools/list', {});
      const toolNames = result.result.tools.map(t => t.name);
      
      const expectedPrefixes = ['browser_tabs_', 'browser_tab_', 'browser_page_'];
      
      for (const name of toolNames) {
        const hasValidPrefix = expectedPrefixes.some(prefix => name.startsWith(prefix));
        expect(hasValidPrefix).toBe(true);
      }
    });
  });

  test.describe('Edge Cases', () => {
    test('handles empty tabs list gracefully', async ({ extContext: context }) => {
      // Get tabs and verify structure even with single tab
      const result = await callTool('browser_tabs_list');
      const tabs = JSON.parse(getResultText(result));
      
      expect(Array.isArray(tabs)).toBe(true);
      if (tabs.length > 0) {
        expect(tabs[0]).toHaveProperty('id');
        expect(tabs[0]).toHaveProperty('url');
      }
    });

    test('handles navigation to same URL', async ({ extContext: context }) => {
      const page = context.pages()[0] || await context.newPage();
      
      // Navigate once
      await page.goto('https://example.com');
      await page.waitForTimeout(500);
      
      const listResult = await callTool('browser_tabs_list');
      const tabs = JSON.parse(getResultText(listResult));
      const activeTab = tabs.find(t => t.active);
      
      // Navigate to same URL again
      const result = await callTool('browser_tab_navigate', {
        tabId: activeTab.id,
        url: 'https://example.com'
      });
      
      expect(result.jsonrpc).toBe('2.0');
      expect(result.result).toBeDefined();
    });

    test('screenshot returns valid base64 format', async ({ extContext: context }) => {
      const page = context.pages()[0] || await context.newPage();
      
      await page.goto('https://example.com');
      await page.waitForTimeout(500);
      
      const listResult = await callTool('browser_tabs_list');
      const tabs = JSON.parse(getResultText(listResult));
      const activeTab = tabs.find(t => t.active);
      
      const result = await callTool('browser_tab_screenshot', {
        tabId: activeTab.id
      });
      
      const text = getResultText(result);
      
      // Validate base64 image format (could be png or jpeg)
      expect(text).toMatch(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/);
    });
  });

  test.describe('Direct HTTP Endpoints', () => {
    test('GET /tabs returns tabs array', async ({ extContext: context }) => {
      const page = context.pages()[0] || await context.newPage();
      const response = await page.request.get(`${MCP_URL}/tabs`);
      const data = await response.json();
      
      expect(Array.isArray(data.tabs)).toBe(true);
      expect(data.tabs.length).toBeGreaterThanOrEqual(1);
    });

    test('GET /mcp/info returns server info', async ({ extContext: context }) => {
      const page = context.pages()[0] || await context.newPage();
      const response = await page.request.get(`${MCP_URL}/mcp/info`);
      const data = await response.json();
      
      expect(data.name).toBe('browser-mcp');
      expect(data.version).toBe('1.0.0');
    });

    test('GET /health returns status', async ({ extContext: context }) => {
      const page = context.pages()[0] || await context.newPage();
      const response = await page.request.get(`${MCP_URL}/health`);
      const data = await response.json();
      
      expect(data.status).toBe('ok');
      expect(typeof data.extension_connected).toBe('boolean');
    });
  });
});
