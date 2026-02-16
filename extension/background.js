// Browser MCP Bridge - Background Script
// Connects directly to WebSocket server (bypasses native messaging for Flatpak support)

const DEFAULT_WS_PORT = 6277;
const RECONNECT_INTERVAL = 3000;
const WS_URL = `ws://127.0.0.1:${DEFAULT_WS_PORT}/ws`;

// State
const state = {
  ws: null,
  connected: false,
  pendingRequests: new Map(),
  requestId: 0,
  errors: [],
  logs: [],
  activeOperations: new Map(),
  reconnectTimer: null
};

// Logger that stores logs for popup
function log(level, ...args) {
  const message = args.join(' ');
  const entry = { time: Date.now(), level, message };
  state.logs.push(entry);
  if (state.logs.length > 100) state.logs.shift();
  
  console[level === 'error' ? 'error' : 'log'](`[BrowserMCP]`, ...args);
}

function addError(error) {
  const entry = { time: Date.now(), message: error.message || String(error) };
  state.errors.push(entry);
  if (state.errors.length > 50) state.errors.shift();
  log('error', 'Error:', entry.message);
}

// Keepalive to prevent service worker from being terminated
function startKeepalive() {
  // Send a ping every 20 seconds to keep connection alive
  setInterval(() => {
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      // Send ping (server will respond with pong)
      state.ws.send(JSON.stringify({ method: 'ping', id: 0 }));
      log('debug', 'Keepalive ping sent');
    }
  }, 20000);
  
  // Also keep chrome runtime alive
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // This keeps the service worker alive
    return false;
  });
}

// Initialize
function init() {
  log('log', 'Browser MCP Bridge initializing...');
  log('log', 'Connecting to WebSocket at', WS_URL);
  connectWebSocket();
  startKeepalive();
}

// Connect to WebSocket server
function connectWebSocket() {
  if (state.ws && (state.ws.readyState === WebSocket.CONNECTING || state.ws.readyState === WebSocket.OPEN)) {
    return; // Already connecting or connected
  }

  log('log', 'Connecting to WebSocket...');
  
  try {
    const ws = new WebSocket(WS_URL);
    
    ws.onopen = () => {
      log('log', 'WebSocket connected');
      state.ws = ws;
      state.connected = true;
      
      // Clear any reconnect timer
      if (state.reconnectTimer) {
        clearTimeout(state.reconnectTimer);
        state.reconnectTimer = null;
      }
    };
    
    ws.onmessage = (event) => {
      handleWebSocketMessage(event.data);
    };
    
    ws.onclose = (event) => {
      log('log', 'WebSocket closed', event.code, event.reason);
      state.ws = null;
      state.connected = false;
      
      // Schedule reconnect
      scheduleReconnect();
    };
    
    ws.onerror = (err) => {
      log('error', 'WebSocket error:', err);
      addError(new Error('WebSocket connection failed - is the host running?'));
    };
  } catch (err) {
    log('error', 'Failed to create WebSocket:', err);
    addError(err);
    scheduleReconnect();
  }
}

// Schedule reconnect attempt
function scheduleReconnect() {
  if (!state.reconnectTimer) {
    state.reconnectTimer = setTimeout(() => {
      state.reconnectTimer = null;
      if (!state.connected) {
        log('log', 'Attempting reconnect...');
        connectWebSocket();
      }
    }, RECONNECT_INTERVAL);
  }
}

// Handle WebSocket messages
function handleWebSocketMessage(data) {
  try {
    const msg = JSON.parse(data);
    
    // Handle response to pending request
    if (msg.id && state.pendingRequests.has(msg.id)) {
      const { resolve, timer } = state.pendingRequests.get(msg.id);
      clearTimeout(timer);
      state.pendingRequests.delete(msg.id);
      resolve(msg);
      return;
    }
    
    // Handle incoming request from server
    if (msg.method) {
      handleServerRequest(msg);
    }
  } catch (err) {
    log('error', 'Failed to parse WebSocket message:', err);
  }
}

// Handle requests from Go server (Go -> Extension)
async function handleServerRequest(msg) {
  const operationId = `op-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  try {
    state.activeOperations.set(operationId, {
      method: msg.method,
      startTime: Date.now()
    });
    
    let result;
    
    switch (msg.method) {
      case 'browser.tabs.query':
        result = await chrome.tabs.query({});
        break;
        
      case 'browser.tabs.update':
        const { tabId, props } = JSON.parse(msg.params);
        result = await chrome.tabs.update(tabId, props);
        break;
        
      case 'browser.tabs.remove':
        const { tabId: removeId } = JSON.parse(msg.params);
        await chrome.tabs.remove(removeId);
        result = null;
        break;
        
      case 'browser.tabs.captureVisibleTab':
        result = await chrome.tabs.captureVisibleTab();
        break;
        
      case 'browser.scripting.executeScript':
        const { tabId: scriptTabId, script } = JSON.parse(msg.params);
        result = await chrome.scripting.executeScript({
          target: { tabId: scriptTabId },
          func: (code) => {
            try {
              return eval(code);
            } catch (e) {
              return { error: e.message };
            }
          },
          args: [script]
        });
        break;
        
      default:
        throw new Error(`Unknown method: ${msg.method}`);
    }
    
    // Send success response
    sendResponse(msg.id, { result });
    
  } catch (err) {
    log('error', `Request ${msg.method} failed:`, err);
    // Send proper MCP error format
    sendResponse(msg.id, { 
      error: { 
        code: -32603, 
        message: err.message || String(err) 
      } 
    });
  } finally {
    state.activeOperations.delete(operationId);
  }
}

// Send response to server
function sendResponse(id, data) {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    log('error', 'Cannot send response: WebSocket not connected');
    return;
  }
  
  const msg = { id, ...data };
  state.ws.send(JSON.stringify(msg));
}

// Send request to server (Extension -> Go) and wait for response
function sendRequest(method, params = {}) {
  return new Promise((resolve, reject) => {
    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
      reject(new Error('WebSocket not connected - start the host with: browser-mcp-host'));
      return;
    }
    
    state.requestId++;
    const id = state.requestId;
    
    const msg = {
      id,
      method,
      params: JSON.stringify(params)
    };
    
    // Set up timeout
    const timer = setTimeout(() => {
      state.pendingRequests.delete(id);
      reject(new Error('Request timeout'));
    }, 30000);
    
    state.pendingRequests.set(id, { resolve, timer });
    
    state.ws.send(JSON.stringify(msg));
  });
}

// --- MCP API exposed to popup/content ---

const MCP = {
  // Connection status
  isConnected: () => state.connected,
  getStatus: () => ({
    connected: state.connected,
    ready: state.connected,
    wsPort: DEFAULT_WS_PORT,
    wsUrl: WS_URL,
    activeOperations: Array.from(state.activeOperations.values()),
    errors: state.errors.slice(-5),
    logs: state.logs.slice(-10)
  }),
  
  // Reconnect function
  reconnect: () => {
    if (state.ws) {
      state.ws.close();
    }
    connectWebSocket();
  },
  
  // Tab operations
  async listTabs() {
    return sendRequest('tabs/list');
  },
  
  async activateTab(tabId) {
    return sendRequest('tabs/activate', { tabId });
  },
  
  async navigateTab(tabId, url) {
    return sendRequest('tabs/navigate', { tabId, url });
  },
  
  async closeTab(tabId) {
    return sendRequest('tabs/close', { tabId });
  },
  
  async screenshotTab(tabId) {
    return sendRequest('tabs/screenshot', { tabId });
  },
  
  // Page operations
  async getPageContent(tabId) {
    return sendRequest('page/getContent', { tabId });
  },
  
  async executeScript(tabId, script) {
    return sendRequest('page/executeScript', { tabId, script });
  },
  
  async click(tabId, selector) {
    return sendRequest('page/click', { tabId, selector });
  },
  
  async fill(tabId, selector, value) {
    return sendRequest('page/fill', { tabId, selector, value });
  },
  
  async scroll(tabId, x = 0, y = 0) {
    return sendRequest('page/scroll', { tabId, x, y });
  },
  
  async find(tabId, selector) {
    return sendRequest('page/find', { tabId, selector });
  },
  
  // Tools
  async getTools() {
    return sendRequest('mcp/tools');
  }
};

// Expose MCP to popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const { action, params } = request;
  
  if (action === 'getStatus') {
    sendResponse(MCP.getStatus());
    return false;
  }
  
  if (action === 'isConnected') {
    sendResponse(MCP.isConnected());
    return false;
  }
  
  if (action === 'reconnect') {
    MCP.reconnect();
    sendResponse({ success: true });
    return false;
  }
  
  if (MCP[action]) {
    MCP[action](...params || [])
      .then(result => sendResponse({ success: true, result }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Async response
  }
  
  sendResponse({ success: false, error: `Unknown action: ${action}` });
  return false;
});

// Initialize
init();

log('log', 'Background script loaded');
