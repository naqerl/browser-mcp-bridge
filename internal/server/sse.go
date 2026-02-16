// Package server provides SSE (Server-Sent Events) MCP endpoints.
package server

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/naqerl/browser-mcp-bridge/internal/mcp"
)

// SSESession represents an active SSE client session.
type SSESession struct {
	ID        string
	Events    chan string
	Done      chan struct{}
	CreatedAt time.Time
}

var (
	sseSessions   = make(map[string]*SSESession)
	sseSessionsMu sync.RWMutex
	sseCounter    int
)

// setupSSERoutes adds SSE MCP endpoints to the mux.
func (s *Server) setupSSERoutes(mux *http.ServeMux) {
	mux.HandleFunc("/sse", s.handleSSE)
	mux.HandleFunc("/message", s.handleSSEMessage)
}

// handleSSE handles Server-Sent Events connections.
func (s *Server) handleSSE(w http.ResponseWriter, r *http.Request) {
	// Set SSE headers
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")

	// Create session
	sseCounter++
	sessionID := fmt.Sprintf("session-%d", sseCounter)
	session := &SSESession{
		ID:        sessionID,
		Events:    make(chan string, 100),
		Done:      make(chan struct{}),
		CreatedAt: time.Now(),
	}

	sseSessionsMu.Lock()
	sseSessions[sessionID] = session
	sseSessionsMu.Unlock()

	// Cleanup on disconnect
	defer func() {
		sseSessionsMu.Lock()
		delete(sseSessions, sessionID)
		sseSessionsMu.Unlock()
		close(session.Events)
	}()

	// Send initial endpoint event
	endpointURL := "/message?session_id=" + sessionID
	fmt.Fprintf(w, "event: endpoint\ndata: %s\n\n", endpointURL)
	w.(http.Flusher).Flush()

	// Keep connection alive and send events
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-session.Done:
			return
		case event, ok := <-session.Events:
			if !ok {
				return
			}
			fmt.Fprintf(w, "data: %s\n\n", event)
			w.(http.Flusher).Flush()
		case <-ticker.C:
			// Send keepalive comment
			fmt.Fprint(w, ": keepalive\n\n")
			w.(http.Flusher).Flush()
		}
	}
}

// handleSSEMessage handles messages from SSE clients.
func (s *Server) handleSSEMessage(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	sessionID := r.URL.Query().Get("session_id")
	if sessionID == "" {
		http.Error(w, `{"error": "Missing session_id"}`, http.StatusBadRequest)
		return
	}

	sseSessionsMu.RLock()
	session, exists := sseSessions[sessionID]
	sseSessionsMu.RUnlock()

	if !exists {
		http.Error(w, `{"error": "Invalid session"}`, http.StatusBadRequest)
		return
	}

	// Parse the message
	var msg mcp.Message
	if err := json.NewDecoder(r.Body).Decode(&msg); err != nil {
		http.Error(w, fmt.Sprintf(`{"error": "Invalid JSON: %s"}`, err.Error()), http.StatusBadRequest)
		return
	}

	// Handle the message
	go s.handleSSEMessageInternal(session, &msg)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{"status": "accepted"})
}

func (s *Server) handleSSEMessageInternal(session *SSESession, msg *mcp.Message) {
	if msg.Method == "" {
		// This is a response to a request we sent
		return
	}

	// Execute the method
	result, err := s.executeMethod(msg.Method, msg.Params)

	var response *mcp.Message
	if err != nil {
		response = mcp.ErrorResponse(msg.ID, -32603, err.Error())
	} else {
		response = mcp.SuccessResponse(msg.ID, result)
	}

	// Send response via SSE
	data, _ := json.Marshal(response)
	select {
	case session.Events <- string(data):
	case <-time.After(5 * time.Second):
		s.logger.Warn("SSE event channel full, dropping message", "session", session.ID)
	}
}

func (s *Server) executeMethod(method string, params json.RawMessage) (any, error) {
	if !s.IsConnected() {
		return nil, fmt.Errorf("extension not connected")
	}

	// Parse params
	var parsed map[string]any
	if len(params) > 0 {
		if err := json.Unmarshal(params, &parsed); err != nil {
			return nil, err
		}
	}

	// Send to extension via WebSocket
	result, err := s.SendRequest(method, parsed)
	if err != nil {
		return nil, err
	}

	if result.Error != nil {
		return nil, fmt.Errorf("%v", result.Error)
	}

	return result.Result, nil
}

// broadcastSSE sends a message to all SSE sessions.
func broadcastSSE(data string) {
	sseSessionsMu.RLock()
	sessions := make([]*SSESession, 0, len(sseSessions))
	for _, s := range sseSessions {
		sessions = append(sessions, s)
	}
	sseSessionsMu.RUnlock()

	for _, session := range sessions {
		select {
		case session.Events <- data:
		default:
		}
	}
}


