#!/bin/bash

# Community Notes Test Utilities
# Shared functions and utilities for integration tests

# Colors for output
export GREEN='\033[0;32m'
export RED='\033[0;31m'
export BLUE='\033[0;34m'
export YELLOW='\033[0;33m'
export NC='\033[0m'

# Load environment variables if .env exists
load_env() {
    if [ -f "../../.env" ]; then
        export $(grep -v '^#' ../../.env | xargs)
    fi
}

# Enhanced error reporting function
test_result() {
    local test_name="$1"
    local condition="$2"
    local error_details="$3"

    if [ "$condition" = "true" ]; then
        echo -e "${GREEN}✅ $test_name${NC}"
    else
        echo -e "${RED}❌ FAILED: $test_name${NC}"
        if [ -n "$error_details" ]; then
            echo -e "${YELLOW}   Details: $error_details${NC}"
        fi
        exit 1
    fi
}

# Get service information from introspection endpoint
get_service_info() {
    curl -s "http://localhost:2581" || {
        echo -e "${RED}❌ Failed to get service information${NC}"
        echo "Make sure the dev environment is running with 'just restart'"
        exit 1
    }
}

# Get service URLs from introspection server and export as environment variables
get_service_urls() {
    local service_info=$(get_service_info)
    export NOTES_SERVICE_URL=$(echo "$service_info" | jq -r '.notes.url // "http://localhost:2595"')
    export BSKY_SERVICE_URL=$(echo "$service_info" | jq -r '.bsky.url // "http://localhost:2584"')
    export PDS_SERVICE_URL=$(echo "$service_info" | jq -r '.pds.url // "http://localhost:2583"')
    export NOTES_SERVICE_INTERNAL_URL=$(echo "$service_info" | jq -r '.notes.internalUrl // "http://localhost:2597"')
    export DB_PATH=$(echo "$service_info" | jq -r '.notes.dbPath // "http://localhost:2597"')

    # Verify URLs were obtained
    test_result "Service URLs obtained from introspection" "$([ -n "$NOTES_SERVICE_URL" ] && [ -n "$BSKY_SERVICE_URL" ] && [ -n "$PDS_SERVICE_URL" ] && [ -n "$NOTES_SERVICE_INTERNAL_URL" ] && echo true || echo false)" "Notes: $NOTES_SERVICE_URL, Bsky: $BSKY_SERVICE_URL, PDS: $PDS_SERVICE_URL, Scoring: $NOTES_SERVICE_URL/$NOTES_SERVICE_INTERNAL_URL"
}

# Get service DIDs and export as environment variables
get_service_dids() {
    # Get DIDs from introspection service (must be called after get_service_urls)
    local service_info=$(get_service_info)

    # Extract all DIDs from introspection
    export LABELER_DID=$(echo "$service_info" | jq -r '.notes.labelerDid // "unknown"')
    export FEEDGEN_DOCUMENT_DID=$(echo "$service_info" | jq -r '.notes.feedgenDocumentDid // "unknown"')
    export REPO_DID=$(echo "$service_info" | jq -r '.notes.repoDid // "unknown"')


    # Verify DIDs were obtained
    test_result "Service DIDs obtained" "$([ "$LABELER_DID" != "unknown" ] && [ "$FEEDGEN_DOCUMENT_DID" != "unknown" ] && [ "$REPO_DID" != "unknown" ] && [ "$REPO_DID" != "unknown" ] && echo true || echo false)" "Labeler: $LABELER_DID, FeedGen Doc: $FEEDGEN_DOCUMENT_DID, FeedGen Repo: $REPO_DID, Notes Repo: $REPO_DID"
}

# Health check for a service
check_service_health() {
    local service_name="$1"
    local service_url="$2"

    local health_response=$(curl -s "$service_url/health" 2>/dev/null || echo "")
    local is_healthy=$(echo "$health_response" | jq -r '.healthy // false' 2>/dev/null || echo "false")

    test_result "$service_name service is running" "$is_healthy" "Health response: $health_response"
}

# Comprehensive health check for all services (must be called after get_service_urls)
check_all_services() {
    print_test_section "🏥 Service Health Check"

    # Notes service uses _ping endpoint
    local notes_ping=$(curl -s "$NOTES_SERVICE_URL/_ping" 2>/dev/null || echo "error")
    test_result "Notes service is running" "$([ "$notes_ping" = "pong" ] && echo true || echo false)"

    # Bsky service uses _health endpoint
    local bsky_health=$(curl -s "$BSKY_SERVICE_URL/_health" 2>/dev/null || echo "error")
    test_result "Bsky service is running" "$([ "$bsky_health" != "error" ] && echo true || echo false)"

    # Scoring service uses _health endpoint
    local scoring_health=$(curl -s "$NOTES_SERVICE_INTERNAL_URL/_health" 2>/dev/null || echo "error")
    test_result "Scoring service is running" "$([ "$scoring_health" != "error" ] && echo true || echo false)"
}

# Quick health check for specific services only
check_required_services() {
    local services=("$@")
    print_test_section "🏥 Required Services Health Check"

    for service in "${services[@]}"; do
        case "$service" in
            "notes")
                local notes_ping=$(curl -s "$NOTES_SERVICE_URL/_ping" 2>/dev/null || echo "error")
                test_result "Notes service is running" "$([ "$notes_ping" = "pong" ] && echo true || echo false)"
                ;;
            "bsky")
                local bsky_health=$(curl -s "$BSKY_SERVICE_URL/_health" 2>/dev/null || echo "error")
                test_result "Bsky service is running" "$([ "$bsky_health" != "error" ] && echo true || echo false)"
                ;;
            "scoring")
                local scoring_health=$(curl -s "$NOTES_SERVICE_INTERNAL_URL/_health" 2>/dev/null || echo "error")
                test_result "Scoring service is running" "$([ "$scoring_health" != "error" ] && echo true || echo false)"
                ;;
        esac
    done
}

# Standard test setup function - call this at the start of each test
setup_test_environment() {
    print_test_section "🔧 Test Environment Setup"
    load_env
    get_service_urls
    get_service_dids
}

# Create authentication token (updated to use dynamic PDS URL)
create_auth_token() {
    local identifier="${1:-alice.test}"
    local password="${2:-hunter2}"

    local auth_response=$(curl -s -w "\n%{http_code}" -X POST "$PDS_SERVICE_URL/xrpc/com.atproto.server.createSession" \
        -H "Content-Type: application/json" \
        -d "{\"identifier\": \"$identifier\", \"password\": \"$password\"}")

    # Split response and HTTP code
    local http_code=$(echo "$auth_response" | tail -n1)
    local json_response=$(echo "$auth_response" | head -n -1)

    # Check for HTTP errors
    check_http_response "$json_response" "create authentication token" "$http_code"

    local token=$(echo "$json_response" | jq -r '.accessJwt // empty')

    if [ -z "$token" ]; then
        echo -e "${RED}❌ Failed to create authentication token${NC}"
        echo "Auth response: $json_response"
        exit 1
    fi

    echo "$token"
}

# Standardized authentication setup
setup_authentication() {
    local user="${1:-alice.test}"
    print_test_section "🔐 Authentication Setup" >&2
    local token=$(create_auth_token "$user")
    test_result "JWT token obtained for $user" "$([ "$token" != "null" ] && [ -n "$token" ] && echo true || echo false)" >&2
    echo "$token"
}

# Get authentication token without extra output (for use in scripts)
get_auth_token() {
    local user="${1:-alice.test}"
    create_auth_token "$user"
}

debug() {
    local message="$1"
    echo -e "${YELLOW}[DEBUG] $message${NC}" >&2
}


# Create a test post (updated to use dynamic PDS URL)
create_test_post() {
    local token="$1"
    local text="${2:-This is a test post for Community Notes integration testing.}"
    local repo="${3:-alice.test}"
    local created_at=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)

    # Make the request and capture both body and HTTP code
    local response=$(curl -s -w "\n%{http_code}" -X POST "$PDS_SERVICE_URL/xrpc/com.atproto.repo.createRecord" \
        -H "Authorization: Bearer $token" \
        -H "Content-Type: application/json" \
        -d "{\"repo\": \"$repo\", \"collection\": \"app.bsky.feed.post\", \"record\": {\"\$type\": \"app.bsky.feed.post\", \"text\": \"$text\", \"createdAt\": \"$created_at\"}}")

    # Split response body and HTTP code
    local http_code=$(echo "$response" | tail -n1)
    local body=$(echo "$response" | head -n -1)

    # Check if request was successful
    if [ "$http_code" != "200" ]; then
        echo ""
        return 1
    fi

    # Extract URI from response
    local uri=$(echo "$body" | jq -r '.uri // empty')
    if [ -z "$uri" ] || [ "$uri" = "null" ]; then
        echo ""
        return 1
    fi

    echo "$uri"
}

# Create a community note (updated to use dynamic Notes URL and new API format)
create_community_note() {
    local token="$1"
    local subject_uri="$2"
    local text="${3:-This post needs additional context.}"
    local label_value="${4:-annotation}"
    local reasons="${5:-[\"disputed_claim\"]}"



    local note_response=$(curl -s -w "\n%{http_code}" -X POST "$NOTES_SERVICE_URL/xrpc/org.opencommunitynotes.propose" \
        -H "Authorization: Bearer $token" \
        -H "Content-Type: application/json" \
        -d "{\"typ\": \"label\", \"uri\": \"$subject_uri\", \"val\": \"$label_value\", \"note\": \"$text\", \"reasons\": $reasons}")


    # Split response and HTTP code
    local http_code=$(echo "$note_response" | tail -n1)
    local json_response=$(echo "$note_response" | head -n -1)

    # Check for HTTP errors
    check_http_response "$json_response" "create community note" "$http_code"

    local note_uri=$(echo "$json_response" | jq -r '.uri // empty')

    if [ -z "$note_uri" ]; then
        echo -e "${RED}❌ Failed to create community note${NC}"
        echo "Note response: $json_response"
        exit 1
    fi

    echo "$note_uri"
}

# Create a proposal with scoring (combines proposal creation and scoring)
create_scored_proposal() {
    local token="$1"
    local target_uri="$2"
    local label_value="${3:-annotation}"
    local score="${4:-0.0}"
    local status="${5:-needs_more_ratings}"
    local note_text="${6:-Test proposal with scoring}"

    # Create proposal
    local proposal_uri=$(create_community_note "$token" "$target_uri" "$note_text" "$label_value")

    # Set score using the error-checking function
    local score_success=$(set_proposal_score "$proposal_uri" "$status" "$score")

    if [ "$score_success" != "true" ]; then
        echo -e "${RED}❌ Failed to set score for created proposal${NC}"
        exit 1
    fi

    echo "$proposal_uri"
}

# Set proposal score (utility for updating scores)
set_proposal_score() {
    local proposal_uri="$1"
    local status="$2"
    local score="$3"

    local response=$(curl -s -w "\n%{http_code}" -X POST "$NOTES_SERVICE_INTERNAL_URL/score" \
        -H "Content-Type: application/json" \
        -d "{\"proposalUri\": \"$proposal_uri\", \"status\": \"$status\", \"score\": $score}")

    # Split response and HTTP code
    local http_code=$(echo "$response" | tail -n1)
    local json_response=$(echo "$response" | head -n -1)

    # Check for HTTP errors
    check_http_response "$json_response" "set proposal score" "$http_code"

    local success=$(echo "$json_response" | jq -r '.success // false')

    if [ "$success" != "true" ]; then
        echo -e "${RED}❌ Failed to set proposal score${NC}"
        echo "Response: $json_response"
        exit 1
    fi

    echo "$success"
}

# Rate a proposal (updated to use dynamic Notes URL and new API format)
rate_proposal() {
    local token="$1"
    local proposal_uri="$2"
    local rating_val="$3"  # 1 for helpful, -1 for not helpful
    local reasons="${4:-[\"helpful\"]}"

    local rating_response=$(curl -s -w "\n%{http_code}" -X POST "$NOTES_SERVICE_URL/xrpc/org.opencommunitynotes.vote" \
        -H "Authorization: Bearer $token" \
        -H "Content-Type: application/json" \
        -d "{\"uri\": \"$proposal_uri\", \"val\": $rating_val, \"reasons\": $reasons}")

    # Split response and HTTP code
    local http_code=$(echo "$rating_response" | tail -n1)
    local json_response=$(echo "$rating_response" | head -n -1)

    # Check for HTTP errors
    check_http_response "$json_response" "rate proposal" "$http_code"

    local success=$(echo "$json_response" | jq -r '.success // false' 2>/dev/null || echo "false")

    if [ "$success" != "true" ]; then
        echo -e "${RED}❌ Failed to rate proposal${NC}"
        echo "Rating response: $json_response"
        exit 1
    fi

    echo "true"
}

# Get proposals for a subject (updated to use dynamic Notes URL)
get_proposals_for_subject() {
    local token="$1"
    local subject_uri="$2"
    local status_filter="${3:-}"
    local label_filter="${4:-}"

    local encoded_uri=$(echo "$subject_uri" | sed 's/:/%3A/g' | sed 's/\//%2F/g')
    local url="$NOTES_SERVICE_URL/xrpc/org.opencommunitynotes.getProposals?uris=$encoded_uri"

    if [ -n "$status_filter" ]; then
        url="${url}&status=${status_filter}"
    fi

    if [ -n "$label_filter" ]; then
        url="${url}&label=${label_filter}"
    fi

    local proposals_response=$(curl -s -w "\n%{http_code}" "$url" -H "Authorization: Bearer $token")

    # Split response and HTTP code
    local http_code=$(echo "$proposals_response" | tail -n1)
    local json_response=$(echo "$proposals_response" | head -n -1)

    # Check for HTTP errors
    check_http_response "$json_response" "get proposals for subject" "$http_code"

    echo "$json_response"
}

# URL encoding utility
url_encode() {
    local string="$1"
    echo "$string" | sed 's/:/%3A/g' | sed 's/\//%2F/g'
}

# Check HTTP response for errors
check_http_response() {
    local response="$1"
    local operation_name="$2"
    local http_code="$3"

    # Check if curl failed (empty response or error)
    if [ -z "$response" ] || [ "$response" = "error" ]; then
        echo -e "${RED}❌ HTTP request failed for $operation_name${NC}"
        exit 1
    fi

    # Check HTTP status code if provided
    if [ -n "$http_code" ] && [ "$http_code" -ge 400 ]; then
        echo -e "${RED}❌ HTTP error $http_code for $operation_name${NC}"
        echo "Response: $response"
        exit 1
    fi

    # Check for common error patterns in JSON response
    local error_msg=$(echo "$response" | jq -r '.error // .message // empty' 2>/dev/null)
    if [ -n "$error_msg" ] && [ "$error_msg" != "null" ]; then
        echo -e "${RED}❌ API error for $operation_name: $error_msg${NC}"
        echo "Full response: $response"
        exit 1
    fi
}

# Complete test setup with health checks
setup_complete_test_environment() {
    local required_services=("$@")

    setup_test_environment

    if [ ${#required_services[@]} -eq 0 ]; then
        # Default to all services if none specified
        check_all_services
    else
        check_required_services "${required_services[@]}"
    fi
}



# Print test section header
print_test_section() {
    local section_name="$1"
    echo -e "${BLUE}$section_name${NC}"
}

# Print test info
print_test_info() {
    local info="$1"
    echo "   $info"
}
