// Package server implements the WebSocket server for browser communication.
package server

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/naqerl/browser-mcp-bridge/internal/mcp"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		// Allow connections from browser extension
		return true
	},
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
}

// Handler handles MCP requests from the browser.
type Handler interface {
	ListTabs(ctx context.Context) ([]mcp.Tab, error)
	ActivateTab(ctx context.Context, tabID int) error
	NavigateTab(ctx context.Context, tabID int, url string) error
	CloseTab(ctx context.Context, tabID int) error
	ScreenshotTab(ctx context.Context, tabID int) (string, error)
	GetPageContent(ctx context.Context, tabID int) (*mcp.PageContent, error)
	ExecuteScript(ctx context.Context, tabID int, script string) (any, error)
	ClickElement(ctx context.Context, tabID int, selector string) error
	FillInput(ctx context.Context, tabID int, selector, value string) error
	ScrollPage(ctx context.Context, tabID int, x, y int) error
	FindElements(ctx context.Context, tabID int, selector string) (*mcp.FindResult, error)
	GetTools() []mcp.Tool
}

// Server manages WebSocket connections and handles MCP messages.
type Server struct {
	handler     Handler
	listener    net.Listener
	server      *http.Server
	conn        *websocket.Conn
	connMu      sync.RWMutex
	requestMu   sync.Mutex
	pendingReqs map[int]chan *mcp.Message
	reqID       int
	logger      *slog.Logger
}

// New creates a new WebSocket server.
func New(handler Handler, logger *slog.Logger) *Server {
	return &Server{
		handler:     handler,
		pendingReqs: make(map[int]chan *mcp.Message),
		logger:      logger,
	}
}

// Start starts the WebSocket server on an ephemeral port.
// Returns the port number and any error.
func (s *Server) Start() (int, error) {
	return s.StartFixed(0)
}

// StartFixed starts the WebSocket server on a specific port (or 0 for ephemeral).
// Returns the actual port number and any error.
func (s *Server) StartFixed(port int) (int, error) {
	addr := fmt.Sprintf("127.0.0.1:%d", port)
	listener, err := net.Listen("tcp", addr)
	if err != nil {
		return 0, fmt.Errorf("failed to listen on %s: %w", addr, err)
	}
	s.listener = listener

	mux := http.NewServeMux()
	mux.HandleFunc("/ws", s.handleWebSocket)
	mux.HandleFunc("/health", s.handleHealth)
	
	// MCP 2024-11-05 protocol - root endpoint for initialization
	mux.HandleFunc("/", s.handleMCPRoot)
	
	// Add HTTP MCP endpoints
	s.setupMCPRoutes(mux)
	
	// Add SSE MCP endpoints
	s.setupSSERoutes(mux)

	s.server = &http.Server{
		Handler:      corsMiddleware(mux),
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
	}

	go func() {
		if err := s.server.Serve(listener); err != nil && err != http.ErrServerClosed {
			s.logger.Error("server error", "error", err)
		}
	}()

	return listener.Addr().(*net.TCPAddr).Port, nil
}

// Stop stops the server.
func (s *Server) Stop(ctx context.Context) error {
	if s.conn != nil {
		s.conn.Close()
	}
	return s.server.Shutdown(ctx)
}

// IsConnected returns true if a WebSocket client is connected.
func (s *Server) IsConnected() bool {
	s.connMu.RLock()
	defer s.connMu.RUnlock()
	return s.conn != nil
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	response := map[string]any{
		"status":              "ok",
		"extension_connected": s.IsConnected(),
	}
	json.NewEncoder(w).Encode(response)
}

// handleMCPRoot handles the root endpoint for MCP 2024-11-05 protocol
func (s *Server) handleMCPRoot(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}

	// MCP protocol requires POST for initialization
	if r.Method == http.MethodGet {
		// Return server info
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"name":             "browser-mcp",
			"version":          "1.0.0",
			"protocol_version": "2024-11-05",
		})
		return
	}

	if r.Method != http.MethodPost {
		http.Error(w, `{"error": "Method not allowed"}`, http.StatusMethodNotAllowed)
		return
	}

	// Parse MCP request
	var req struct {
		JSONRPC string          `json:"jsonrpc"`
		ID      any             `json:"id"`
		Method  string          `json:"method"`
		Params  json.RawMessage `json:"params"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf(`{"error": "Invalid JSON: %s"}`, err.Error()), http.StatusBadRequest)
		return
	}

	// Handle MCP methods
	var result any
	var err error

	switch req.Method {
	case "initialize":
		result = map[string]any{
			"protocolVersion": "2024-11-05",
			"capabilities":    map[string]any{},
			"serverInfo": map[string]any{
				"name":    "browser-mcp",
				"version": "1.0.0",
			},
		}
	case "tools/list":
		result = map[string]any{"tools": mcp.GetTools()}
	case "tools/call":
		var toolReq struct {
			Name string          `json:"name"`
			Args json.RawMessage `json:"arguments"`
		}
		if err = json.Unmarshal(req.Params, &toolReq); err == nil {
			result, err = s.callTool(toolReq.Name, toolReq.Args)
		}
	default:
		err = fmt.Errorf("unknown method: %s", req.Method)
	}

	// Build response
	response := map[string]any{
		"jsonrpc": "2.0",
		"id":      req.ID,
	}

	if err != nil {
		response["error"] = map[string]any{
			"code":    -32603,
			"message": err.Error(),
		}
	} else {
		response["result"] = result
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		s.logger.Error("websocket upgrade failed", "error", err)
		return
	}

	s.connMu.Lock()
	s.conn = conn
	s.connMu.Unlock()

	s.logger.Info("client connected", "remote", r.RemoteAddr)

	defer func() {
		s.connMu.Lock()
		s.conn = nil
		s.connMu.Unlock()
		conn.Close()
		s.logger.Info("client disconnected")
	}()

	// Read loop
	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				s.logger.Error("websocket read error", "error", err)
			}
			return
		}

		var msg mcp.Message
		if err := json.Unmarshal(data, &msg); err != nil {
			s.logger.Error("failed to unmarshal message", "error", err)
			continue
		}

		// Handle response to pending request
		if msg.ID != 0 && (msg.Result != nil || msg.Error != nil) {
			s.requestMu.Lock()
			ch, ok := s.pendingReqs[msg.ID]
			s.requestMu.Unlock()
			if ok {
				ch <- &msg
				continue
			}
		}

		// Handle incoming request
		go s.handleRequest(&msg)
	}
}

func (s *Server) handleRequest(msg *mcp.Message) {
	ctx := context.Background()
	var result any
	var err error

	s.logger.Debug("handling request", "method", msg.Method, "id", msg.ID)

	switch msg.Method {
	case "tabs/list":
		result, err = s.handler.ListTabs(ctx)
	case "tabs/activate":
		var params mcp.ActivateTabParams
		if err = json.Unmarshal(msg.Params, &params); err == nil {
			err = s.handler.ActivateTab(ctx, params.TabID)
		}
	case "tabs/navigate":
		var params mcp.NavigateTabParams
		if err = json.Unmarshal(msg.Params, &params); err == nil {
			err = s.handler.NavigateTab(ctx, params.TabID, params.URL)
		}
	case "tabs/close":
		var params mcp.CloseTabParams
		if err = json.Unmarshal(msg.Params, &params); err == nil {
			err = s.handler.CloseTab(ctx, params.TabID)
		}
	case "tabs/screenshot":
		var params mcp.ScreenshotTabParams
		if err = json.Unmarshal(msg.Params, &params); err == nil {
			result, err = s.handler.ScreenshotTab(ctx, params.TabID)
		}
	case "page/getContent":
		var params mcp.GetContentParams
		if err = json.Unmarshal(msg.Params, &params); err == nil {
			result, err = s.handler.GetPageContent(ctx, params.TabID)
		}
	case "page/executeScript":
		var params mcp.ExecuteScriptParams
		if err = json.Unmarshal(msg.Params, &params); err == nil {
			result, err = s.handler.ExecuteScript(ctx, params.TabID, params.Script)
		}
	case "page/click":
		var params mcp.ClickElementParams
		if err = json.Unmarshal(msg.Params, &params); err == nil {
			err = s.handler.ClickElement(ctx, params.TabID, params.Selector)
		}
	case "page/fill":
		var params mcp.FillInputParams
		if err = json.Unmarshal(msg.Params, &params); err == nil {
			err = s.handler.FillInput(ctx, params.TabID, params.Selector, params.Value)
		}
	case "page/scroll":
		var params mcp.ScrollPageParams
		if err = json.Unmarshal(msg.Params, &params); err == nil {
			err = s.handler.ScrollPage(ctx, params.TabID, params.X, params.Y)
		}
	case "page/find":
		var params mcp.FindElementParams
		if err = json.Unmarshal(msg.Params, &params); err == nil {
			result, err = s.handler.FindElements(ctx, params.TabID, params.Selector)
		}
	case "mcp/tools":
		result = mcp.GetTools()
	case "ping":
		// Keepalive ping - just respond with pong
		result = map[string]any{"pong": true}
	case "extension/error":
		// Log extension errors for debugging
		var params struct {
			Message string `json:"message"`
			Stack   string `json:"stack"`
			Context string `json:"context"`
			Time    int64  `json:"time"`
		}
		if err = json.Unmarshal(msg.Params, &params); err == nil {
			s.logger.Error("extension error", 
				"context", params.Context, 
				"message", params.Message, 
				"stack", params.Stack)
			result = map[string]any{"logged": true}
		}
	default:
		err = fmt.Errorf("unknown method: %s", msg.Method)
	}

	var response *mcp.Message
	if err != nil {
		s.logger.Error("request failed", "method", msg.Method, "error", err)
		response = mcp.ErrorResponse(msg.ID, -32603, err.Error())
	} else {
		response = mcp.SuccessResponse(msg.ID, result)
	}

	s.sendMessage(response)
}

func (s *Server) sendMessage(msg *mcp.Message) error {
	s.connMu.RLock()
	conn := s.conn
	s.connMu.RUnlock()

	if conn == nil {
		return fmt.Errorf("not connected")
	}

	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}

	return conn.WriteMessage(websocket.TextMessage, data)
}

// SendRequest sends a request to the browser extension and waits for response.
// This is used when the Go host needs to initiate communication.
func (s *Server) SendRequest(method string, params any) (*mcp.Message, error) {
	s.connMu.RLock()
	conn := s.conn
	s.connMu.RUnlock()

	if conn == nil {
		return nil, fmt.Errorf("not connected")
	}

	s.requestMu.Lock()
	s.reqID += 1000  // Use large increments to avoid collision with extension IDs
	id := s.reqID
	ch := make(chan *mcp.Message, 1)
	s.pendingReqs[id] = ch
	s.requestMu.Unlock()

	defer func() {
		s.requestMu.Lock()
		delete(s.pendingReqs, id)
		s.requestMu.Unlock()
	}()

	paramsData, _ := json.Marshal(params)
	s.logger.Debug("SendRequest", "method", method, "params", string(paramsData))
	msg := &mcp.Message{
		ID:     id,
		Method: method,
		Params: paramsData,
	}

	if err := s.sendMessage(msg); err != nil {
		return nil, err
	}

	select {
	case resp := <-ch:
		return resp, nil
	case <-time.After(30 * time.Second):
		return nil, fmt.Errorf("request timeout")
	}
}
