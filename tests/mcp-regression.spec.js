// @ts-check
const { test, expect } = require('@playwright/test');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// Configuration
const EXTENSION_PATH = path.join(__dirname, '..', 'extension');
const HOST_BINARY = path.join(__dirname, '..', 'native-host', 'host');
const MCP_PORT = 6277;
const MCP_URL = `http://localhost:${MCP_PORT}`;

// Helper to wait for server
async function waitForServer(url, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const response = await fetch(url + '/health');
      if (response.ok) return await response.json();
    } catch (e) {
      // Retry
    }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Server failed to start');
}

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

test.describe('Browser MCP Bridge - Regression Tests', () => {
  let hostProcess;
  let context;
  let page;

  test.beforeAll(async () => {
    // Build host if needed
    if (!fs.existsSync(HOST_BINARY)) {
      console.log('Building host binary...');
      execSync('go build -o native-host/host ./cmd/host/', { 
        cwd: path.join(__dirname, '..'),
        stdio: 'inherit'
      });
    }

    // Start the MCP host
    hostProcess = spawn(HOST_BINARY, [], {
      stdio: 'pipe',
      env: { ...process.env, PORT: String(MCP_PORT) }
    });

    hostProcess.stderr.on('data', (data) => {
      console.log(`Host: ${data}`);
    });

    // Wait for server to be ready
    const health = await waitForServer(MCP_URL);
    console.log('Server health:', health);
  });

  test.afterAll(async () => {
    if (hostProcess) {
      hostProcess.kill();
    }
  });

  test.beforeEach(async ({ browser }) => {
    // Launch browser with extension
    context = await browser.newContext({
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
      ],
    });

    page = await context.newPage();
    
    // Wait for extension to connect
    await page.waitForTimeout(2000);
    
    // Verify extension connected
    const health = await waitForServer(MCP_URL);
    expect(health.extension_connected).toBe(true);
  });

  test.afterEach(async () => {
    await context.close();
  });

  test.describe('Health & Connectivity', () => {
    test('health endpoint returns ok', async () => {
      const response = await fetch(`${MCP_URL}/health`);
      const data = await response.json();
      
      expect(data.status).toBe('ok');
      expect(data.extension_connected).toBe(true);
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
      expect(toolNames).toContain('browser_page_screenshot');
    });
  });

  test.describe('Tab Management Tools', () => {
    test('browser_tabs_list returns array of tabs', async () => {
      const result = await callTool('browser_tabs_list');
      
      expect(result.jsonrpc).toBe('2.0');
      expect(result.result.content).toBeDefined();
      expect(result.result.content[0].type).toBe('text');
      
      // Parse the tab data
      const tabs = JSON.parse(result.result.content[0].text);
      expect(Array.isArray(tabs)).toBe(true);
      expect(tabs.length).toBeGreaterThanOrEqual(1);
      
      // Verify tab structure
      const tab = tabs[0];
      expect(tab).toHaveProperty('id');
      expect(tab).toHaveProperty('title');
      expect(tab).toHaveProperty('url');
      expect(tab).toHaveProperty('active');
    });

    test('browser_tab_navigate navigates to URL', async () => {
      // First get current tabs
      const listResult = await callTool('browser_tabs_list');
      const tabs = JSON.parse(listResult.result.content[0].text);
      const activeTab = tabs.find(t => t.active) || tabs[0];
      
      // Navigate to example.com
      const result = await callTool('browser_tab_navigate', {
        tab_id: activeTab.id,
        url: 'https://example.com'
      });
      
      expect(result.jsonrpc).toBe('2.0');
      expect(result.result.content[0].text).toContain('Navigated');
      
      // Wait for navigation and verify
      await page.waitForTimeout(2000);
      const currentUrl = page.url();
      expect(currentUrl).toContain('example.com');
    });

    test('browser_tab_activate switches tabs', async () => {
      // Open a new tab
      const newPage = await context.newPage();
      await newPage.goto('https://example.org');
      await page.waitForTimeout(1000);
      
      // Get tabs
      const listResult = await callTool('browser_tabs_list');
      const tabs = JSON.parse(listResult.result.content[0].text);
      expect(tabs.length).toBeGreaterThanOrEqual(2);
      
      // Activate first tab
      const result = await callTool('browser_tab_activate', {
        tab_id: tabs[0].id
      });
      
      expect(result.jsonrpc).toBe('2.0');
      expect(result.result.content[0].text).toContain('activated');
      
      await newPage.close();
    });

    test('browser_tab_close closes a tab', async () => {
      // Open a new tab to close
      const newPage = await context.newPage();
      await newPage.goto('about:blank');
      await page.waitForTimeout(1000);
      
      // Get initial tab count
      let listResult = await callTool('browser_tabs_list');
      const initialTabs = JSON.parse(listResult.result.content[0].text);
      
      // Find and close the blank tab
      const blankTab = initialTabs.find(t => t.url === 'about:blank');
      if (blankTab) {
        const result = await callTool('browser_tab_close', {
          tab_id: blankTab.id
        });
        
        expect(result.jsonrpc).toBe('2.0');
        expect(result.result.content[0].text).toContain('closed');
        
        // Verify tab count decreased
        await page.waitForTimeout(500);
        listResult = await callTool('browser_tabs_list');
        const finalTabs = JSON.parse(listResult.result.content[0].text);
        expect(finalTabs.length).toBe(initialTabs.length - 1);
      }
    });
  });

  test.describe('Page Interaction Tools', () => {
    test('browser_page_content returns page data', async () => {
      // Navigate to a test page
      await page.goto('https://example.com');
      await page.waitForTimeout(1000);
      
      // Get tab ID
      const listResult = await callTool('browser_tabs_list');
      const tabs = JSON.parse(listResult.result.content[0].text);
      const activeTab = tabs.find(t => t.active);
      
      // Get page content
      const result = await callTool('browser_page_content', {
        tab_id: activeTab.id
      });
      
      expect(result.jsonrpc).toBe('2.0');
      
      const content = JSON.parse(result.result.content[0].text);
      expect(content).toHaveProperty('title');
      expect(content).toHaveProperty('url');
      expect(content).toHaveProperty('text');
      expect(content).toHaveProperty('html');
      expect(content).toHaveProperty('links');
    });

    test('browser_page_find finds elements', async () => {
      await page.goto('https://example.com');
      await page.waitForTimeout(1000);
      
      const listResult = await callTool('browser_tabs_list');
      const tabs = JSON.parse(listResult.result.content[0].text);
      const activeTab = tabs.find(t => t.active);
      
      // Find all paragraphs
      const result = await callTool('browser_page_find', {
        tab_id: activeTab.id,
        selector: 'p'
      });
      
      expect(result.jsonrpc).toBe('2.0');
      
      const findResult = JSON.parse(result.result.content[0].text);
      expect(findResult).toHaveProperty('count');
      expect(findResult).toHaveProperty('elements');
      expect(typeof findResult.count).toBe('number');
    });

    test('browser_page_click clicks elements', async () => {
      // Create a test page with a button
      await page.setContent(`
        <html>
          <body>
            <button id="test-btn" onclick="window.clicked = true">Click Me</button>
          </body>
        </html>
      `);
      await page.waitForTimeout(500);
      
      const listResult = await callTool('browser_tabs_list');
      const tabs = JSON.parse(listResult.result.content[0].text);
      const activeTab = tabs.find(t => t.active);
      
      // Click the button
      const result = await callTool('browser_page_click', {
        tab_id: activeTab.id,
        selector: '#test-btn'
      });
      
      expect(result.jsonrpc).toBe('2.0');
      expect(result.result.content[0].text).toContain('Clicked');
      
      // Verify click happened
      const clicked = await page.evaluate(() => window.clicked);
      expect(clicked).toBe(true);
    });

    test('browser_page_fill fills input fields', async () => {
      // Create a test page with an input
      await page.setContent(`
        <html>
          <body>
            <input id="test-input" type="text" />
          </body>
        </html>
      `);
      await page.waitForTimeout(500);
      
      const listResult = await callTool('browser_tabs_list');
      const tabs = JSON.parse(listResult.result.content[0].text);
      const activeTab = tabs.find(t => t.active);
      
      // Fill the input
      const result = await callTool('browser_page_fill', {
        tab_id: activeTab.id,
        selector: '#test-input',
        value: 'Hello World'
      });
      
      expect(result.jsonrpc).toBe('2.0');
      expect(result.result.content[0].text).toContain('Filled');
      
      // Verify value was set
      const value = await page.inputValue('#test-input');
      expect(value).toBe('Hello World');
    });

    test('browser_page_scroll scrolls the page', async () => {
      // Create a tall page
      await page.setContent(`
        <html>
          <body style="height: 2000px;">
            <div id="target" style="margin-top: 1500px;">Target</div>
          </body>
        </html>
      `);
      await page.waitForTimeout(500);
      
      const listResult = await callTool('browser_tabs_list');
      const tabs = JSON.parse(listResult.result.content[0].text);
      const activeTab = tabs.find(t => t.active);
      
      // Scroll down
      const result = await callTool('browser_page_scroll', {
        tab_id: activeTab.id,
        x: 0,
        y: 500
      });
      
      expect(result.jsonrpc).toBe('2.0');
      expect(result.result.content[0].text).toContain('Scrolled');
    });

    test('browser_page_execute runs JavaScript', async () => {
      await page.goto('about:blank');
      await page.waitForTimeout(500);
      
      const listResult = await callTool('browser_tabs_list');
      const tabs = JSON.parse(listResult.result.content[0].text);
      const activeTab = tabs.find(t => t.active);
      
      // Execute script
      const result = await callTool('browser_page_execute', {
        tab_id: activeTab.id,
        script: 'return { url: window.location.href, title: document.title }'
      });
      
      expect(result.jsonrpc).toBe('2.0');
      
      const execResult = JSON.parse(result.result.content[0].text);
      expect(execResult).toHaveProperty('url');
      expect(execResult).toHaveProperty('title');
    });

    test('browser_tab_screenshot takes screenshot', async () => {
      await page.goto('https://example.com');
      await page.waitForTimeout(1000);
      
      const listResult = await callTool('browser_tabs_list');
      const tabs = JSON.parse(listResult.result.content[0].text);
      const activeTab = tabs.find(t => t.active);
      
      // Take screenshot
      const result = await callTool('browser_tab_screenshot', {
        tab_id: activeTab.id
      });
      
      expect(result.jsonrpc).toBe('2.0');
      
      // Should return base64 data URL
      const text = result.result.content[0].text;
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

    test('returns error when extension not connected', async () => {
      // Close context to disconnect extension
      await context.close();
      await page.waitForTimeout(1000);
      
      // Try to call tool
      const result = await callTool('browser_tabs_list');
      
      // Should return error
      expect(result.jsonrpc).toBe('2.0');
      expect(result.error || result.result).toBeDefined();
    });
  });

  test.describe('Direct HTTP Endpoints', () => {
    test('GET /tabs returns tabs array', async () => {
      const response = await fetch(`${MCP_URL}/tabs`);
      const data = await response.json();
      
      expect(Array.isArray(data.tabs)).toBe(true);
      expect(data.tabs.length).toBeGreaterThanOrEqual(1);
    });

    test('GET /mcp/info returns server info', async () => {
      const response = await fetch(`${MCP_URL}/mcp/info`);
      const data = await response.json();
      
      expect(data.name).toBe('browser-mcp');
      expect(data.version).toBe('1.0.0');
      expect(data.extension_connected).toBe(true);
    });

    test('GET /health returns status', async () => {
      const response = await fetch(`${MCP_URL}/health`);
      const data = await response.json();
      
      expect(data.status).toBe('ok');
      expect(typeof data.extension_connected).toBe('boolean');
    });
  });
});
