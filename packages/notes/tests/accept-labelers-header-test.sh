#!/bin/bash

# Community Notes Accept-Labelers Header Integration Test
set -e

# Load shared test utilities
source "$(dirname "$0")/test-utils.sh"

echo "🏷️  Community Notes Accept-Labelers Header Integration Test"
echo "==========================================================="

# Setup test environment with required services
setup_complete_test_environment "notes" "bsky" "scoring"

# Authentication setup
TOKEN=$(setup_authentication)

# Create test data for labeler header testing
print_test_section "📋 Creating Test Data"

# Create test post and scored proposal
TEST_POST_URI=$(create_test_post "$TOKEN" "Test post for accept-labelers header testing")

echo "A: $TOKEN $TEST_POST_URI"
PROPOSAL_URI=$(create_scored_proposal "$TOKEN" "$TEST_POST_URI" "needs-context" "0.85" "rated_helpful" "Test note for accept-labelers header testing")

echo "B"

test_result "Test post and scored proposal created" "$([ -n "$TEST_POST_URI" ] && [ -n "$PROPOSAL_URI" ] && echo true || echo false)" "Post: $TEST_POST_URI, Proposal: $PROPOSAL_URI"


# Test 1: Default labelers (without header)
print_test_section "🏷️  Test 1: Default Labelers (No Header)"

# Wait for labels to be available (retry mechanism for timing issues)
COMMUNITY_NOTES_LABELS='[]'
for i in {1..5}; do
    DEFAULT_RESPONSE=$(curl -s "$BSKY_SERVICE_URL/xrpc/app.bsky.feed.getPosts?uris=$TEST_POST_URI" 2>/dev/null || echo '{"posts":[]}')

    DEFAULT_ERROR=$(echo "$DEFAULT_RESPONSE" | jq -r '.error // null')
    if [ "$DEFAULT_ERROR" != "null" ]; then
        test_result "Default request failed" "false" "Error: $DEFAULT_ERROR"
        break
    fi

    DEFAULT_LABELS=$(echo "$DEFAULT_RESPONSE" | jq '.posts[0].labels // []' 2>/dev/null || echo '[]')
    COMMUNITY_NOTES_LABELS=$(echo "$DEFAULT_LABELS" | jq --arg did "$LABELER_DID" '[.[] | select(.src == $did)]' 2>/dev/null || echo '[]')
    COMMUNITY_NOTES_LABELS_COUNT=$(echo "$COMMUNITY_NOTES_LABELS" | jq 'length' 2>/dev/null || echo 0)

    if [ "$COMMUNITY_NOTES_LABELS_COUNT" -gt 0 ]; then
        break
    fi

    if [ $i -lt 5 ]; then
        sleep 0.1
    fi
done

DEFAULT_LABELS_COUNT=$(echo "$DEFAULT_LABELS" | jq 'length' 2>/dev/null || echo 0)
COMMUNITY_NOTES_LABELS_COUNT=$(echo "$COMMUNITY_NOTES_LABELS" | jq 'length' 2>/dev/null || echo 0)

if [ "$COMMUNITY_NOTES_LABELS_COUNT" -gt 0 ]; then
    test_result "Community Notes labels not included by default" "false"
else
    test_result "Community Notes labels not included by default" "true"
fi

# Test 2: With Community Notes header
print_test_section "🏷️  Test 2: With atproto-accept-labelers header"

echo "Labler did: $LABELER_DID, $BSKY_SERVICE_URL, $TEST_POST_URI" > /dev/stderr
HEADER_RESPONSE=$(curl -s "$BSKY_SERVICE_URL/xrpc/app.bsky.feed.getPosts?uris=$TEST_POST_URI" \
  -H "atproto-accept-labelers: $LABELER_DID" || echo '{"posts":[]}')

debug "Header response"
debug $HEADER_RESPONSE

HEADER_ERROR=$(echo "$HEADER_RESPONSE" | jq -r '.error // null')
if [ "$HEADER_ERROR" != "null" ]; then
    test_result "Header request failed" "false" "Error: $HEADER_ERROR"
fi

HEADER_LABELS=$(echo "$HEADER_RESPONSE" | jq '.posts[0].labels // []' 2>/dev/null || echo '[]')

debug "Header labels: $HEADER_LABELS"
HEADER_LABELS_COUNT=$(echo "$HEADER_LABELS" | jq 'length' 2>/dev/null || echo 0)

# Check if any labels are from Community Notes Labeler DID
HEADER_COMMUNITY_NOTES_LABELS=$(echo "$HEADER_LABELS" | jq --arg did "$LABELER_DID" '[.[] | select(.src == $did)]' 2>/dev/null || echo '[]')
HEADER_COMMUNITY_NOTES_LABELS_COUNT=$(echo "$HEADER_COMMUNITY_NOTES_LABELS" | jq 'length' 2>/dev/null || echo 0)

if [ "$HEADER_COMMUNITY_NOTES_LABELS_COUNT" -gt 0 ]; then
    test_result "Community Notes labels included with header" "true"
else
    test_result "Community Notes labels included with header" "false" "No labels found with header"
fi

# Test 3: Verify label content and structure
print_test_section "🏷️  Test 3: Verify Label Content and Structure"

echo "Test 3: $BSKY_SERVICE_URL, $TEST_POST_URI"
LABELS_RESPONSE=$(curl -s "$BSKY_SERVICE_URL/xrpc/app.bsky.feed.getPosts?uris=$TEST_POST_URI"  -H "atproto-accept-labelers: $LABELER_DID" 2>/dev/null || echo '{"posts":[]}')

LABELS=$(echo "$LABELS_RESPONSE" | jq '.posts[0].labels // []' 2>/dev/null || echo '[]')
COMMUNITY_LABELS=$(echo "$LABELS" | jq --arg did "$LABELER_DID" '[.[] | select(.src == $did)]' 2>/dev/null || echo '[]')
LABEL_VALUES=$(echo "$COMMUNITY_LABELS" | jq -r '.[].val' 2>/dev/null | sort | tr '\n' ' ' || echo "")

if [ -n "$LABEL_VALUES" ] && [ "$LABEL_VALUES" != " " ]; then
    # Check for expected label values
    HAS_NOTE=$(echo "$COMMUNITY_LABELS" | jq 'any(.val == "needs-context")' 2>/dev/null || echo false)
    HAS_PROPOSED_NOTE=$(echo "$COMMUNITY_LABELS" | jq 'any(.val == "proposed-label:needs-context")' 2>/dev/null || echo false)

    if [ "$HAS_NOTE" = "true" ] || [ "$HAS_PROPOSED_NOTE" = "true" ]; then
        test_result "Post has expected Community Notes labels" "true"
    else
        test_result "Post has unexpected label values" "false"
    fi
else
    test_result "Community Notes labels found" "false" "No labels detected"
fi

# Test 4: Test header parsing functionality
print_test_section "🏷️  Test 4: Header Parsing Functionality"

# Test with example labeler only (should exclude Community Notes)
EXCLUDE_RESPONSE=$(curl -s "$BSKY_SERVICE_URL/xrpc/app.bsky.feed.getPosts?uris=$TEST_POST_URI" \
  -H "atproto-accept-labelers: did:example:labeler" 2>/dev/null || echo '{"posts":[]}')

EXCLUDE_POSTS_COUNT=$(echo "$EXCLUDE_RESPONSE" | jq '.posts | length' 2>/dev/null || echo 0)

# Test with Community Notes Labeler DID only
INCLUDE_RESPONSE=$(curl -s "$BSKY_SERVICE_URL/xrpc/app.bsky.feed.getPosts?uris=$TEST_POST_URI" \
  -H "atproto-accept-labelers: $LABELER_DID" 2>/dev/null || echo '{"posts":[]}')

INCLUDE_POSTS_COUNT=$(echo "$INCLUDE_RESPONSE" | jq '.posts | length' 2>/dev/null || echo 0)

test_result "Header parsing works (posts returned in both cases)" "$([ "$EXCLUDE_POSTS_COUNT" -gt 0 ] && [ "$INCLUDE_POSTS_COUNT" -gt 0 ] && echo true || echo false)"

# Test 5: Label Deletion on Status Change
print_test_section "🗑️ Test 5: Label Deletion on Status Change"

# Change the existing proposal status to rated_not_helpful (should remove positive label)
SCORE_SUCCESS=$(set_proposal_score "$PROPOSAL_URI" "rated_not_helpful" "-0.3")

if [ "$SCORE_SUCCESS" != "true" ]; then
    test_result "Set proposal score to rated_not_helpful" "false" "Failed to set score"
    exit 1
fi

test_result "Proposal status changed to rated_not_helpful" "true"

# Verify the proposal status was updated
UPDATED_PROPOSALS_RESPONSE=$(get_proposals_for_subject "$TOKEN" "$TEST_POST_URI")
UPDATED_PROPOSAL_STATUS=$(echo "$UPDATED_PROPOSALS_RESPONSE" | jq -r '.proposals[0].status')

test_result "Proposal status verified as rated_not_helpful" "$([ "$UPDATED_PROPOSAL_STATUS" = "rated_not_helpful" ] && echo true || echo false)" "Status: $UPDATED_PROPOSAL_STATUS"

# Test label deletion verification with retry logic
MAX_ATTEMPTS=3
ATTEMPT=1
LABEL_DELETION_VERIFIED=false

while [ $ATTEMPT -le $MAX_ATTEMPTS ]; do
    # Check labels via getPosts
    LABELS_CHECK_RESPONSE=$(curl -s "$BSKY_SERVICE_URL/xrpc/app.bsky.feed.getPosts?uris=$TEST_POST_URI" \
      -H "atproto-accept-labelers: $LABELER_DID" 2>/dev/null || echo '{"posts":[]}')

    CURRENT_LABELS=$(echo "$LABELS_CHECK_RESPONSE" | jq '.posts[0].labels // []' 2>/dev/null || echo '[]')
    CURRENT_COMMUNITY_LABELS=$(echo "$CURRENT_LABELS" | jq --arg did "$LABELER_DID" '[.[] | select(.src == $did)]' 2>/dev/null || echo '[]')

    # Check if positive label (needs-context) is gone and negative label might be present
    HAS_POSITIVE_LABEL=$(echo "$CURRENT_COMMUNITY_LABELS" | jq 'any(.val == "needs-context")' 2>/dev/null || echo false)
    HAS_NEGATIVE_LABEL=$(echo "$CURRENT_COMMUNITY_LABELS" | jq 'any(.val | startswith("not-"))' 2>/dev/null || echo false)

    if [ "$HAS_POSITIVE_LABEL" = "false" ]; then
        LABEL_DELETION_VERIFIED=true
        echo "  ✅ Label deletion verified on attempt $ATTEMPT: positive label removed"
        break
    fi

    if [ $ATTEMPT -lt $MAX_ATTEMPTS ]; then
        echo "  ⏳ Attempt $ATTEMPT/$MAX_ATTEMPTS: Label deletion not yet reflected, retrying..."
        sleep 1
    fi

    ATTEMPT=$((ATTEMPT + 1))
done

test_result "Label deletion verified within $MAX_ATTEMPTS attempts" "$([ "$LABEL_DELETION_VERIFIED" = "true" ] && echo true || echo false)" "Took $((ATTEMPT-1)) attempts"

echo ""
echo -e "${GREEN}🎉 Community Notes Labels Integration Tests Passed!${NC}"
