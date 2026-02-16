// Package server provides HTTP MCP endpoints for external clients like Kimi.
package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// setupMCPRoutes adds MCP protocol endpoints to the mux.
func (s *Server) setupMCPRoutes(mux *http.ServeMux) {
	// MCP 2024-11-05 protocol endpoints
	mux.HandleFunc("/mcp/info", s.handleMCPInfo)
	mux.HandleFunc("/mcp/tools", s.handleMCPTools)
	mux.HandleFunc("/mcp/call/", s.handleMCPCall)
	
	// Direct tab endpoints
	mux.HandleFunc("/tabs", s.handleTabs)
	mux.HandleFunc("/tabs/", s.handleTabActions)
}

func (s *Server) handleMCPInfo(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"name":                "browser-mcp",
		"version":             "1.0.0",
		"protocol_version":    "2024-11-05",
		"tools":               s.handler.GetTools(),
		"extension_connected": s.IsConnected(),
	})
}

func (s *Server) handleMCPTools(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"tools": s.handler.GetTools(),
	})
}

func (s *Server) handleMCPCall(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	toolName := strings.TrimPrefix(r.URL.Path, "/mcp/call/")
	
	var params json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&params); err != nil {
		http.Error(w, fmt.Sprintf(`{"error": "Invalid JSON: %s"}`, err.Error()), http.StatusBadRequest)
		return
	}

	result, err := s.callTool(toolName, params)
	if err != nil {
		s.logger.Error("tool call failed", "tool", toolName, "error", err)
		http.Error(w, fmt.Sprintf(`{"error": "%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"result": result})
}

func (s *Server) handleTabs(w http.ResponseWriter, r *http.Request) {
	if !s.IsConnected() {
		http.Error(w, `{"error": "Extension not connected"}`, http.StatusServiceUnavailable)
		return
	}

	switch r.Method {
	case http.MethodGet:
		tabs, err := s.handler.ListTabs(r.Context())
		if err != nil {
			s.httpError(w, err)
			return
		}
		// Wrap in object for consistency
		s.jsonResponse(w, map[string]any{"tabs": tabs})

	case http.MethodPost:
		var req struct {
			URL string `json:"url"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			s.httpError(w, err)
			return
		}
		s.jsonResponse(w, map[string]any{"created": true, "url": req.URL})

	default:
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleTabActions(w http.ResponseWriter, r *http.Request) {
	if !s.IsConnected() {
		http.Error(w, `{"error": "Extension not connected"}`, http.StatusServiceUnavailable)
		return
	}

	path := strings.TrimPrefix(r.URL.Path, "/tabs/")
	parts := strings.Split(path, "/")
	if len(parts) < 1 {
		http.Error(w, `{"error": "Invalid path"}`, http.StatusBadRequest)
		return
	}

	tabID, err := strconv.Atoi(parts[0])
	if err != nil {
		http.Error(w, `{"error": "Invalid tab ID"}`, http.StatusBadRequest)
		return
	}

	var action string
	if len(parts) > 1 {
		action = parts[1]
	}

	var reqBody map[string]any
	if r.Method == http.MethodPost {
		json.NewDecoder(r.Body).Decode(&reqBody)
	}

	ctx := r.Context()
	
	switch action {
	case "content":
		result, err := s.handler.GetPageContent(ctx, tabID)
		if err != nil {
			s.httpError(w, err)
			return
		}
		s.jsonResponse(w, result)
		
	case "screenshot":
		result, err := s.handler.ScreenshotTab(ctx, tabID)
		if err != nil {
			s.httpError(w, err)
			return
		}
		s.jsonResponse(w, map[string]any{"dataUrl": result})
		
	case "activate":
		if err := s.handler.ActivateTab(ctx, tabID); err != nil {
			s.httpError(w, err)
			return
		}
		s.jsonResponse(w, map[string]any{"success": true})
		
	case "navigate":
		url, _ := reqBody["url"].(string)
		if err := s.handler.NavigateTab(ctx, tabID, url); err != nil {
			s.httpError(w, err)
			return
		}
		s.jsonResponse(w, map[string]any{"success": true, "url": url})
		
	case "close":
		if err := s.handler.CloseTab(ctx, tabID); err != nil {
			s.httpError(w, err)
			return
		}
		s.jsonResponse(w, map[string]any{"success": true})
		
	case "execute":
		script, _ := reqBody["script"].(string)
		result, err := s.handler.ExecuteScript(ctx, tabID, script)
		if err != nil {
			s.httpError(w, err)
			return
		}
		s.jsonResponse(w, map[string]any{"result": result})
		
	case "click":
		selector, _ := reqBody["selector"].(string)
		if err := s.handler.ClickElement(ctx, tabID, selector); err != nil {
			s.httpError(w, err)
			return
		}
		s.jsonResponse(w, map[string]any{"success": true})
		
	case "fill":
		selector, _ := reqBody["selector"].(string)
		value, _ := reqBody["value"].(string)
		if err := s.handler.FillInput(ctx, tabID, selector, value); err != nil {
			s.httpError(w, err)
			return
		}
		s.jsonResponse(w, map[string]any{"success": true})
		
	case "scroll":
		x, _ := reqBody["x"].(float64)
		y, _ := reqBody["y"].(float64)
		if err := s.handler.ScrollPage(ctx, tabID, int(x), int(y)); err != nil {
			s.httpError(w, err)
			return
		}
		s.jsonResponse(w, map[string]any{"success": true})
		
	case "find":
		selector, _ := reqBody["selector"].(string)
		result, err := s.handler.FindElements(ctx, tabID, selector)
		if err != nil {
			s.httpError(w, err)
			return
		}
		s.jsonResponse(w, result)
		
	default:
		if r.Method == http.MethodGet {
			// Default to get content
			result, err := s.handler.GetPageContent(ctx, tabID)
			if err != nil {
				s.httpError(w, err)
				return
			}
			s.jsonResponse(w, result)
		} else {
			http.Error(w, `{"error": "Unknown action"}`, http.StatusBadRequest)
		}
	}
}

// makeTextResult creates an MCP tool result with text content
func makeTextResult(text string) map[string]any {
	return map[string]any{
		"content": []map[string]any{
			{"type": "text", "text": text},
		},
	}
}

// makeJSONResult creates an MCP tool result from any data
func makeJSONResult(data any) (map[string]any, error) {
	jsonBytes, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		return nil, err
	}
	return makeTextResult(string(jsonBytes)), nil
}

func (s *Server) callTool(toolName string, params json.RawMessage) (any, error) {
	ctx := &dummyContext{}
	
	switch toolName {
	case "browser_tabs_list":
		tabs, err := s.handler.ListTabs(ctx)
		if err != nil {
			return nil, err
		}
		return makeJSONResult(tabs)
		
	case "browser_tab_activate":
		var p struct{ TabID int `json:"tabId"` }
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, err
		}
		if err := s.handler.ActivateTab(ctx, p.TabID); err != nil {
			return nil, err
		}
		return makeTextResult(fmt.Sprintf("Tab %d activated", p.TabID)), nil
		
	case "browser_tab_navigate":
		var p struct {
			TabID int    `json:"tabId"`
			URL   string `json:"url"`
		}
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, err
		}
		if err := s.handler.NavigateTab(ctx, p.TabID, p.URL); err != nil {
			return nil, err
		}
		return makeTextResult(fmt.Sprintf("Navigated tab %d to %s", p.TabID, p.URL)), nil
		
	case "browser_tab_close":
		var p struct{ TabID int `json:"tabId"` }
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, err
		}
		if err := s.handler.CloseTab(ctx, p.TabID); err != nil {
			return nil, err
		}
		return makeTextResult(fmt.Sprintf("Tab %d closed", p.TabID)), nil
		
	case "browser_tab_screenshot":
		var p struct{ TabID int `json:"tabId"` }
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, err
		}
		dataUrl, err := s.handler.ScreenshotTab(ctx, p.TabID)
		if err != nil {
			return nil, err
		}
		return makeTextResult(dataUrl), nil
		
	case "browser_page_content":
		var p struct{ TabID int `json:"tabId"` }
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, err
		}
		content, err := s.handler.GetPageContent(ctx, p.TabID)
		if err != nil {
			return nil, err
		}
		return makeJSONResult(content)
		
	case "browser_page_click":
		var p struct {
			TabID    int    `json:"tabId"`
			Selector string `json:"selector"`
		}
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, err
		}
		if err := s.handler.ClickElement(ctx, p.TabID, p.Selector); err != nil {
			return nil, err
		}
		return makeTextResult(fmt.Sprintf("Clicked element: %s", p.Selector)), nil
		
	case "browser_page_fill":
		var p struct {
			TabID    int    `json:"tabId"`
			Selector string `json:"selector"`
			Value    string `json:"value"`
		}
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, err
		}
		if err := s.handler.FillInput(ctx, p.TabID, p.Selector, p.Value); err != nil {
			return nil, err
		}
		return makeTextResult(fmt.Sprintf("Filled %s with: %s", p.Selector, p.Value)), nil
		
	case "browser_page_scroll":
		var p struct {
			TabID int `json:"tabId"`
			X     int `json:"x"`
			Y     int `json:"y"`
		}
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, err
		}
		if err := s.handler.ScrollPage(ctx, p.TabID, p.X, p.Y); err != nil {
			return nil, err
		}
		return makeTextResult(fmt.Sprintf("Scrolled to %d, %d", p.X, p.Y)), nil
		
	case "browser_page_execute":
		var p struct {
			TabID  int    `json:"tabId"`
			Script string `json:"script"`
		}
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, err
		}
		result, err := s.handler.ExecuteScript(ctx, p.TabID, p.Script)
		if err != nil {
			return nil, err
		}
		return makeJSONResult(result)
		
	case "browser_page_find":
		var p struct {
			TabID    int    `json:"tabId"`
			Selector string `json:"selector"`
		}
		if err := json.Unmarshal(params, &p); err != nil {
			return nil, err
		}
		result, err := s.handler.FindElements(ctx, p.TabID, p.Selector)
		if err != nil {
			return nil, err
		}
		return makeJSONResult(result)
		
	default:
		return nil, fmt.Errorf("unknown tool: %s", toolName)
	}
}

// dummyContext implements context.Context for handler calls
type dummyContext struct{}

func (d *dummyContext) Deadline() (deadline time.Time, ok bool) { return time.Time{}, false }
func (d *dummyContext) Done() <-chan struct{} { return nil }
func (d *dummyContext) Err() error { return nil }
func (d *dummyContext) Value(key interface{}) interface{} { return nil }

func (s *Server) jsonResponse(w http.ResponseWriter, data any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(data)
}

func (s *Server) httpError(w http.ResponseWriter, err error) {
	s.logger.Error("request failed", "error", err)
	http.Error(w, fmt.Sprintf(`{"error": "%s"}`, err.Error()), http.StatusInternalServerError)
}
