// Browser MCP Bridge - Background Script
// Connects directly to WebSocket server (bypasses native messaging for Flatpak support)

const DEFAULT_WS_PORT = 6277;
const RECONNECT_INTERVAL = 3000;

// State
let WS_PORT = DEFAULT_WS_PORT;
let WS_URL = `ws://127.0.0.1:${WS_PORT}/ws`;

// Update WebSocket URL when port changes
function updateWsUrl(port) {
  WS_PORT = port || DEFAULT_WS_PORT;
  WS_URL = `ws://127.0.0.1:${WS_PORT}/ws`;
  return WS_URL;
}

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

// Send error to Go backend for centralized logging
function sendErrorToBackend(error, context = '') {
  if (!state.ws || state.ws.readyState !== WebSocket.OPEN) {
    return; // Can't send if not connected
  }
  
  const errorMsg = {
    method: 'extension/error',
    params: {
      message: error.message || String(error),
      stack: error.stack || '',
      context: context,
      time: Date.now()
    }
  };
  
  try {
    state.ws.send(JSON.stringify(errorMsg));
  } catch (e) {
    // Silent fail - don't create infinite loop
    console.error('[BrowserMCP] Failed to send error to backend:', e);
  }
}

function addError(error, context = '') {
  const entry = { time: Date.now(), message: error.message || String(error), context };
  state.errors.push(entry);
  if (state.errors.length > 50) state.errors.shift();
  log('error', 'Error:', entry.message);
  
  // Also send to Go backend for debugging
  sendErrorToBackend(error, context);
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
}

// Initialize
async function init() {
  log('log', 'Browser MCP Bridge initializing...');
  
  // Try to get port from storage (allows test configuration)
  try {
    const stored = await chrome.storage.local.get(['wsPort']);
    if (stored.wsPort) {
      updateWsUrl(stored.wsPort);
      log('log', 'Using stored WebSocket port:', WS_PORT);
    }
  } catch (e) {
    // Storage not available, use default
    log('log', 'Storage not available, using default port');
  }
  
  log('log', 'Connecting to WebSocket at', WS_URL);
  connectWebSocket();
  startKeepalive();
}

// Connect to WebSocket server
function connectWebSocket() {
  if (state.ws && (state.ws.readyState === WebSocket.CONNECTING || state.ws.readyState === WebSocket.OPEN)) {
    return; // Already connecting or connected
  }

  log('log', 'Connecting to WebSocket at', WS_URL);
  
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
      addError(new Error('WebSocket connection failed - is the host running?'), 'websocket');
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
      addError(err, 'websocket-message-parse');
  }
}

// Parse params - handle both string and object (Go sends objects directly now)
function parseParams(params) {
  if (typeof params === 'string') {
    try {
      return JSON.parse(params);
    } catch (e) {
      return { raw: params };
    }
  }
  return params || {};
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
    const params = parseParams(msg.params);
    
    switch (msg.method) {
      case 'browser.tabs.query':
        result = await chrome.tabs.query({});
        break;
        
      case 'browser.tabs.update':
        log('log', `tabs.update RAW msg.params: ${JSON.stringify(msg.params)}`);
        log('log', `tabs.update PARSED params: ${JSON.stringify(params)}`);
        log('log', `tabs.update called: tabId=${params.tabId}, props=${JSON.stringify(params.props)}`);
        try {
          result = await chrome.tabs.update(params.tabId, params.props);
          log('log', `tabs.update success: result=${JSON.stringify(result)}`);
        } catch (updateErr) {
          // Get available tabs to help LLM understand the situation
          const tabs = await chrome.tabs.query({});
          const tabList = tabs.map(t => `ID:${t.id} URL:${t.url} Title:"${t.title}"`).join('; ');
          const enhancedError = new Error(`${updateErr.message}. Available tabs: [${tabList}]`);
          log('error', `tabs.update failed: tabId=${params.tabId}, error=${enhancedError.message}`);
          throw enhancedError;
        }
        break;
        
      case 'browser.tabs.remove':
        try {
          await chrome.tabs.remove(params.tabId);
          result = null;
        } catch (removeErr) {
          // Get available tabs to help LLM understand the situation
          const tabs = await chrome.tabs.query({});
          const tabList = tabs.map(t => `ID:${t.id} URL:${t.url} Title:"${t.title}"`).join('; ');
          const enhancedError = new Error(`${removeErr.message}. Available tabs: [${tabList}]`);
          throw enhancedError;
        }
        break;
        
      case 'browser.tabs.captureVisibleTab':
        result = await chrome.tabs.captureVisibleTab();
        break;
        
      case 'browser.scripting.executeScript':
        try {
          result = await chrome.scripting.executeScript({
            target: { tabId: params.tabId },
            func: (code) => {
              try {
                return eval(code);
              } catch (e) {
                return { error: e.message };
              }
            },
            args: [params.script]
          });
        } catch (execErr) {
          // Get available tabs to help LLM understand the situation
          const tabs = await chrome.tabs.query({});
          const tabList = tabs.map(t => `ID:${t.id} URL:${t.url} Title:"${t.title}"`).join('; ');
          const enhancedError = new Error(`${execErr.message}. Available tabs: [${tabList}]`);
          throw enhancedError;
        }
        break;
        
      default:
        throw new Error(`Unknown method: ${msg.method}`);
    }
    
    // Send success response
    log('log', `Sending success response for ${msg.method}, id=${msg.id}`);
    sendResponse(msg.id, { result });
    
  } catch (err) {
    log('error', `Request ${msg.method} failed:`, err.message, err.stack);
    addError(err, `request-${msg.method}`);
    // Send proper MCP error format
    const errorResponse = { 
      error: { 
        code: -32603, 
        message: err.message || String(err),
        data: { method: msg.method, stack: err.stack }
      } 
    };
    log('log', `Sending error response for ${msg.method}, id=${msg.id}:`, JSON.stringify(errorResponse));
    sendResponse(msg.id, errorResponse);
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
    
    // Send params as object (Go will json.Unmarshal into struct)
    const msg = {
      id,
      method,
      params: params
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
    wsPort: WS_PORT,
    wsUrl: WS_URL,
    activeOperations: Array.from(state.activeOperations.values()),
    errors: state.errors.slice(-5),
    logs: state.logs.slice(-10)
  }),
  
  // Reconnect function
  reconnect: async (port) => {
    if (port && port !== WS_PORT) {
      updateWsUrl(port);
      // Save to storage for persistence
      try {
        await chrome.storage.local.set({ wsPort: port });
        log('log', 'Port updated to', port);
      } catch (e) {
        // Storage may not be available in test environment
        log('log', 'Storage not available, using provided port:', port);
      }
    }
    if (state.ws) {
      state.ws.close();
    }
    connectWebSocket();
  },
  
  // Tab operations - these call the Go host
  async listTabs() {
    return sendRequest('tabs/list', {});
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
    // params is an array, first element is the port
    const port = params && params[0];
    MCP.reconnect(port).then(() => {
      sendResponse({ success: true });
    }).catch(err => {
      sendResponse({ success: false, error: err.message });
    });
    return true; // Async response
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
