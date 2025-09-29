#!/usr/bin/env sh

# Example usage:
# ./with_test_network.sh python my_scoring_service.py
# ./with_test_network.sh curl -X POST http://localhost:2597/score -H "Content-Type: application/json" -d '{"proposalUri": "at://test", "status": "needs_more_ratings", "score": 0.5}'

set -e

dir=$(dirname $0)
. ${dir}/_common.sh

# Test network process ID
TEST_NETWORK_PID=""

# Cleanup function for test network
cleanup_test_network() {
    if [ -n "$TEST_NETWORK_PID" ]; then
        echo "Shutting down test network (PID: $TEST_NETWORK_PID)..."
        kill $TEST_NETWORK_PID 2>/dev/null || true
        wait $TEST_NETWORK_PID 2>/dev/null || true
        echo "Test network shutdown complete."
    fi
}

# Signal handler
on_sigint_with_network() {
    cleanup_test_network
    # Call the original cleanup from _common.sh
    cleanup "db_test redis_test"
    exit 130  # Standard exit code for SIGINT
}

# Trap signals
trap "on_sigint_with_network" INT TERM

# Start test network in background
start_test_network() {
    echo "Starting test network..."
    
    # Create a temporary file to capture the introspection port
    INTROSPECT_PORT_FILE=$(mktemp)
    
    # Set log environment variables similar to 'just test'
    LOG_LEVEL=debug \
    LOG_ENABLED=true \
    LOG_DESTINATION="../../test.log" \
    DB_POSTGRES_URL="${DB_POSTGRES_URL}" \
    REDIS_HOST="${REDIS_HOST}" \
    node --import=tsx test-network-runner.ts > >(tee /dev/stderr | grep "Introspection URL:" | sed 's/.*localhost:\([0-9]*\).*/\1/' > "$INTROSPECT_PORT_FILE") &
    
    TEST_NETWORK_PID=$!
    
    # Wait a bit for the test network to start up
    echo "Waiting for test network to initialize..."
    sleep 8
    
    # Check if the process is still running
    if ! kill -0 $TEST_NETWORK_PID 2>/dev/null; then
        echo "❌ Test network failed to start"
        rm -f "$INTROSPECT_PORT_FILE"
        exit 1
    fi
    
    # Read the introspection port
    if [ -f "$INTROSPECT_PORT_FILE" ] && [ -s "$INTROSPECT_PORT_FILE" ]; then
        INTROSPECT_PORT=$(cat "$INTROSPECT_PORT_FILE")
        export INTROSPECT_PORT
        echo "✅ Test network started (PID: $TEST_NETWORK_PID, Introspection Port: $INTROSPECT_PORT)"
    else
        echo "✅ Test network started (PID: $TEST_NETWORK_PID, Introspection Port: not available)"
    fi
    
    # Clean up the temporary file
    rm -f "$INTROSPECT_PORT_FILE"
}

# Main function that wraps the existing main with test network setup
main_with_test_network() {
    # First set up redis and db using the existing infrastructure
    local services="db_test redis_test"
    local postgres_url_env_var="DB_POSTGRES_URL"
    local redis_host_env_var="REDIS_HOST"

    postgres_url="${!postgres_url_env_var}"
    redis_host="${!redis_host_env_var}"

    if [ -n "${postgres_url}" ]; then
        echo "Using ${postgres_url_env_var} (${postgres_url}) to connect to postgres."
        pg_init "${postgres_url}"
    else
        echo "Postgres connection string missing did you set ${postgres_url_env_var}?"
        exit 1
    fi

    if [ -n "${redis_host}" ]; then
        echo "Using ${redis_host_env_var} (${redis_host}) to connect to Redis."
    else
        echo "Redis connection string missing did you set ${redis_host_env_var}?"
        echo "Continuing without Redis..."
    fi

    # Start the test network
    start_test_network

    # Run the user's command
    echo "Running command: $@"
    set +e  # Don't exit on command failure so we can cleanup properly
    
    DB_POSTGRES_URL="${postgres_url}" \
    REDIS_HOST="${redis_host}" \
    INTROSPECT_PORT="${INTROSPECT_PORT}" \
    "$@"
    
    command_exit_code=$?
    
    # Cleanup
    cleanup_test_network
    cleanup "db_test redis_test"
    
    # Exit with the same code as the user's command
    exit $command_exit_code
}

# Check if docker is available and route to appropriate main function
if ! docker ps >/dev/null 2>&1; then
    echo "Docker unavailable. Running on host."
    main_with_test_network "$@"
else
    # For docker mode, we need to modify the approach slightly
    SERVICES="db_test redis_test" main_docker_with_network "$@"
fi

# Docker version of main function
main_docker_with_network() {
    local services="db_test redis_test"
    
    dir=$(dirname $0)
    compose_file="${dir}/docker-compose.yaml"
    
    started_container=false
    
    # Enhanced cleanup for docker mode
    cleanup_docker_with_network() {
        cleanup_test_network
        if $started_container; then
            docker compose --file $compose_file rm --force --stop --volumes ${services}
        fi
    }
    
    # Enhanced signal handler for docker mode
    trap "cleanup_docker_with_network; exit 130" INT TERM
    
    # Check if all services are running already
    not_running=false
    for service in $services; do
        container_id=$(get_container_id $compose_file $service)
        if [ -z $container_id ]; then
            not_running=true
            break
        fi
    done
    
    # If any are missing, recreate all services
    if $not_running; then
        started_container=true
        docker compose --file $compose_file up --wait --force-recreate ${services}
    else
        echo "all services ${services} are already running"
    fi
    
    # Setup environment and start test network
    export_env
    start_test_network
    
    # Run user command
    set +e
    INTROSPECT_PORT="${INTROSPECT_PORT}" "$@"
    command_exit_code=$?
    
    # Cleanup
    cleanup_docker_with_network
    exit $command_exit_code
}
