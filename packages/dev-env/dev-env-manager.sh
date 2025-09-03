#!/usr/bin/env bash

set -euo pipefail

# =============================================================================
# Dev-env Process Manager - Process Compose Edition
#
# Manages the ATProto development environment using process-compose.
# Handles graceful start/stop/restart with proper signal handling.
# =============================================================================

readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly COMPOSE_FILE="${SCRIPT_DIR}/process-compose.yaml"
readonly STARTUP_TIMEOUT=300
readonly ENV_FILE="${SCRIPT_DIR}/../../.env"

# Colors for output
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly NC='\033[0m' # No Color

# =============================================================================
# Utility Functions
# =============================================================================

# Load environment variables from .env file
load_env_file() {
    if [[ -f "$ENV_FILE" ]]; then
        log_info "Loading environment variables from .env"
        # Export variables from .env file, ignoring comments and empty lines
        set -a  # automatically export all variables
        source "$ENV_FILE"
        set +a  # stop automatically exporting
    else
        log_warning ".env file not found at $ENV_FILE"
    fi
}

# Clean up debug log file if LOG_DESTINATION is set
clean_debug_log() {
    if [[ -n "${LOG_DESTINATION:-}" ]]; then
        if [[ -f "$LOG_DESTINATION" ]]; then
            log_info "Cleaning debug log file: $LOG_DESTINATION"
            rm -f "$LOG_DESTINATION"
        fi
    fi
}

log() {
    echo -e "${1}" >&2
}

log_info() {
    log "${BLUE}ℹ${NC} $1"
}

log_success() {
    log "${GREEN}✓${NC} $1"
}

log_warning() {
    log "${YELLOW}⚠${NC} $1"
}

log_error() {
    log "${RED}✗${NC} $1"
}

# Signal handling for clean interrupts
interrupt_handler() {
    log_warning "Interrupted by user (CTRL+C)"
    cleanup_background_processes
    exit 130
}

# Clean up any background processes we might have started
cleanup_background_processes() {
    if [[ -n "${LOG_PID:-}" ]]; then
        kill "$LOG_PID" 2>/dev/null || true
    fi
}

# Check if process-compose server is running
is_server_running() {
    curl -s --connect-timeout 2 http://localhost:8080 >/dev/null 2>&1
}

# Check if introspection server is responding (indicates services are up)
are_services_running() {
    curl -s --connect-timeout 2 http://localhost:2581 >/dev/null 2>&1
}

# Get mock setup status from introspection server
get_mock_setup_status() {
    if are_services_running; then
        curl -s http://localhost:2581 2>/dev/null | jq -r '.mockSetup.complete // false' 2>/dev/null || echo "false"
    else
        echo "false"
    fi
}

# Display service URLs from introspection server
show_service_urls() {
    echo
    echo "🌐 Service URLs:"
    if are_services_running; then
        echo "  🔍 Introspection:    http://localhost:2581"
        curl -s http://localhost:2581 | jq -r 'to_entries[] | select(.key != "mockSetup") |
          if .key == "scoring" then
            "  🔗 SCORING: " + .value.url + "\n  🔧 SCORING (Internal): " + .value.internalUrl
          else
            "  " + (if .key == "plc" then "👤" elif .key == "pds" then "🌞" elif .key == "bsky" then "🌅" elif .key == "ozone" then "🗼" elif .key == "notes" then "📝" elif .key == "db" then "🗄️" else "🔗" end) + " " + (.key | ascii_upcase) + ": " + .value.url
          end' 2>/dev/null || true
        echo
        echo "🎭 Mock Data Setup:"
        local mock_complete=$(get_mock_setup_status)
        if [[ "$mock_complete" == "true" ]]; then
            echo "  ✅ Mock data setup complete"
        else
            echo "  ⏳ Mock data setup in progress..."
        fi
    else
        echo "  ❌ Services not available (introspection server not responding)"
    fi
}

# =============================================================================
# Core Functions
# =============================================================================

dev_env_status() {
    echo "📊 ATProto Development Environment Status"
    echo "========================================"

    if are_services_running; then
        echo "✅ Dev environment is running"

        # Try to show process status if server is available
        if is_server_running; then
            process-compose list -f "$COMPOSE_FILE" 2>/dev/null || true
        fi
    else
        echo "❌ Dev environment is not running"
    fi

    show_service_urls
}

dev_env_start() {
    echo "🚀 Starting ATProto development environment..."

    # Load environment variables from .env file
    load_env_file

    # Clean up debug log file before starting
    clean_debug_log

    # Start process-compose in detached mode
    if ! process-compose up -D -f "$COMPOSE_FILE"; then
        log_error "Failed to start process-compose"
        return 1
    fi

    echo "⏳ Waiting for services and mock data setup..."
    echo

    # Set up signal handler for interrupts
    trap interrupt_handler SIGINT SIGTERM

    # Wait for process-compose server to be available
    echo "Waiting for process-compose server..."
    while ! is_server_running; do
        sleep 1
    done

    echo "📋 Startup logs:"
    echo "================"

    # Start log streaming in background
    process-compose process logs dev-env -f 2>/dev/null &
    LOG_PID=$!

    # Monitor for completion
    local count=0
    while [[ $count -lt $STARTUP_TIMEOUT ]]; do
        # Check if server is still running (detect external stop)
        if ! is_server_running; then
            kill "$LOG_PID" 2>/dev/null || true
            echo
            log_warning "Process stopped externally"
            return 1
        fi

        # Get recent logs to check for success or failure
        local recent_logs
        recent_logs=$(process-compose process logs dev-env -n 50 2>/dev/null || echo "")

        # Check for "Dev environment ready" message (success)
        if echo "$recent_logs" | grep -q "Dev environment ready"; then
            sleep 1  # Let final logs show
            kill "$LOG_PID" 2>/dev/null || true
            break
        fi

        # Check for error patterns that indicate startup failure
        if echo "$recent_logs" | grep -qE "(Error:|Failed to|❌.*Error|DuplicateProposal|EADDRINUSE|ECONNREFUSED)"; then
            kill "$LOG_PID" 2>/dev/null || true
            echo
            log_error "Startup failed with errors detected in logs"
            echo
            echo "Recent error logs:"
            echo "$recent_logs" | grep -E "(Error:|Failed to|❌.*Error|DuplicateProposal|EADDRINUSE|ECONNREFUSED)" | tail -5
            echo
            log_error "Use 'just process-logs' to see full logs, or 'just clean' to reset"
            return 1
        fi

        # Check if the dev-env process has exited (indicates failure)
        local process_status
        process_status=$(process-compose process status dev-env 2>/dev/null | grep -o "Status: [^,]*" || echo "Status: Unknown")
        if echo "$process_status" | grep -qE "(Status: Completed|Status: Error|Status: Failed)"; then
            kill "$LOG_PID" 2>/dev/null || true
            echo
            log_error "Dev-env process exited unexpectedly: $process_status"
            echo
            echo "Recent logs:"
            echo "$recent_logs" | tail -10
            echo
            log_error "Use 'just process-logs' to see full logs, or 'just clean' to reset"
            return 1
        fi

        sleep 2
        ((count += 2))
    done

    # Remove signal handler
    trap - SIGINT SIGTERM

    if [[ $count -ge $STARTUP_TIMEOUT ]]; then
        kill "$LOG_PID" 2>/dev/null || true
        echo
        log_error "Timeout waiting for services to start (${STARTUP_TIMEOUT}s)"
        echo
        echo "Recent logs:"
        process-compose process logs dev-env -n 20 2>/dev/null | tail -10 || true
        echo
        log_error "Use 'just process-logs' to see full logs, or 'just clean' to reset"
        return 1
    fi

    show_service_urls
}

dev_env_start_nowait() {
    echo "🚀 Starting ATProto development environment..."

    # Load environment variables from .env file
    load_env_file

    # Clean up debug log file before starting
    clean_debug_log

    process-compose up -D -f "$COMPOSE_FILE"
    echo "⏳ Dev-env starting in background. Use 'just status' to check when ready."
}

dev_env_start_foreground() {
    echo "🚀 Starting ATProto development environment in foreground..."

    # Load environment variables from .env file
    load_env_file

    # Clean up debug log file before starting
    clean_debug_log

    process-compose up --no-server -f "$COMPOSE_FILE"
}

dev_env_stop() {
    echo "🛑 Stopping ATProto development environment..."
    echo "   Checking if process-compose server is available..."

    if is_server_running; then
        echo "   ✅ Process-compose server found, stopping gracefully..."
        if process-compose down; then
            echo "✅ Dev-env stopped successfully."
        else
            log_error "Failed to stop via process-compose"
            return 1
        fi
    else
        echo "   ⚠️  Process-compose server not available, forcing cleanup..."
        echo "   This might happen if services are still starting up."
        pkill -f "process-compose" 2>/dev/null || true
        pkill -f "pnpm run start" 2>/dev/null || true
        echo "✅ Dev-env stopped."
    fi
}

dev_env_restart() {
    echo "🔄 Restarting ATProto development environment..."
    dev_env_stop || true
    sleep 2
    dev_env_start
}

dev_env_logs() {
    echo "📋 Showing dev-env process logs..."
    if is_server_running; then
        process-compose process logs dev-env
    else
        echo "❌ Dev environment is not running or process-compose server not available"
        echo "   Start the environment with 'just start' first"
    fi
}

dev_env_health() {
    echo "🏥 Checking service health..."
    echo -n "Introspection (2581): " && (curl -s -o /dev/null -w "%{http_code}" http://localhost:2581 2>/dev/null && echo " (✅ up)") || echo " ❌ down"
    echo -n "DID Placeholder (2582): " && (curl -s -o /dev/null -w "%{http_code}" http://localhost:2582/health 2>/dev/null && echo " (✅ up)") || echo " ❌ down"
    echo -n "Personal Data (2583): " && (curl -s -o /dev/null -w "%{http_code}" http://localhost:2583/xrpc/_health 2>/dev/null && echo " (✅ up)") || echo " ❌ down"
    echo -n "Bsky Appview (2584): " && (curl -s -o /dev/null -w "%{http_code}" http://localhost:2584/xrpc/_health 2>/dev/null && echo " (✅ up)") || echo " ❌ down"
    echo -n "Ozone (2587): " && (curl -s -o /dev/null -w "%{http_code}" http://localhost:2587/xrpc/_health 2>/dev/null && echo " (✅ up)") || echo " ❌ down"
    echo -n "Community Notes (2595): " && (curl -s -o /dev/null -w "%{http_code}" http://localhost:2595/health 2>/dev/null && echo " (✅ up)") || echo " ❌ down"
}

dev_env_server_status() {
    echo "🖥️  Process Compose Server Status:"
    echo "=================================="
    if is_server_running; then
        echo "✅ Process-compose HTTP server is running on port 8080"
        echo "   You can use 'just stop' to stop gracefully"
    else
        echo "❌ Process-compose HTTP server not responding on port 8080"
        echo "   Services might still be starting, or server failed to start"
        echo "   Use 'just stop' for cleanup (will force-kill if needed)"
    fi
}

dev_env_clean() {
    echo "🧹 Cleaning up development environment..."
    echo "   Force-killing any stuck processes..."
    pkill -f "process-compose" 2>/dev/null || true
    pkill -f "pnpm run start" 2>/dev/null || true
    echo "✅ Clean completed."
}

# =============================================================================
# Main Entry Point
# =============================================================================

show_usage() {
    cat << EOF
Usage: $0 {start|start-nowait|start-foreground|stop|restart|status|logs|health|server-status|clean}

Commands:
    start            - Start and wait for all services to be ready
    start-nowait     - Start in background and return immediately
    start-foreground - Start in foreground with logs
    stop             - Stop the dev-env gracefully
    restart          - Stop and start the dev-env
    status           - Show current dev-env status and service URLs
    logs             - Show live logs from dev-env process
    health           - Check health of all services
    server-status    - Check process-compose server status
    clean            - Force cleanup of stuck processes

Exit codes:
    0   - Success
    1   - Error
    130 - Interrupted by user (CTRL+C)
EOF
}

main() {
    case "${1:-}" in
        start)
            dev_env_start
            ;;
        start-nowait)
            dev_env_start_nowait
            ;;
        start-foreground)
            dev_env_start_foreground
            ;;
        stop)
            dev_env_stop
            ;;
        restart)
            dev_env_restart
            ;;
        status)
            dev_env_status
            ;;
        logs)
            dev_env_logs
            ;;
        health)
            dev_env_health
            ;;
        server-status)
            dev_env_server_status
            ;;
        clean)
            dev_env_clean
            ;;
        *)
            show_usage
            exit 1
            ;;
    esac
}

# Only run main if script is executed directly (not sourced)
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi
