// Browser MCP Bridge - Native Host
// Starts a WebSocket server for browser extension to connect to.
// For Flatpak browsers: Run this binary manually, extension connects via WebSocket.
// For regular browsers: Can be launched via native messaging (legacy mode).
package main

import (
	"bufio"
	"context"
	"encoding/binary"
	"encoding/json"
	"flag"
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

const defaultPort = 6277

// NativeMessage represents a message from/to the browser extension (legacy native messaging).
type NativeMessage struct {
	Port   int    `json:"port,omitempty"`
	Error  string `json:"error,omitempty"`
	Status string `json:"status,omitempty"`
}

func main() {
	var (
		port     = flag.Int("port", defaultPort, "WebSocket server port")
		native   = flag.Bool("native", false, "Use native messaging mode (legacy)")
		logLevel = flag.String("log-level", "info", "Log level (debug, info, warn, error)")
	)
	flag.Parse()

	// Setup logger
	level := slog.LevelInfo
	switch *logLevel {
	case "debug":
		level = slog.LevelDebug
	case "warn":
		level = slog.LevelWarn
	case "error":
		level = slog.LevelError
	}
	logger := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{
		Level: level,
	}))

	logger.Info("Browser MCP Bridge starting", "version", "1.0.0", "port", *port, "native", *native)

	// Create server and controller
	var srv *server.Server
	var ctrl *browser.Controller

	sender := &lazySender{logger: logger}
	ctrl = browser.NewController(sender)

	srv = server.New(ctrl, logger)
	sender.server = srv

	// Start WebSocket server on fixed port
	actualPort, err := srv.StartFixed(*port)
	if err != nil {
		logger.Error("failed to start server", "error", err)
		if *native {
			sendNativeMessage(NativeMessage{Error: err.Error()})
		}
		os.Exit(1)
	}

	logger.Info("WebSocket server started", "port", actualPort, "url", fmt.Sprintf("ws://localhost:%d/ws", actualPort))

	// If in native mode, communicate via native messaging
	if *native {
		// Send port to extension via native messaging
		if err := sendNativeMessage(NativeMessage{Port: actualPort}); err != nil {
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
	} else {
		// Standalone mode - just wait for WebSocket connections
		logger.Info("running in standalone mode", "url", fmt.Sprintf("ws://localhost:%d/ws", actualPort))
	}

	// Handle shutdown gracefully
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	// Wait for shutdown signal or disconnect
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
