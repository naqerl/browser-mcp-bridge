#!/usr/bin/env python3
"""
Example MCP client for Browser MCP Bridge
Demonstrates how to use the HTTP MCP API
"""

import requests
import json
import base64

BASE_URL = "http://localhost:6277"

class BrowserMCPClient:
    """Simple MCP client for browser automation"""
    
    def __init__(self, base_url=BASE_URL):
        self.base_url = base_url
    
    def health(self):
        """Check if server is running"""
        r = requests.get(f"{self.base_url}/health")
        return r.json()
    
    def list_tabs(self):
        """List all browser tabs"""
        r = requests.get(f"{self.base_url}/tabs")
        return r.json()
    
    def get_tab(self, tab_id):
        """Get tab details"""
        tabs = self.list_tabs()
        for tab in tabs:
            if tab['id'] == tab_id:
                return tab
        return None
    
    def find_tab_by_url(self, pattern):
        """Find tab by URL pattern"""
        tabs = self.list_tabs()
        for tab in tabs:
            if pattern in tab.get('url', ''):
                return tab
        return None
    
    def activate_tab(self, tab_id):
        """Focus/activate a tab"""
        r = requests.post(f"{self.base_url}/tabs/{tab_id}/activate")
        return r.json()
    
    def navigate(self, tab_id, url):
        """Navigate tab to URL"""
        r = requests.post(
            f"{self.base_url}/tabs/{tab_id}/navigate",
            json={"url": url}
        )
        return r.json()
    
    def close_tab(self, tab_id):
        """Close a tab"""
        r = requests.post(f"{self.base_url}/tabs/{tab_id}/close")
        return r.json()
    
    def get_content(self, tab_id):
        """Get page content (text, HTML, links)"""
        r = requests.get(f"{self.base_url}/tabs/{tab_id}/content")
        return r.json()
    
    def screenshot(self, tab_id, save_path=None):
        """Take screenshot, optionally save to file"""
        r = requests.get(f"{self.base_url}/tabs/{tab_id}/screenshot")
        data = r.json()
        
        if save_path and 'dataUrl' in data:
            # Decode base64 data URL
            data_url = data['dataUrl']
            header, encoded = data_url.split(',', 1)
            img_data = base64.b64decode(encoded)
            with open(save_path, 'wb') as f:
                f.write(img_data)
            print(f"Screenshot saved to {save_path}")
        
        return data
    
    def execute_script(self, tab_id, script):
        """Execute JavaScript in page"""
        r = requests.post(
            f"{self.base_url}/tabs/{tab_id}/execute",
            json={"script": script}
        )
        return r.json()
    
    def click(self, tab_id, selector):
        """Click element by CSS selector"""
        r = requests.post(
            f"{self.base_url}/tabs/{tab_id}/click",
            json={"selector": selector}
        )
        return r.json()
    
    def fill(self, tab_id, selector, value):
        """Fill input field"""
        r = requests.post(
            f"{self.base_url}/tabs/{tab_id}/fill",
            json={"selector": selector, "value": value}
        )
        return r.json()
    
    def scroll(self, tab_id, x=0, y=0):
        """Scroll page"""
        r = requests.post(
            f"{self.base_url}/tabs/{tab_id}/scroll",
            json={"x": x, "y": y}
        )
        return r.json()
    
    def find_elements(self, tab_id, selector):
        """Find elements by CSS selector"""
        r = requests.post(
            f"{self.base_url}/tabs/{tab_id}/find",
            json={"selector": selector}
        )
        return r.json()
    
    def call_tool(self, tool_name, params):
        """Generic MCP tool call"""
        r = requests.post(
            f"{self.base_url}/mcp/call/{tool_name}",
            json=params
        )
        return r.json()


def demo():
    """Demo usage of the client"""
    client = BrowserMCPClient()
    
    # Check health
    print("=== Health Check ===")
    print(json.dumps(client.health(), indent=2))
    
    # List tabs
    print("\n=== Open Tabs ===")
    tabs = client.list_tabs()
    print(f"Found {len(tabs)} tabs:")
    for tab in tabs[:5]:  # Show first 5
        print(f"  [{tab['id']}] {tab.get('title', 'Untitled')[:50]}")
        print(f"      {tab.get('url', 'No URL')[:60]}")
    
    if not tabs:
        print("No tabs found. Open a browser tab first!")
        return
    
    # Work with first tab
    tab_id = tabs[0]['id']
    print(f"\n=== Working with tab {tab_id} ===")
    
    # Get content
    print("\nGetting page content...")
    content = client.get_content(tab_id)
    if 'content' in content:
        print(f"Title: {content['content'].get('title')}")
        print(f"URL: {content['content'].get('url')}")
        text = content['content'].get('text', '')
        print(f"Text preview: {text[:200]}...")
    
    # Find elements
    print("\n=== Finding links ===")
    links_result = client.find_elements(tab_id, 'a')
    if 'result' in links_result:
        print(f"Found {links_result['result'].get('count', 0)} links")


if __name__ == '__main__':
    demo()
