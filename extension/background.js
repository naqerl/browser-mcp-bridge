// Browser MCP Bridge - Background Script
// Handles native messaging and browser automation

const NATIVE_HOST_NAME = 'com.browsermcp.host';
let nativePort = null;
let isConnected = false;

// Connect to native host
function connectNativeHost() {
  try {
    nativePort = chrome.runtime.connectNative(NATIVE_HOST_NAME);
    isConnected = true;
    
    nativePort.onMessage.addListener(handleNativeMessage);
    nativePort.onDisconnect.addListener(() => {
      console.log('Native host disconnected:', chrome.runtime.lastError);
      isConnected = false;
      nativePort = null;
      // Auto-reconnect after delay
      setTimeout(connectNativeHost, 5000);
    });
    
    console.log('Connected to native host');
  } catch (err) {
    console.error('Failed to connect to native host:', err);
    setTimeout(connectNativeHost, 5000);
  }
}

// Handle messages from native host
async function handleNativeMessage(message) {
  console.log('Received from native host:', message);
  
  const { id, method, params } = message;
  
  try {
    let result;
    
    switch (method) {
      case 'tabs/list':
        result = await listTabs();
        break;
      case 'tabs/activate':
        result = await activateTab(params.tabId);
        break;
      case 'tabs/navigate':
        result = await navigateTab(params.tabId, params.url);
        break;
      case 'tabs/close':
        result = await closeTab(params.tabId);
        break;
      case 'tabs/screenshot':
        result = await screenshotTab(params.tabId);
        break;
      case 'page/executeScript':
        result = await executeScript(params.tabId, params.script);
        break;
      case 'page/getContent':
        result = await getPageContent(params.tabId);
        break;
      case 'page/click':
        result = await clickElement(params.tabId, params.selector);
        break;
      case 'page/fill':
        result = await fillInput(params.tabId, params.selector, params.value);
        break;
      case 'page/scroll':
        result = await scrollPage(params.tabId, params.x, params.y);
        break;
      case 'page/find':
        result = await findElement(params.tabId, params.selector);
        break;
      default:
        throw new Error(`Unknown method: ${method}`);
    }
    
    sendResponse(id, { result });
  } catch (error) {
    sendResponse(id, { error: error.message });
  }
}

// Send response back to native host
function sendResponse(id, data) {
  if (nativePort) {
    nativePort.postMessage({ id, ...data });
  }
}

// --- MCP Tool Implementations ---

async function listTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs.map(t => ({
    id: t.id,
    windowId: t.windowId,
    index: t.index,
    url: t.url,
    title: t.title,
    active: t.active,
    pinned: t.pinned,
    audible: t.audible,
    status: t.status
  }));
}

async function activateTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  await chrome.windows.update(tab.windowId, { focused: true });
  await chrome.tabs.update(tabId, { active: true });
  return { success: true, tabId };
}

async function navigateTab(tabId, url) {
  const tab = await chrome.tabs.update(tabId, { url });
  // Wait for load
  await new Promise((resolve) => {
    const listener = (updatedTabId, info) => {
      if (updatedTabId === tabId && info.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    // Timeout after 30s
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 30000);
  });
  return { success: true, tabId, url };
}

async function closeTab(tabId) {
  await chrome.tabs.remove(tabId);
  return { success: true, tabId };
}

async function screenshotTab(tabId) {
  // Activate tab first
  await activateTab(tabId);
  // Small delay to ensure rendering
  await new Promise(r => setTimeout(r, 100));
  const dataUrl = await chrome.tabs.captureVisibleTab();
  return { success: true, dataUrl };
}

async function executeScript(tabId, script) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (code) => {
      try {
        return eval(code);
      } catch (e) {
        return { error: e.message };
      }
    },
    args: [script]
  });
  return { success: true, result: results[0]?.result };
}

async function getPageContent(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      return {
        title: document.title,
        url: window.location.href,
        text: document.body?.innerText || '',
        html: document.documentElement.outerHTML,
        links: Array.from(document.querySelectorAll('a')).map(a => ({
          text: a.innerText,
          href: a.href
        })).slice(0, 100)
      };
    }
  });
  return { success: true, content: results[0]?.result };
}

async function clickElement(tabId, selector) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel) => {
      const el = document.querySelector(sel);
      if (!el) return { error: 'Element not found' };
      el.click();
      return { clicked: true, tagName: el.tagName };
    },
    args: [selector]
  });
  return { success: true, result: results[0]?.result };
}

async function fillInput(tabId, selector, value) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel, val) => {
      const el = document.querySelector(sel);
      if (!el) return { error: 'Element not found' };
      el.value = val;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { filled: true, tagName: el.tagName };
    },
    args: [selector, value]
  });
  return { success: true, result: results[0]?.result };
}

async function scrollPage(tabId, x, y) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (scrollX, scrollY) => {
      window.scrollTo(scrollX, scrollY);
      return { scrollX: window.scrollX, scrollY: window.scrollY };
    },
    args: [x || 0, y || 0]
  });
  return { success: true, result: results[0]?.result };
}

async function findElement(tabId, selector) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: (sel) => {
      const elements = Array.from(document.querySelectorAll(sel));
      return {
        count: elements.length,
        elements: elements.map(el => ({
          tagName: el.tagName,
          text: el.innerText?.slice(0, 200),
          visible: el.offsetParent !== null
        }))
      };
    },
    args: [selector]
  });
  return { success: true, result: results[0]?.result };
}

// Initialize
connectNativeHost();

// Keep service worker alive
setInterval(() => {
  if (!isConnected) {
    connectNativeHost();
  }
}, 10000);

console.log('Browser MCP Bridge loaded');
