#!/usr/bin/env python3
"""
Browser MCP Bridge - Native Messaging Host
Bridges HTTP MCP server to browser extension via native messaging
"""

import sys
import struct
import json
import threading
import queue
import time
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# Configuration
HTTP_PORT = 6277  # MCP default-ish port
NATIVE_HOST_NAME = "com.browsermcp.host"

# Global state
pending_requests = {}
request_counter = 0
request_lock = threading.Lock()
extension_connected = threading.Event()
message_queue = queue.Queue()


def send_native_message(message):
    """Send a message to the browser extension via native messaging"""
    encoded = json.dumps(message).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('I', len(encoded)))
    sys.stdout.buffer.write(encoded)
    sys.stdout.buffer.flush()


def read_native_messages():
    """Read messages from browser extension (runs in thread)"""
    while True:
        try:
            # Read message length (4 bytes, native endian)
            raw_length = sys.stdin.buffer.read(4)
            if not raw_length:
                print("Extension disconnected", file=sys.stderr)
                extension_connected.clear()
                time.sleep(1)
                continue
            
            length = struct.unpack('I', raw_length)[0]
            message_data = sys.stdin.buffer.read(length).decode('utf-8')
            message = json.loads(message_data)
            
            extension_connected.set()
            
            # Handle response
            if 'id' in message:
                req_id = message['id']
                if req_id in pending_requests:
                    pending_requests[req_id].put(message)
                    
        except Exception as e:
            print(f"Error reading message: {e}", file=sys.stderr)
            extension_connected.clear()
            time.sleep(1)


def call_extension_method(method, params=None, timeout=30):
    """Call a method in the browser extension and wait for response"""
    global request_counter
    
    if not extension_connected.is_set():
        raise Exception("Extension not connected")
    
    with request_lock:
        request_counter += 1
        req_id = request_counter
    
    request = {
        "id": req_id,
        "method": method,
        "params": params or {}
    }
    
    response_queue = queue.Queue()
    pending_requests[req_id] = response_queue
    
    try:
        send_native_message(request)
        response = response_queue.get(timeout=timeout)
        
        if 'error' in response:
            raise Exception(response['error'])
        return response.get('result')
    finally:
        del pending_requests[req_id]


# MCP Server Implementation
class MCPHandler(BaseHTTPRequestHandler):
    """HTTP handler for MCP protocol"""
    
    def log_message(self, format, *args):
        # Suppress default logging
        pass
    
    def send_json_response(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())
    
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
    
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        params = parse_qs(parsed.query)
        
        # Health check
        if path == '/health':
            self.send_json_response({
                "status": "ok",
                "extension_connected": extension_connected.is_set()
            })
            return
        
        # MCP Server info
        if path == '/mcp/info':
            self.send_json_response({
                "name": "browser-mcp",
                "version": "1.0.0",
                "tools": list(self.get_tools().keys())
            })
            return
        
        # List tabs
        if path == '/tabs':
            try:
                result = call_extension_method('tabs/list')
                self.send_json_response(result)
            except Exception as e:
                self.send_json_response({"error": str(e)}, 500)
            return
        
        # Get tab content
        if path.startswith('/tabs/'):
            parts = path.split('/')
            if len(parts) >= 3:
                tab_id = int(parts[2])
                try:
                    if len(parts) == 3 or parts[3] == 'content':
                        result = call_extension_method('page/getContent', {'tabId': tab_id})
                        self.send_json_response(result)
                    elif parts[3] == 'screenshot':
                        result = call_extension_method('tabs/screenshot', {'tabId': tab_id})
                        self.send_json_response(result)
                    else:
                        self.send_json_response({"error": "Unknown endpoint"}, 404)
                except Exception as e:
                    self.send_json_response({"error": str(e)}, 500)
                return
        
        self.send_json_response({"error": "Not found"}, 404)
    
    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        
        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length).decode() if content_length > 0 else '{}'
        
        try:
            data = json.loads(body) if body else {}
        except:
            data = {}
        
        # MCP Tool invocation
        if path.startswith('/mcp/call/'):
            tool_name = path.split('/')[-1]
            try:
                result = self.call_tool(tool_name, data)
                self.send_json_response({"result": result})
            except Exception as e:
                self.send_json_response({"error": str(e)}, 500)
            return
        
        # Direct tab actions
        if path.startswith('/tabs/'):
            parts = path.split('/')
            if len(parts) >= 4:
                tab_id = int(parts[2])
                action = parts[3]
                
                try:
                    if action == 'activate':
                        result = call_extension_method('tabs/activate', {'tabId': tab_id})
                    elif action == 'navigate':
                        result = call_extension_method('tabs/navigate', {
                            'tabId': tab_id,
                            'url': data.get('url')
                        })
                    elif action == 'close':
                        result = call_extension_method('tabs/close', {'tabId': tab_id})
                    elif action == 'execute':
                        result = call_extension_method('page/executeScript', {
                            'tabId': tab_id,
                            'script': data.get('script')
                        })
                    elif action == 'click':
                        result = call_extension_method('page/click', {
                            'tabId': tab_id,
                            'selector': data.get('selector')
                        })
                    elif action == 'fill':
                        result = call_extension_method('page/fill', {
                            'tabId': tab_id,
                            'selector': data.get('selector'),
                            'value': data.get('value')
                        })
                    elif action == 'scroll':
                        result = call_extension_method('page/scroll', {
                            'tabId': tab_id,
                            'x': data.get('x', 0),
                            'y': data.get('y', 0)
                        })
                    elif action == 'find':
                        result = call_extension_method('page/find', {
                            'tabId': tab_id,
                            'selector': data.get('selector')
                        })
                    else:
                        self.send_json_response({"error": "Unknown action"}, 400)
                        return
                    
                    self.send_json_response(result)
                except Exception as e:
                    self.send_json_response({"error": str(e)}, 500)
                return
        
        # Create new tab
        if path == '/tabs':
            try:
                # First get current tabs
                tabs = call_extension_method('tabs/list')
                # Open new tab by navigating
                import subprocess
                url = data.get('url', 'about:blank')
                subprocess.run(['xdg-open', url], check=False)
                self.send_json_response({"created": True, "url": url})
            except Exception as e:
                self.send_json_response({"error": str(e)}, 500)
            return
        
        self.send_json_response({"error": "Not found"}, 404)
    
    def get_tools(self):
        """Define available MCP tools"""
        return {
            "browser_tabs_list": "List all open browser tabs",
            "browser_tab_activate": "Activate/focus a specific tab",
            "browser_tab_navigate": "Navigate a tab to a URL",
            "browser_tab_close": "Close a tab",
            "browser_tab_screenshot": "Take a screenshot of a tab",
            "browser_page_content": "Get page content (text, HTML, links)",
            "browser_page_click": "Click an element by CSS selector",
            "browser_page_fill": "Fill an input field",
            "browser_page_scroll": "Scroll the page",
            "browser_page_execute": "Execute JavaScript in the page"
        }
    
    def call_tool(self, tool_name, params):
        """Route MCP tool calls to extension methods"""
        
        tool_map = {
            "browser_tabs_list": ("tabs/list", {}),
            "browser_tab_activate": ("tabs/activate", {"tabId": params.get("tab_id")}),
            "browser_tab_navigate": ("tabs/navigate", {
                "tabId": params.get("tab_id"),
                "url": params.get("url")
            }),
            "browser_tab_close": ("tabs/close", {"tabId": params.get("tab_id")}),
            "browser_tab_screenshot": ("tabs/screenshot", {"tabId": params.get("tab_id")}),
            "browser_page_content": ("page/getContent", {"tabId": params.get("tab_id")}),
            "browser_page_click": ("page/click", {
                "tabId": params.get("tab_id"),
                "selector": params.get("selector")
            }),
            "browser_page_fill": ("page/fill", {
                "tabId": params.get("tab_id"),
                "selector": params.get("selector"),
                "value": params.get("value")
            }),
            "browser_page_scroll": ("page/scroll", {
                "tabId": params.get("tab_id"),
                "x": params.get("x", 0),
                "y": params.get("y", 0)
            }),
            "browser_page_execute": ("page/executeScript", {
                "tabId": params.get("tab_id"),
                "script": params.get("script")
            }),
            "browser_page_find": ("page/find", {
                "tabId": params.get("tab_id"),
                "selector": params.get("selector")
            })
        }
        
        if tool_name not in tool_map:
            raise Exception(f"Unknown tool: {tool_name}")
        
        method, ext_params = tool_map[tool_name]
        return call_extension_method(method, ext_params)


def run_http_server():
    """Run the HTTP MCP server"""
    server = HTTPServer(('localhost', HTTP_PORT), MCPHandler)
    print(f"MCP HTTP server running on http://localhost:{HTTP_PORT}", file=sys.stderr)
    server.serve_forever()


def main():
    print("Browser MCP Bridge starting...", file=sys.stderr)
    
    # Start HTTP server in background thread
    http_thread = threading.Thread(target=run_http_server, daemon=True)
    http_thread.start()
    
    # Start reading native messages (blocks)
    read_native_messages()


if __name__ == '__main__':
    main()
