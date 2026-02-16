# Browser MCP Bridge - Makefile
# Unified build system for local dev and CI

.PHONY: all build lint install-tools clean build-linux build-darwin build-windows

# Binary name
BINARY_NAME := browser-mcp-host
EXTENSION_HOST_DIR := extension/host

# Go settings
GOCMD := go
GOBUILD := $(GOCMD) build
GOCLEAN := $(GOCMD) clean
GOTEST := $(GOCMD) test
GOGET := $(GOCMD) get
GOMOD := $(GOCMD) mod

# Build flags for static binary
LDFLAGS := -ldflags="-s -w"

# Platforms
PLATFORMS := linux/amd64 linux/arm64 darwin/amd64 darwin/arm64 windows/amd64

# Default target
all: lint build

# Install development tools
install-tools:
	@echo "Installing staticcheck v0.7.0..."
	go install honnef.co/go/tools/cmd/staticcheck@v0.7.0
	@echo "Installing gofumpt..."
	go install mvdan.cc/gofumpt@latest

# Run linter
lint:
	@echo "Running staticcheck..."
	staticcheck ./...
	@echo "Running go vet..."
	go vet ./...
	@echo "Running gofumpt..."
	gofumpt -l -w .

# Download dependencies
deps:
	$(GOMOD) download
	$(GOMOD) tidy

# Build for current platform (dev)
build: deps
	@echo "Building $(BINARY_NAME) for current platform..."
	mkdir -p $(EXTENSION_HOST_DIR)
	$(GOBUILD) $(LDFLAGS) -o $(EXTENSION_HOST_DIR)/$(BINARY_NAME) ./cmd/host

# Cross-compilation targets
build-linux:
	@echo "Building for Linux..."
	mkdir -p $(EXTENSION_HOST_DIR)/linux-amd64
	mkdir -p $(EXTENSION_HOST_DIR)/linux-arm64
	GOOS=linux GOARCH=amd64 $(GOBUILD) $(LDFLAGS) -o $(EXTENSION_HOST_DIR)/linux-amd64/$(BINARY_NAME) ./cmd/host
	GOOS=linux GOARCH=arm64 $(GOBUILD) $(LDFLAGS) -o $(EXTENSION_HOST_DIR)/linux-arm64/$(BINARY_NAME) ./cmd/host

build-darwin:
	@echo "Building for macOS..."
	mkdir -p $(EXTENSION_HOST_DIR)/darwin-amd64
	mkdir -p $(EXTENSION_HOST_DIR)/darwin-arm64
	GOOS=darwin GOARCH=amd64 $(GOBUILD) $(LDFLAGS) -o $(EXTENSION_HOST_DIR)/darwin-amd64/$(BINARY_NAME) ./cmd/host
	GOOS=darwin GOARCH=arm64 $(GOBUILD) $(LDFLAGS) -o $(EXTENSION_HOST_DIR)/darwin-arm64/$(BINARY_NAME) ./cmd/host

build-windows:
	@echo "Building for Windows..."
	mkdir -p $(EXTENSION_HOST_DIR)/windows-amd64
	GOOS=windows GOARCH=amd64 $(GOBUILD) $(LDFLAGS) -o $(EXTENSION_HOST_DIR)/windows-amd64/$(BINARY_NAME).exe ./cmd/host

# Build all platforms
build-all: build-linux build-darwin build-windows

# Package extension with binaries for release
package: build-all
	@echo "Packaging extension..."
	mkdir -p dist
	# Linux amd64
	zip -r dist/browser-mcp-bridge-linux-amd64.zip extension/ -x "extension/host/darwin-*" -x "extension/host/windows-*" -x "extension/host/browser-mcp-host"
	# Linux arm64  
	zip -r dist/browser-mcp-bridge-linux-arm64.zip extension/ -x "extension/host/darwin-*" -x "extension/host/windows-*" -x "extension/host/browser-mcp-host"
	# macOS amd64
	zip -r dist/browser-mcp-bridge-darwin-amd64.zip extension/ -x "extension/host/linux-*" -x "extension/host/windows-*" -x "extension/host/browser-mcp-host"
	# macOS arm64
	zip -r dist/browser-mcp-bridge-darwin-arm64.zip extension/ -x "extension/host/linux-*" -x "extension/host/windows-*" -x "extension/host/browser-mcp-host"
	# Windows amd64
	zip -r dist/browser-mcp-bridge-windows-amd64.zip extension/ -x "extension/host/linux-*" -x "extension/host/darwin-*" -x "extension/host/browser-mcp-host"

# Run tests
test:
	$(GOTEST) -v ./...

# Clean build artifacts
clean:
	$(GOCLEAN)
	rm -rf $(EXTENSION_HOST_DIR)
	rm -rf dist/

# Development helpers
run: build
	./$(EXTENSION_HOST_DIR)/$(BINARY_NAME)

# Format code
fmt:
	gofumpt -l -w .
	$(GOCMD) fmt ./...

# Check formatting
check-fmt:
	@fmt_output=$$(gofumpt -l .); \
	if [ -n "$$fmt_output" ]; then \
		echo "The following files need formatting:"; \
		echo "$$fmt_output"; \
		exit 1; \
	fi
