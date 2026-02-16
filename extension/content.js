// Browser MCP Bridge - Content Script
// Injected into all pages for DOM interaction

console.log('[Browser MCP] Content script loaded');

// Listen for messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    try {
      switch (request.action) {
        case 'getFormData':
          sendResponse({ success: true, data: getAllFormData() });
          break;
        case 'submitForm':
          sendResponse({ success: true, result: submitForm(request.selector) });
          break;
        case 'getAccessibilityTree':
          sendResponse({ success: true, tree: getAccessibilityTree() });
          break;
        default:
          sendResponse({ error: 'Unknown action' });
      }
    } catch (err) {
      sendResponse({ error: err.message });
    }
  })();
  return true; // Keep channel open for async
});

function getAllFormData() {
  const forms = [];
  document.querySelectorAll('form').forEach((form, idx) => {
    const inputs = Array.from(form.querySelectorAll('input, textarea, select'));
    forms.push({
      index: idx,
      action: form.action,
      method: form.method,
      inputs: inputs.map(input => ({
        name: input.name,
        type: input.type,
        value: input.value,
        selector: getUniqueSelector(input)
      }))
    });
  });
  return forms;
}

function submitForm(selector) {
  const form = selector 
    ? document.querySelector(selector)
    : document.querySelector('form');
  if (form) {
    form.submit();
    return { submitted: true };
  }
  return { error: 'Form not found' };
}

function getAccessibilityTree() {
  // Simplified accessibility tree extraction
  const interactiveElements = document.querySelectorAll(
    'button, a, input, textarea, select, [role="button"], [role="link"], [onclick]'
  );
  
  return Array.from(interactiveElements).map(el => ({
    tag: el.tagName.toLowerCase(),
    role: el.getAttribute('role'),
    text: el.innerText?.slice(0, 100) || el.value || el.placeholder || '',
    ariaLabel: el.getAttribute('aria-label'),
    selector: getUniqueSelector(el),
    bounds: el.getBoundingClientRect()
  }));
}

function getUniqueSelector(el) {
  // Generate a unique CSS selector for an element
  if (el.id) return `#${el.id}`;
  if (el.name) return `[name="${el.name}"]`;
  
  let path = [];
  let current = el;
  
  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase();
    if (current.className) {
      selector += '.' + Array.from(current.classList).join('.');
    }
    
    const siblings = Array.from(current.parentNode?.children || []);
    const sameTagSiblings = siblings.filter(s => s.tagName === current.tagName);
    if (sameTagSiblings.length > 1) {
      const index = siblings.indexOf(current) + 1;
      selector += `:nth-child(${index})`;
    }
    
    path.unshift(selector);
    current = current.parentNode;
    
    if (path.length > 4) break; // Limit depth
  }
  
  return path.join(' > ');
}

// Expose helper for debugging
window.__browserMCP = {
  getFormData: getAllFormData,
  getAccessibilityTree,
  query: (sel) => document.querySelector(sel),
  queryAll: (sel) => Array.from(document.querySelectorAll(sel))
};
