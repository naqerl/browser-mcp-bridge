// Browser MCP Bridge - Native Host
// This binary is launched by the browser extension via native messaging.
// It starts a WebSocket server and bridges MCP requests.
package main

import (
	"bufio"
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/naqerl/browser-mcp-bridge/internal/browser"
	"github.com/naqerl/browser-mcp-bridge/internal/mcp"
	"github.com/naqerl/browser-mcp-bridge/internal/server"
)

// NativeMessage represents a message from/to the browser extension.
type NativeMessage struct {
	Port   int    `json:"port,omitempty"`
	Error  string `json:"error,omitempty"`
	Status string `json:"status,omitempty"`
}

func main() {
	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{
		Level: slog.LevelDebug,
	}))

	logger.Info("Browser MCP Bridge starting", "version", "1.0.0")

	// Create server and controller
	// The controller needs the server to send requests, and the server needs
	// the controller to handle requests. We use a placeholder that gets set later.
	var srv *server.Server
	var ctrl *browser.Controller

	// Initialize controller with a lazy sender that will use srv when ready
	sender := &lazySender{logger: logger}
	ctrl = browser.NewController(sender)

	srv = server.New(ctrl, logger)
	sender.server = srv

	// Start WebSocket server
	port, err := srv.Start()
	if err != nil {
		logger.Error("failed to start server", "error", err)
		sendNativeMessage(NativeMessage{Error: err.Error()})
		os.Exit(1)
	}

	logger.Info("WebSocket server started", "port", port)

	// Send port to extension via native messaging
	if err := sendNativeMessage(NativeMessage{Port: port}); err != nil {
		logger.Error("failed to send port to extension", "error", err)
		os.Exit(1)
	}

	// Wait for extension to connect via WebSocket
	logger.Info("waiting for extension connection...")
	waitCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	for {
		if srv.IsConnected() {
			logger.Info("extension connected via WebSocket")
			break
		}
		select {
		case <-waitCtx.Done():
			logger.Error("timeout waiting for extension connection")
			sendNativeMessage(NativeMessage{Error: "timeout waiting for WebSocket connection"})
			os.Exit(1)
		case <-time.After(100 * time.Millisecond):
			// Continue waiting
		}
	}

	// Send ready status
	sendNativeMessage(NativeMessage{Status: "ready"})

	// Handle shutdown gracefully
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	// Keep native messaging channel open for heartbeat
	go func() {
		reader := bufio.NewReader(os.Stdin)
		for {
			msg, err := readNativeMessage(reader)
			if err != nil {
				if err == io.EOF {
					logger.Info("native messaging channel closed")
					return
				}
				logger.Error("failed to read native message", "error", err)
				continue
			}
			logger.Debug("received native message", "msg", msg)
		}
	}()

	// Wait for shutdown signal
	select {
	case <-sigChan:
		logger.Info("received shutdown signal")
	case <-waitForDisconnect(srv):
		logger.Info("extension disconnected")
	}

	// Graceful shutdown
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()

	if err := srv.Stop(shutdownCtx); err != nil {
		logger.Error("error during shutdown", "error", err)
	}

	logger.Info("Browser MCP Bridge stopped")
}

// lazySender is a RequestSender that delegates to the server once it's ready.
type lazySender struct {
	server *server.Server
	logger *slog.Logger
	mu     sync.RWMutex
}

func (l *lazySender) SendRequest(method string, params any) (*mcp.Message, error) {
	l.mu.RLock()
	srv := l.server
	l.mu.RUnlock()

	if srv == nil {
		return nil, fmt.Errorf("server not ready")
	}
	return srv.SendRequest(method, params)
}

func readNativeMessage(reader *bufio.Reader) (*NativeMessage, error) {
	// Read 4-byte length (native endian)
	lengthBytes := make([]byte, 4)
	if _, err := io.ReadFull(reader, lengthBytes); err != nil {
		return nil, err
	}
	length := binary.NativeEndian.Uint32(lengthBytes)

	// Read message
	data := make([]byte, length)
	if _, err := io.ReadFull(reader, data); err != nil {
		return nil, err
	}

	var msg NativeMessage
	if err := json.Unmarshal(data, &msg); err != nil {
		return nil, err
	}
	return &msg, nil
}

func sendNativeMessage(msg NativeMessage) error {
	data, err := json.Marshal(msg)
	if err != nil {
		return err
	}

	// Write 4-byte length (native endian)
	length := uint32(len(data))
	if err := binary.Write(os.Stdout, binary.NativeEndian, length); err != nil {
		return err
	}

	// Write message
	_, err = os.Stdout.Write(data)
	return err
}

func waitForDisconnect(srv *server.Server) <-chan struct{} {
	ch := make(chan struct{})
	go func() {
		for {
			if !srv.IsConnected() {
				close(ch)
				return
			}
			time.Sleep(500 * time.Millisecond)
		}
	}()
	return ch
}
