// Package mcp implements the Model Context Protocol types and handlers.
package mcp

import (
	"encoding/json"
	"fmt"
)

// Message represents a generic MCP message.
type Message struct {
	ID     int             `json:"id"`
	Method string          `json:"method,omitempty"`
	Params json.RawMessage `json:"params,omitempty"`
	Result json.RawMessage `json:"result,omitempty"`
	Error  *Error          `json:"error,omitempty"`
}

// Error represents an MCP error.
type Error struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
	Data    any    `json:"data,omitempty"`
}

func (e Error) Error() string {
	return fmt.Sprintf("MCP error %d: %s", e.Code, e.Message)
}

// Tool represents an available MCP tool.
type Tool struct {
	Name        string     `json:"name"`
	Description string     `json:"description"`
	InputSchema Parameters `json:"inputSchema"`
}

// Parameters describes tool parameters.
type Parameters struct {
	Type       string              `json:"type"`
	Properties map[string]Property `json:"properties"`
	Required   []string            `json:"required"`
}

// Property describes a single parameter property.
type Property struct {
	Type        string `json:"type"`
	Description string `json:"description"`
}

// Tab represents a browser tab.
type Tab struct {
	ID       int    `json:"id"`
	WindowID int    `json:"windowId"`
	Index    int    `json:"index"`
	URL      string `json:"url"`
	Title    string `json:"title"`
	Active   bool   `json:"active"`
	Pinned   bool   `json:"pinned"`
	Audible  bool   `json:"audible"`
	Status   string `json:"status"`
}

// ListTabsParams parameters for tabs/list.
type ListTabsParams struct{}

// ActivateTabParams parameters for tabs/activate.
type ActivateTabParams struct {
	TabID int `json:"tabId"`
}

// NavigateTabParams parameters for tabs/navigate.
type NavigateTabParams struct {
	TabID int    `json:"tabId"`
	URL   string `json:"url"`
}

// CloseTabParams parameters for tabs/close.
type CloseTabParams struct {
	TabID int `json:"tabId"`
}

// ScreenshotTabParams parameters for tabs/screenshot.
type ScreenshotTabParams struct {
	TabID int `json:"tabId"`
}

// GetContentParams parameters for page/getContent.
type GetContentParams struct {
	TabID int `json:"tabId"`
}

// ExecuteScriptParams parameters for page/executeScript.
type ExecuteScriptParams struct {
	TabID  int    `json:"tabId"`
	Script string `json:"script"`
}

// ClickElementParams parameters for page/click.
type ClickElementParams struct {
	TabID    int    `json:"tabId"`
	Selector string `json:"selector"`
}

// FillInputParams parameters for page/fill.
type FillInputParams struct {
	TabID    int    `json:"tabId"`
	Selector string `json:"selector"`
	Value    string `json:"value"`
}

// ScrollPageParams parameters for page/scroll.
type ScrollPageParams struct {
	TabID int `json:"tabId"`
	X     int `json:"x"`
	Y     int `json:"y"`
}

// FindElementParams parameters for page/find.
type FindElementParams struct {
	TabID    int    `json:"tabId"`
	Selector string `json:"selector"`
}

// PageContent represents extracted page content.
type PageContent struct {
	Title string `json:"title"`
	URL   string `json:"url"`
	Text  string `json:"text"`
	HTML  string `json:"html"`
	Links []Link `json:"links"`
}

// Link represents a page link.
type Link struct {
	Text string `json:"text"`
	Href string `json:"href"`
}

// ElementInfo represents information about a found element.
type ElementInfo struct {
	TagName  string `json:"tagName"`
	Text     string `json:"text"`
	Visible  bool   `json:"visible"`
	Selector string `json:"selector"`
}

// FindResult represents the result of finding elements.
type FindResult struct {
	Count    int           `json:"count"`
	Elements []ElementInfo `json:"elements"`
}

// SuccessResponse creates a success result message.
func SuccessResponse(id int, result any) *Message {
	data, _ := json.Marshal(result)
	return &Message{
		ID:     id,
		Result: data,
	}
}

// ErrorResponse creates an error result message.
func ErrorResponse(id int, code int, message string) *Message {
	return &Message{
		ID:    id,
		Error: &Error{Code: code, Message: message},
	}
}

// GetTools returns the list of available MCP tools.
func GetTools() []Tool {
	return []Tool{
		{
			Name:        "browser_tabs_list",
			Description: "List all open browser tabs",
			InputSchema: Parameters{Type: "object", Properties: map[string]Property{}, Required: []string{}},
		},
		{
			Name:        "browser_tab_activate",
			Description: "Activate/focus a specific tab",
			InputSchema: Parameters{
				Type: "object",
				Properties: map[string]Property{
					"tabId": {Type: "integer", Description: "ID of the tab to activate"},
				},
				Required: []string{"tabId"},
			},
		},
		{
			Name:        "browser_tab_navigate",
			Description: "Navigate a tab to a URL",
			InputSchema: Parameters{
				Type: "object",
				Properties: map[string]Property{
					"tabId": {Type: "integer", Description: "ID of the tab"},
					"url":   {Type: "string", Description: "URL to navigate to"},
				},
				Required: []string{"tabId", "url"},
			},
		},
		{
			Name:        "browser_tab_close",
			Description: "Close a tab",
			InputSchema: Parameters{
				Type: "object",
				Properties: map[string]Property{
					"tabId": {Type: "integer", Description: "ID of the tab to close"},
				},
				Required: []string{"tabId"},
			},
		},
		{
			Name:        "browser_tab_screenshot",
			Description: "Take a screenshot of a tab",
			InputSchema: Parameters{
				Type: "object",
				Properties: map[string]Property{
					"tabId": {Type: "integer", Description: "ID of the tab"},
				},
				Required: []string{"tabId"},
			},
		},
		{
			Name:        "browser_page_content",
			Description: "Get page content (text, HTML, links)",
			InputSchema: Parameters{
				Type: "object",
				Properties: map[string]Property{
					"tabId": {Type: "integer", Description: "ID of the tab"},
				},
				Required: []string{"tabId"},
			},
		},
		{
			Name:        "browser_page_click",
			Description: "Click an element by CSS selector",
			InputSchema: Parameters{
				Type: "object",
				Properties: map[string]Property{
					"tabId":    {Type: "integer", Description: "ID of the tab"},
					"selector": {Type: "string", Description: "CSS selector"},
				},
				Required: []string{"tabId", "selector"},
			},
		},
		{
			Name:        "browser_page_fill",
			Description: "Fill an input field",
			InputSchema: Parameters{
				Type: "object",
				Properties: map[string]Property{
					"tabId":    {Type: "integer", Description: "ID of the tab"},
					"selector": {Type: "string", Description: "CSS selector"},
					"value":    {Type: "string", Description: "Value to fill"},
				},
				Required: []string{"tabId", "selector", "value"},
			},
		},
		{
			Name:        "browser_page_scroll",
			Description: "Scroll the page",
			InputSchema: Parameters{
				Type: "object",
				Properties: map[string]Property{
					"tabId": {Type: "integer", Description: "ID of the tab"},
					"x":     {Type: "integer", Description: "X scroll position"},
					"y":     {Type: "integer", Description: "Y scroll position"},
				},
				Required: []string{"tabId"},
			},
		},
		{
			Name:        "browser_page_execute",
			Description: "Execute JavaScript in the page",
			InputSchema: Parameters{
				Type: "object",
				Properties: map[string]Property{
					"tabId":  {Type: "integer", Description: "ID of the tab"},
					"script": {Type: "string", Description: "JavaScript code"},
				},
				Required: []string{"tabId", "script"},
			},
		},
		{
			Name:        "browser_page_find",
			Description: "Find elements by CSS selector",
			InputSchema: Parameters{
				Type: "object",
				Properties: map[string]Property{
					"tabId":    {Type: "integer", Description: "ID of the tab"},
					"selector": {Type: "string", Description: "CSS selector"},
				},
				Required: []string{"tabId", "selector"},
			},
		},
	}
}
