#!/bin/bash

# Community Notes getConfig Integration Test
set -e

# Load shared test utilities
source "$(dirname "$0")/test-utils.sh"

echo "🔧 Community Notes getConfig Integration Test"
echo "============================================="

# Setup test environment (loads env, gets service URLs/DIDs, checks health)
setup_complete_test_environment "notes"

# Test getConfig endpoint
print_test_section "🔧 getConfig Endpoint Test"

# Call the getConfig endpoint
CONFIG_RESPONSE=$(curl -s "$NOTES_SERVICE_URL/xrpc/org.opencommunitynotes.getConfig" 2>/dev/null || echo "error")
test_result "getConfig endpoint responds" "$([ "$CONFIG_RESPONSE" != "error" ] && echo true || echo false)"

echo $CONFIG_RESPONSE | jq

if [ "$CONFIG_RESPONSE" != "error" ]; then
    # Parse response
    VERSION=$(echo "$CONFIG_RESPONSE" | jq -r '.version // "null"')
    LABELER_DID=$(echo "$CONFIG_RESPONSE" | jq -r '.labelerDid // "null"')
    REPO_DID=$(echo "$CONFIG_RESPONSE" | jq -r '.feedGeneratorDid // "null"')

    # Test response structure
    test_result "Response has version field" "$([ "$VERSION" != "null" ] && [ -n "$VERSION" ] && echo true || echo false)"
    test_result "Response has labelerDid field" "$([ "$LABELER_DID" != "null" ] && [ -n "$LABELER_DID" ] && echo true || echo false)"
    test_result "Response has feedGeneratorDid field" "$([ "$REPO_DID" != "null" ] && [ -n "$REPO_DID" ] && echo true || echo false)"

    # Test DID format
    test_result "labelerDid is valid DID format" "$(echo "$LABELER_DID" | grep -q '^did:' && echo true || echo false)"
    test_result "feedGeneratorDid is valid DID format" "$(echo "$REPO_DID" | grep -q '^did:' && echo true || echo false)"

    # Test version is ISO 8601 timestamp
    test_result "version is ISO 8601 timestamp" "$(echo "$VERSION" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}' && echo true || echo false)"

    # Display configuration values
    echo ""


    # Test that endpoint doesn't require authentication
    print_test_section "🔓 Authentication Test"
    UNAUTH_RESPONSE=$(curl -s "$NOTES_SERVICE_URL/xrpc/org.opencommunitynotes.getConfig" 2>/dev/null || echo "error")
    UNAUTH_VERSION=$(echo "$UNAUTH_RESPONSE" | jq -r '.version // "null"')
    UNAUTH_LABELER_DID=$(echo "$UNAUTH_RESPONSE" | jq -r '.labelerDid // "null"')
    UNAUTH_REPO_DID=$(echo "$UNAUTH_RESPONSE" | jq -r '.feedGeneratorDid // "null"')
    test_result "Endpoint works without authentication" "$([ "$UNAUTH_VERSION" != "null" ] && [ -n "$UNAUTH_VERSION" ] && echo true || echo false)"

    # Test DID consistency (version will change but DIDs should be consistent)
    test_result "DIDs are consistent between calls" "$([ "$LABELER_DID" = "$UNAUTH_LABELER_DID" ] && [ "$REPO_DID" = "$UNAUTH_REPO_DID" ] && echo true || echo false)"
else
    echo "⚠️  Could not test response structure due to endpoint error"
fi

echo -e "${GREEN}🎉 getConfig endpoint integration test completed!${NC}"
echo ""
