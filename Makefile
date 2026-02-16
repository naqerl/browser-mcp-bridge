# Browser MCP Bridge Makefile

.PHONY: all build install clean run test diagnose

# Default target
all: build

# Build Go native host
build:
	@echo "Building Go native host..."
	go build -o native-host/host ./cmd/host/
	@echo "Build complete: native-host/host"

# Install dependencies
setup:
	@echo "Setting up Go dependencies..."
	go mod tidy

# Install the native host (build + install manifests)
install: build
	@echo "Installing native host..."
	./install.sh

# Run the host for testing
run: build
	./native-host/host

# Run with debug logging
run-debug: build
	./native-host/host -log-level debug

# Clean build artifacts
clean:
	rm -f native-host/host

# Test the HTTP endpoint
test:
	@echo "Testing HTTP endpoint..."
	@curl -s http://localhost:6277/health || echo "Server not running"

# Run diagnostics
diagnose:
	./diagnose.sh

# Build for all platforms (requires Go cross-compilation)
build-all:
	@echo "Building for all platforms..."
	GOOS=linux GOARCH=amd64 go build -o native-host/host-linux-amd64 ./cmd/host/
	GOOS=linux GOARCH=arm64 go build -o native-host/host-linux-arm64 ./cmd/host/
	GOOS=darwin GOARCH=amd64 go build -o native-host/host-darwin-amd64 ./cmd/host/
	GOOS=darwin GOARCH=arm64 go build -o native-host/host-darwin-arm64 ./cmd/host/
	GOOS=windows GOARCH=amd64 go build -o native-host/host-windows-amd64.exe ./cmd/host/
	@echo "Cross-compile complete"

# Development helpers
fmt:
	go fmt ./...

vet:
	go vet ./...

lint: fmt vet
	@echo "Linting complete"
