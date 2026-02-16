// Browser MCP Bridge - Background Script
// Handles native messaging to launch Go binary and WebSocket communication

const NATIVE_HOST_NAME = 'com.browsermcp.host';

// State
const state = {
  nativePort: null,
  ws: null,
  wsPort: null,
  connected: false,
  ready: false,
  pendingRequests: new Map(),
  requestId: 0,
  errors: [],
  logs: [],
  activeOperations: new Map()
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

// Initialize
async function init() {
  log('log', 'Browser MCP Bridge initializing...');
  
  try {
    await connectNativeHost();
  } catch (err) {
    addError(err);
  }
}

// Connect to native host (Go binary)
function connectNativeHost() {
  return new Promise((resolve, reject) => {
    log('log', 'Connecting to native host...');
    
    try {
      state.nativePort = chrome.runtime.connectNative(NATIVE_HOST_NAME);
    } catch (err) {
      reject(new Error(`Failed to connect native host: ${err.message}`));
      return;
    }
    
    state.nativePort.onMessage.addListener((msg) => {
      handleNativeMessage(msg, resolve, reject);
    });
    
    state.nativePort.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError;
      if (error) {
        log('error', 'Native host disconnected:', error.message);
        addError(error);
      } else {
        log('log', 'Native host disconnected');
      }
      
      state.nativePort = null;
      state.ready = false;
      state.connected = false;
      
      // Attempt reconnect after delay
      setTimeout(() => {
        if (!state.ready) {
          log('log', 'Attempting reconnect...');
          connectNativeHost().catch(() => {});
        }
      }, 5000);
    });
  });
}

// Handle messages from native host
function handleNativeMessage(msg, resolve, reject) {
  log('log', 'Native message:', msg);
  
  if (msg.error) {
    const err = new Error(msg.error);
    addError(err);
    reject(err);
    return;
  }
  
  // Received WebSocket port
  if (msg.port) {
    state.wsPort = msg.port;
    log('log', 'Received WebSocket port:', msg.port);
    connectWebSocket(msg.port).then(resolve).catch(reject);
    return;
  }
  
  // Ready status
  if (msg.status === 'ready') {
    state.ready = true;
    log('log', 'Native host ready');
  }
}

// Connect to WebSocket server
function connectWebSocket(port) {
  return new Promise((resolve, reject) => {
    const wsUrl = `ws://127.0.0.1:${port}/ws`;
    log('log', 'Connecting to WebSocket:', wsUrl);
    
    const ws = new WebSocket(wsUrl);
    
    ws.onopen = () => {
      log('log', 'WebSocket connected');
      state.ws = ws;
      state.connected = true;
      resolve();
    };
    
    ws.onmessage = (event) => {
      handleWebSocketMessage(event.data);
    };
    
    ws.onclose = () => {
      log('log', 'WebSocket closed');
      state.ws = null;
      state.connected = false;
      state.ready = false;
    };
    
    ws.onerror = (err) => {
      log('error', 'WebSocket error:', err);
      addError(new Error('WebSocket connection failed'));
      reject(err);
    };
    
    // Timeout
    setTimeout(() => {
      if (!state.connected) {
        ws.close();
        reject(new Error('WebSocket connection timeout'));
      }
    }, 10000);
  });
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
    sendResponse(msg.id, { error: err.message });
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
      reject(new Error('WebSocket not connected'));
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
  isConnected: () => state.connected && state.ready,
  getStatus: () => ({
    connected: state.connected,
    ready: state.ready,
    wsPort: state.wsPort,
    activeOperations: Array.from(state.activeOperations.values()),
    errors: state.errors.slice(-5),
    logs: state.logs.slice(-10)
  }),
  
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
