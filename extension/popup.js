// Browser MCP Bridge - Popup Script

// DOM elements
const els = {
  statusIndicator: document.getElementById('status-indicator'),
  connectionStatus: document.getElementById('connection-status'),
  wsPort: document.getElementById('ws-port'),
  activeOps: document.getElementById('active-ops'),
  opsList: document.getElementById('ops-list'),
  errors: document.getElementById('errors'),
  errorsList: document.getElementById('errors-list'),
  logsList: document.getElementById('logs-list'),
  refreshBtn: document.getElementById('refresh-btn'),
  reconnectBtn: document.getElementById('reconnect-btn')
};

// Format timestamp
function formatTime(timestamp) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('en-US', { 
    hour12: false, 
    hour: '2-digit', 
    minute: '2-digit', 
    second: '2-digit' 
  });
}

// Format relative time
function formatRelative(timestamp) {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

// Update status display
function updateStatus(status) {
  // Connection indicator
  els.statusIndicator.className = 'status';
  els.connectionStatus.className = 'connection-text';
  
  if (status.connected && status.ready) {
    els.statusIndicator.classList.add('connected');
    els.connectionStatus.classList.add('connected');
    els.connectionStatus.textContent = 'Connected';
  } else if (status.connected) {
    els.statusIndicator.classList.add('connecting');
    els.connectionStatus.classList.add('connecting');
    els.connectionStatus.textContent = 'Initializing...';
  } else {
    els.statusIndicator.classList.add('disconnected');
    els.connectionStatus.classList.add('disconnected');
    els.connectionStatus.textContent = 'Disconnected';
  }
  
  // WebSocket port
  els.wsPort.textContent = status.wsPort ? `Port: ${status.wsPort}` : '';
  
  // Active operations
  if (status.activeOperations && status.activeOperations.length > 0) {
    els.activeOps.classList.add('hidden');
    els.opsList.classList.remove('hidden');
    els.opsList.innerHTML = status.activeOperations.map(op => `
      <li>
        <span class="method">${op.method}</span>
        <span class="time">${formatRelative(op.startTime)}</span>
      </li>
    `).join('');
  } else {
    els.activeOps.classList.remove('hidden');
    els.opsList.classList.add('hidden');
  }
  
  // Errors
  if (status.errors && status.errors.length > 0) {
    els.errors.classList.add('hidden');
    els.errorsList.classList.remove('hidden');
    els.errorsList.innerHTML = status.errors.map(err => `
      <li>
        <div class="message">${escapeHtml(err.message)}</div>
        <div class="timestamp">${formatTime(err.time)}</div>
      </li>
    `).join('');
  } else {
    els.errors.classList.remove('hidden');
    els.errorsList.classList.add('hidden');
  }
  
  // Logs
  if (status.logs && status.logs.length > 0) {
    els.logsList.innerHTML = status.logs.map(log => `
      <li>
        <span class="time">${formatTime(log.time)}</span>
        <span class="level ${log.level}">${log.level}</span>
        <span class="message">${escapeHtml(log.message)}</span>
      </li>
    `).join('');
    // Auto-scroll to bottom
    els.logsList.scrollTop = els.logsList.scrollHeight;
  }
}

// Escape HTML
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Fetch status from background
async function fetchStatus() {
  try {
    const status = await chrome.runtime.sendMessage({ action: 'getStatus' });
    updateStatus(status);
  } catch (err) {
    console.error('Failed to fetch status:', err);
    updateStatus({
      connected: false,
      ready: false,
      errors: [{ time: Date.now(), message: 'Failed to communicate with extension' }],
      logs: []
    });
  }
}

// Reconnect
async function reconnect() {
  els.connectionStatus.textContent = 'Reconnecting...';
  els.statusIndicator.className = 'status connecting';
  
  try {
    // Try to trigger reconnection by reloading background
    // This is a bit hacky but works for now
    chrome.runtime.reload();
    
    // Wait a bit and refresh
    await new Promise(r => setTimeout(r, 2000));
    await fetchStatus();
  } catch (err) {
    console.error('Reconnect failed:', err);
  }
}

// Event listeners
els.refreshBtn.addEventListener('click', fetchStatus);
els.reconnectBtn.addEventListener('click', reconnect);

// Auto-refresh every 2 seconds
fetchStatus();
setInterval(fetchStatus, 2000);
