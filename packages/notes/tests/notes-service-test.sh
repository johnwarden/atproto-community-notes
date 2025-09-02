#!/bin/bash

# Community Notes Service Test Suite
set -e

# Load shared test utilities
source "$(dirname "$0")/test-utils.sh"

echo "🧪 Community Notes Service Test Suite"
echo "======================================"

# Setup test environment with required services
setup_complete_test_environment "notes"

# Authentication setup
TOKEN=$(setup_authentication)

# Get post URI that has Community Notes proposals (from mock data)
print_test_section "📋 Getting test post URI"
# Use a known URI that has proposals from mock data setup
REAL_POST_URI="at://did:plc:3joq3g62a5vblrkexqwxowzw/app.bsky.feed.post/3lwwdfbjj5t2j"

test_result "Test post URI set" "$([ -n "$REAL_POST_URI" ] && echo true || echo false)" "$REAL_POST_URI"

ENCODED_URI=$(echo "$REAL_POST_URI" | sed 's/:/%3A/g; s|/|%2F|g')

# Test 1: Authentication required
print_test_section "🔐 Test 1: Authentication Required"
UNAUTH_RESPONSE=$(curl -s "$NOTES_SERVICE_URL/xrpc/org.opencommunitynotes.getProposals?uris=$ENCODED_URI")
UNAUTH_ERROR=$(echo "$UNAUTH_RESPONSE" | jq -r '.error')

test_result "Unauthenticated requests rejected" "$([ "$UNAUTH_ERROR" = "AuthenticationRequired" ] && echo true || echo false)" "Response: $UNAUTH_RESPONSE"

# Test 2: Note creation (create real proposals first)
print_test_section "📝 Test 2: Note Creation"

TEST_POST_URI=$(create_test_post "$TOKEN" "Test post for note creation $(date +%s)")

if [ -n "$TEST_POST_URI" ] && [ "$TEST_POST_URI" != "null" ]; then
    REAL_PROPOSAL_URI=$(create_community_note "$TOKEN" "$TEST_POST_URI" "Test note creation" "needs-context" "[\"factual_error\"]")

    if [ -n "$REAL_PROPOSAL_URI" ] && [ "$REAL_PROPOSAL_URI" != "null" ]; then
        test_result "Note created successfully" "true"

        # Test 2.5: Verify Auto-Rating Creation
        print_test_section "🤖 Test 2.5: Auto-Rating Verification"

        # Retrieve the proposal to check if auto-rating was created
        AUTO_RATING_RESPONSE=$(get_proposals_for_subject "$TOKEN" "$TEST_POST_URI")

        HAS_AUTO_RATING=$(echo "$AUTO_RATING_RESPONSE" | jq '.proposals[0].viewer.rating | type')
        AUTO_RATING_VAL=$(echo "$AUTO_RATING_RESPONSE" | jq '.proposals[0].viewer.rating.val // null')
        AUTO_RATING_REASONS=$(echo "$AUTO_RATING_RESPONSE" | jq '.proposals[0].viewer.rating.reasons | length // 0')

        test_result "Auto-rating created" "$([ "$HAS_AUTO_RATING" = "\"object\"" ] && echo true || echo false)" "Rating type: $HAS_AUTO_RATING"
        test_result "Auto-rating is helpful (val=1)" "$([ "$AUTO_RATING_VAL" = "1" ] && echo true || echo false)" "Rating value: $AUTO_RATING_VAL"
        test_result "Auto-rating has 5 standard reasons" "$([ "$AUTO_RATING_REASONS" -eq "5" ] && echo true || echo false)" "Reasons count: $AUTO_RATING_REASONS"

        if [ "$HAS_AUTO_RATING" = "\"object\"" ]; then
            AUTO_RATING_REASONS_LIST=$(echo "$AUTO_RATING_RESPONSE" | jq -r '.proposals[0].viewer.rating.reasons | join(", ")')
        fi

        # Test duplicate prevention
        DUPLICATE_RESPONSE=$(curl -s -X POST "$NOTES_SERVICE_URL/xrpc/org.opencommunitynotes.createProposal" \
          -H "Content-Type: application/json" \
          -H "Authorization: Bearer $TOKEN" \
          -d "{\"typ\": \"label\", \"uri\": \"$TEST_POST_URI\", \"val\": \"needs-context\", \"note\": \"Duplicate note attempt\", \"reasons\": [\"disputed_claim\"]}")
        DUPLICATE_ERROR=$(echo "$DUPLICATE_RESPONSE" | jq -r '.error')
        test_result "Duplicate prevention working" "$([ "$DUPLICATE_ERROR" = "DuplicateProposal" ] && echo true || echo false)" "Response: $DUPLICATE_RESPONSE"

        # Test 2.6: Multiple proposals with different labels (new functionality)
        print_test_section "🏷️ Test 2.6: Multiple Labels Per User Per Post"

        # Create a second proposal with a different label - this should succeed
        DIFFERENT_LABEL_RESPONSE=$(curl -s -X POST "$NOTES_SERVICE_URL/xrpc/org.opencommunitynotes.createProposal" \
          -H "Content-Type: application/json" \
          -H "Authorization: Bearer $TOKEN" \
          -d "{\"typ\": \"label\", \"uri\": \"$TEST_POST_URI\", \"val\": \"misleading\", \"note\": \"This post is misleading - different label\", \"reasons\": [\"disputed_claim\"]}")

                DIFFERENT_LABEL_URI=$(echo "$DIFFERENT_LABEL_RESPONSE" | jq -r '.uri // null')
        DIFFERENT_LABEL_ERROR=$(echo "$DIFFERENT_LABEL_RESPONSE" | jq -r '.error // null')

        test_result "Different label proposal created successfully" "$([ -n "$DIFFERENT_LABEL_URI" ] && [ "$DIFFERENT_LABEL_URI" != "null" ] && [ "$DIFFERENT_LABEL_ERROR" = "null" ] && echo true || echo false)" "URI: $DIFFERENT_LABEL_URI"

        # Verify both proposals exist for the same post
        MULTIPLE_PROPOSALS_RESPONSE=$(get_proposals_for_subject "$TOKEN" "$TEST_POST_URI")
        MULTIPLE_PROPOSALS_COUNT=$(echo "$MULTIPLE_PROPOSALS_RESPONSE" | jq '.proposals | length')

        test_result "Post now has 2 proposals with different labels" "$([ "$MULTIPLE_PROPOSALS_COUNT" -eq "2" ] && echo true || echo false)" "Count: $MULTIPLE_PROPOSALS_COUNT"

        # Verify the labels are different
        FIRST_LABEL=$(echo "$MULTIPLE_PROPOSALS_RESPONSE" | jq -r '.proposals[0].val')
        SECOND_LABEL=$(echo "$MULTIPLE_PROPOSALS_RESPONSE" | jq -r '.proposals[1].val')

        test_result "Proposals have different labels" "$([ "$FIRST_LABEL" != "$SECOND_LABEL" ] && echo true || echo false)" "Labels: $FIRST_LABEL, $SECOND_LABEL"

        # Test that duplicate with second label is also prevented
        DUPLICATE_MISLEADING_RESPONSE=$(curl -s -X POST "$NOTES_SERVICE_URL/xrpc/org.opencommunitynotes.createProposal" \
          -H "Content-Type: application/json" \
          -H "Authorization: Bearer $TOKEN" \
          -d "{\"typ\": \"label\", \"uri\": \"$TEST_POST_URI\", \"val\": \"misleading\", \"note\": \"Another misleading attempt\", \"reasons\": [\"disputed_claim\"]}")

        DUPLICATE_MISLEADING_ERROR=$(echo "$DUPLICATE_MISLEADING_RESPONSE" | jq -r '.error')
        test_result "Duplicate 'misleading' label also prevented" "$([ "$DUPLICATE_MISLEADING_ERROR" = "DuplicateProposal" ] && echo true || echo false)" "Response: $DUPLICATE_MISLEADING_RESPONSE"

    else
        test_result "Note creation failed" "false" "Response: $CREATE_RESPONSE"
        exit 1
    fi
else
    test_result "Test post creation failed" "false" "Response: $TEST_POST_RESPONSE"
    exit 1
fi

# Test 3: Note rating system (using real proposal)
print_test_section "⭐ Test 3: Note Rating System"

# Create rating on real proposal
RATING_URI=$(rate_proposal "$TOKEN" "$REAL_PROPOSAL_URI" "1" "[\"helpful\"]")
test_result "Rating created" "$([ -n "$RATING_URI" ] && echo true || echo false)"

# Verify rating structure by retrieving proposals for the test post
VIEWER_RESPONSE=$(get_proposals_for_subject "$TOKEN" "$TEST_POST_URI")

HAS_VIEWER_RATING=$(echo "$VIEWER_RESPONSE" | jq '.proposals[0].viewer.rating | type')
RATING_VAL=$(echo "$VIEWER_RESPONSE" | jq '.proposals[0].viewer.rating.val')
HAS_TIMESTAMPS=$(echo "$VIEWER_RESPONSE" | jq '.proposals[0].viewer.rating | has("createdAt") and has("updatedAt")')

test_result "Rating structure valid" "$([ "$HAS_VIEWER_RATING" = "\"object\"" ] && [ "$RATING_VAL" = "1" ] && [ "$HAS_TIMESTAMPS" = "true" ] && echo true || echo false)" "Response: $VIEWER_RESPONSE"

# Test rating deletion
DELETE_RESPONSE=$(curl -s -X POST "$NOTES_SERVICE_URL/xrpc/org.opencommunitynotes.rateProposal" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d "{\"uri\": \"$REAL_PROPOSAL_URI\", \"delete\": true}")

DELETE_SUCCESS=$(echo "$DELETE_RESPONSE" | jq '.success')
test_result "Rating deleted" "$([ "$DELETE_SUCCESS" = "true" ] && echo true || echo false)" "Response: $DELETE_RESPONSE"

# Test 4: Data retrieval (using real database data)
print_test_section "📋 Test 4: Data Retrieval"
NOTES_RESPONSE=$(get_proposals_for_subject "$TOKEN" "$REAL_POST_URI")
NOTES_COUNT=$(echo "$NOTES_RESPONSE" | jq '.proposals | length')
GET_NOTES_ERROR=$(echo "$NOTES_RESPONSE" | jq -r '.error')

test_result "Proposals retrieved successfully" "$([ "$GET_NOTES_ERROR" = "null" ] && echo true || echo false)" "Response: $NOTES_RESPONSE"

# Test 5: Input validation
print_test_section "📋 Test 5: Input Validation"
INVALID_RESPONSE=$(curl -s -X POST "$NOTES_SERVICE_URL/xrpc/org.opencommunitynotes.createProposal" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "typ": "invalid_type",
    "uri": "at://fake.uri/invalid",
    "val": "needs-context",
    "note": ""
  }')

INVALID_ERROR=$(echo "$INVALID_RESPONSE" | jq -r '.error')
test_result "Input validation working" "$([ "$INVALID_ERROR" = "InvalidTarget" ] && echo true || echo false)" "Response: $INVALID_RESPONSE"

# Test 6: Non-AT Protocol URI support
print_test_section "🌐 Test 6: HTTP URI Support"
HTTP_NOTE_URI=$(create_community_note "$TOKEN" "https://example.com/test-$(date +%s)" "Test HTTP URI support" "needs-context" "[\"factual_error\"]")
test_result "HTTP URI supported" "$([ -n "$HTTP_NOTE_URI" ] && [ "$HTTP_NOTE_URI" != "null" ] && echo true || echo false)"


HTTP_RATING_URI=$(rate_proposal "$TOKEN" "$HTTP_NOTE_URI" "1" "[\"helpful\"]")
test_result "Rating created" "$([ -n "$HTTP_RATING_URI" ] && echo true || echo false)"

# Test 7: Status filtering
print_test_section "🔍 Test 7: Status Filtering"

# Create a fresh test post for status filtering (since the previous one was rated)
STATUS_TEST_POST_URI=$(create_test_post "$TOKEN" "Status filtering test post $(date +%s)")

if [ -n "$STATUS_TEST_POST_URI" ] && [ "$STATUS_TEST_POST_URI" != "null" ]; then
    # Create a proposal for status testing (without rating it)
    STATUS_CREATE_URI=$(create_community_note "$TOKEN" "$STATUS_TEST_POST_URI" "Status filtering test note" "needs-context" "[\"factual_error\"]")

    if [ -n "$STATUS_CREATE_URI" ] && [ "$STATUS_CREATE_URI" != "null" ]; then
        # Wait for proposal initialization
        sleep 2

        # Test filtering by needs_more_ratings (default status for new proposals)
        NEEDS_MORE_RESPONSE=$(get_proposals_for_subject "$TOKEN" "$STATUS_TEST_POST_URI" "needs_more_ratings")
        NEEDS_MORE_COUNT=$(echo "$NEEDS_MORE_RESPONSE" | jq '.proposals | length')
        NEEDS_MORE_STATUS=$(echo "$NEEDS_MORE_RESPONSE" | jq -r '.proposals[0].status // empty')

        test_result "Status filter: needs_more_ratings" "$([ "$NEEDS_MORE_COUNT" -gt 0 ] && [ "$NEEDS_MORE_STATUS" = "needs_more_ratings" ] && echo true || echo false)"

        # Test filtering by rated_helpful (should return 0 results for unrated proposal)
        RATED_HELPFUL_RESPONSE=$(get_proposals_for_subject "$TOKEN" "$STATUS_TEST_POST_URI" "rated_helpful")
        RATED_HELPFUL_COUNT=$(echo "$RATED_HELPFUL_RESPONSE" | jq '.proposals | length')

        test_result "Status filter: rated_helpful (empty)" "$([ "$RATED_HELPFUL_COUNT" = "0" ] && echo true || echo false)"

        # Test filtering by rated_not_helpful (should return 0 results for unrated proposal)
        RATED_NOT_HELPFUL_RESPONSE=$(get_proposals_for_subject "$TOKEN" "$STATUS_TEST_POST_URI" "rated_not_helpful")
        RATED_NOT_HELPFUL_COUNT=$(echo "$RATED_NOT_HELPFUL_RESPONSE" | jq '.proposals | length')

        test_result "Status filter: rated_not_helpful (empty)" "$([ "$RATED_NOT_HELPFUL_COUNT" = "0" ] && echo true || echo false)"

        # Test with no status filter (should return all proposals)
        NO_FILTER_RESPONSE=$(get_proposals_for_subject "$TOKEN" "$STATUS_TEST_POST_URI")
        NO_FILTER_COUNT=$(echo "$NO_FILTER_RESPONSE" | jq '.proposals | length')

        test_result "No status filter (all proposals)" "$([ "$NO_FILTER_COUNT" -gt 0 ] && echo true || echo false)"
    else
        test_result "Status filtering proposal creation failed" "false" "Response: $STATUS_CREATE_RESPONSE"
        exit 1
    fi
else
    test_result "Status filtering test post creation failed" "false" "Response: $STATUS_TEST_POST_RESPONSE"
    exit 1
fi



echo ""
echo -e "${GREEN}🎉 All tests passed!${NC}"
