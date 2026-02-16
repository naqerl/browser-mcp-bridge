// Package browser implements the browser automation controller.
// The actual automation is performed by the Chrome extension; this package
// forwards requests to the extension via WebSocket.
package browser

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/naqerl/browser-mcp-bridge/internal/mcp"
)

// Controller implements the server.Handler interface by forwarding
// requests to the browser extension via WebSocket.
type Controller struct {
	sender RequestSender
}

// RequestSender sends requests to the extension and returns responses.
type RequestSender interface {
	SendRequest(method string, params any) (*mcp.Message, error)
}

// NewController creates a new browser controller.
func NewController(sender RequestSender) *Controller {
	return &Controller{sender: sender}
}

// ListTabs returns all open tabs.
func (c *Controller) ListTabs(ctx context.Context) ([]mcp.Tab, error) {
	resp, err := c.sender.SendRequest("browser.tabs.query", map[string]any{})
	if err != nil {
		return nil, err
	}
	if resp.Error != nil {
		return nil, resp.Error
	}

	var tabs []mcp.Tab
	if err := json.Unmarshal(resp.Result, &tabs); err != nil {
		return nil, fmt.Errorf("failed to unmarshal tabs: %w", err)
	}
	return tabs, nil
}

// ActivateTab focuses a specific tab.
func (c *Controller) ActivateTab(ctx context.Context, tabID int) error {
	resp, err := c.sender.SendRequest("browser.tabs.update", map[string]any{
		"tabId": tabID,
		"props": map[string]any{"active": true},
	})
	if err != nil {
		return err
	}
	if resp.Error != nil {
		return resp.Error
	}
	return nil
}

// NavigateTab navigates a tab to a URL.
func (c *Controller) NavigateTab(ctx context.Context, tabID int, url string) error {
	resp, err := c.sender.SendRequest("browser.tabs.update", map[string]any{
		"tabId": tabID,
		"props": map[string]any{"url": url},
	})
	if err != nil {
		return err
	}
	if resp.Error != nil {
		return resp.Error
	}
	return nil
}

// CloseTab closes a tab.
func (c *Controller) CloseTab(ctx context.Context, tabID int) error {
	resp, err := c.sender.SendRequest("browser.tabs.remove", map[string]any{
		"tabId": tabID,
	})
	if err != nil {
		return err
	}
	if resp.Error != nil {
		return resp.Error
	}
	return nil
}

// ScreenshotTab takes a screenshot of a tab.
func (c *Controller) ScreenshotTab(ctx context.Context, tabID int) (string, error) {
	// First activate the tab
	if err := c.ActivateTab(ctx, tabID); err != nil {
		return "", err
	}

	resp, err := c.sender.SendRequest("browser.tabs.captureVisibleTab", map[string]any{})
	if err != nil {
		return "", err
	}
	if resp.Error != nil {
		return "", resp.Error
	}

	var dataURL string
	if err := json.Unmarshal(resp.Result, &dataURL); err != nil {
		return "", fmt.Errorf("failed to unmarshal screenshot: %w", err)
	}
	return dataURL, nil
}

// GetPageContent extracts page content from a tab.
func (c *Controller) GetPageContent(ctx context.Context, tabID int) (*mcp.PageContent, error) {
	script := `
		(() => {
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
		})()
	`
	result, err := c.ExecuteScript(ctx, tabID, script)
	if err != nil {
		return nil, err
	}

	content := &mcp.PageContent{}
	data, _ := json.Marshal(result)
	if err := json.Unmarshal(data, content); err != nil {
		return nil, fmt.Errorf("failed to unmarshal content: %w", err)
	}
	return content, nil
}

// ExecuteScript runs JavaScript in a tab.
func (c *Controller) ExecuteScript(ctx context.Context, tabID int, script string) (any, error) {
	resp, err := c.sender.SendRequest("browser.scripting.executeScript", map[string]any{
		"tabId":  tabID,
		"script": script,
	})
	if err != nil {
		return nil, err
	}
	if resp.Error != nil {
		return nil, resp.Error
	}

	var results []struct {
		Result any `json:"result"`
	}
	if err := json.Unmarshal(resp.Result, &results); err != nil {
		return nil, fmt.Errorf("failed to unmarshal script result: %w", err)
	}

	if len(results) == 0 {
		return nil, fmt.Errorf("no result from script execution")
	}
	return results[0].Result, nil
}

// ClickElement clicks an element by CSS selector.
func (c *Controller) ClickElement(ctx context.Context, tabID int, selector string) error {
	script := fmt.Sprintf(`
		(() => {
			const el = document.querySelector(%q);
			if (!el) return { error: 'Element not found' };
			el.click();
			return { clicked: true, tagName: el.tagName };
		})()
	`, selector)

	result, err := c.ExecuteScript(ctx, tabID, script)
	if err != nil {
		return err
	}

	// Check for error in result
	if m, ok := result.(map[string]any); ok {
		if errMsg, ok := m["error"].(string); ok {
			return fmt.Errorf("%s", errMsg)
		}
	}
	return nil
}

// FillInput fills an input field.
func (c *Controller) FillInput(ctx context.Context, tabID int, selector, value string) error {
	script := fmt.Sprintf(`
		(() => {
			const el = document.querySelector(%q);
			if (!el) return { error: 'Element not found' };
			el.value = %q;
			el.dispatchEvent(new Event('input', { bubbles: true }));
			el.dispatchEvent(new Event('change', { bubbles: true }));
			return { filled: true, tagName: el.tagName };
		})()
	`, selector, value)

	result, err := c.ExecuteScript(ctx, tabID, script)
	if err != nil {
		return err
	}

	if m, ok := result.(map[string]any); ok {
		if errMsg, ok := m["error"].(string); ok {
			return fmt.Errorf("%s", errMsg)
		}
	}
	return nil
}

// ScrollPage scrolls the page.
func (c *Controller) ScrollPage(ctx context.Context, tabID int, x, y int) error {
	script := fmt.Sprintf(`
		window.scrollTo(%d, %d);
		return { scrollX: window.scrollX, scrollY: window.scrollY };
	`, x, y)

	_, err := c.ExecuteScript(ctx, tabID, script)
	return err
}

// FindElements finds elements by CSS selector.
func (c *Controller) FindElements(ctx context.Context, tabID int, selector string) (*mcp.FindResult, error) {
	script := fmt.Sprintf(`
		(() => {
			const elements = Array.from(document.querySelectorAll(%q));
			return {
				count: elements.length,
				elements: elements.map(el => ({
					tagName: el.tagName,
					text: el.innerText?.slice(0, 200),
					visible: el.offsetParent !== null
				}))
			};
		})()
	`, selector)

	result, err := c.ExecuteScript(ctx, tabID, script)
	if err != nil {
		return nil, err
	}

	data, _ := json.Marshal(result)
	var findResult mcp.FindResult
	if err := json.Unmarshal(data, &findResult); err != nil {
		return nil, fmt.Errorf("failed to unmarshal find result: %w", err)
	}
	return &findResult, nil
}
