#!/bin/bash

# Community Notes Vote Deletion Integration Test
# Tests that users can delete both auto-ratings and manual ratings
set -e

# Load shared test utilities
source "$(dirname "$0")/test-utils.sh"

echo "🗳️  Community Notes Vote Deletion Integration Test"
echo "================================================="

# Setup test environment with required services
setup_complete_test_environment "notes"

# Authentication setup
TOKEN=$(setup_authentication)

# Create test data
print_test_section "📝 Setting up test data"
TEST_POST_URI=$(create_test_post "$TOKEN" "Test post for vote deletion testing")
PROPOSAL_URI=$(create_community_note "$TOKEN" "$TEST_POST_URI" "This post needs additional context for vote deletion testing" "annotation")

# Test auto-rating deletion
print_test_section "🗑️  Testing auto-rating deletion"

# Verify auto-rating exists
PROPOSALS_RESPONSE=$(get_proposals_for_subject "$TOKEN" "$TEST_POST_URI")
VIEWER_RATING=$(echo "$PROPOSALS_RESPONSE" | jq -r '.proposals[0].viewer.rating.val // "null"')
test_result "Auto-rating exists" "$([ "$VIEWER_RATING" = "1" ] && echo true || echo false)"

# Delete auto-rating
DELETE_RESPONSE=$(curl -s -X POST "$NOTES_SERVICE_URL/xrpc/org.opencommunitynotes.rateProposal" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "uri": "'$PROPOSAL_URI'",
    "delete": true
  }')

DELETE_SUCCESS=$(echo "$DELETE_RESPONSE" | jq -r '.success // false')
DELETE_DELETED=$(echo "$DELETE_RESPONSE" | jq -r '.deleted // false')
test_result "Auto-rating deletion succeeded" "$([ "$DELETE_SUCCESS" = "true" ] && [ "$DELETE_DELETED" = "true" ] && echo true || echo false)"

# Verify auto-rating is gone
PROPOSALS_RESPONSE_AFTER=$(get_proposals_for_subject "$TOKEN" "$TEST_POST_URI")
VIEWER_RATING_AFTER=$(echo "$PROPOSALS_RESPONSE_AFTER" | jq -r '.proposals[0].viewer.rating.val // "null"')
test_result "Auto-rating deleted" "$([ "$VIEWER_RATING_AFTER" = "null" ] && echo true || echo false)"

# Test manual rating deletion
print_test_section "⭐ Testing manual rating deletion"

# Create manual rating
MANUAL_RATING_URI=$(rate_proposal "$TOKEN" "$PROPOSAL_URI" "-1" "[\"is_incorrect\", \"sources_missing_or_unreliable\"]")
test_result "Manual rating created" "$([ -n "$MANUAL_RATING_URI" ] && echo true || echo false)"

# Verify manual rating exists
PROPOSALS_RESPONSE_MANUAL=$(get_proposals_for_subject "$TOKEN" "$TEST_POST_URI")
VIEWER_RATING_MANUAL=$(echo "$PROPOSALS_RESPONSE_MANUAL" | jq -r '.proposals[0].viewer.rating.val // "null"')
test_result "Manual rating exists" "$([ "$VIEWER_RATING_MANUAL" = "-1" ] && echo true || echo false)"

# Delete manual rating
DELETE_MANUAL_RESPONSE=$(curl -s -X POST "$NOTES_SERVICE_URL/xrpc/org.opencommunitynotes.rateProposal" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "uri": "'$PROPOSAL_URI'",
    "delete": true
  }')

DELETE_MANUAL_SUCCESS=$(echo "$DELETE_MANUAL_RESPONSE" | jq -r '.success // false')
DELETE_MANUAL_DELETED=$(echo "$DELETE_MANUAL_RESPONSE" | jq -r '.deleted // false')
test_result "Manual rating deletion succeeded" "$([ "$DELETE_MANUAL_SUCCESS" = "true" ] && [ "$DELETE_MANUAL_DELETED" = "true" ] && echo true || echo false)"

# Verify manual rating is gone
PROPOSALS_RESPONSE_FINAL=$(get_proposals_for_subject "$TOKEN" "$TEST_POST_URI")
VIEWER_RATING_FINAL=$(echo "$PROPOSALS_RESPONSE_FINAL" | jq -r '.proposals[0].viewer.rating.val // "null"')
test_result "Manual rating deleted" "$([ "$VIEWER_RATING_FINAL" = "null" ] && echo true || echo false)"

# Test error handling
print_test_section "🚫 Testing error handling"

# Try to delete non-existent rating
DELETE_NONEXISTENT_RESPONSE=$(curl -s -X POST "$NOTES_SERVICE_URL/xrpc/org.opencommunitynotes.rateProposal" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "uri": "'$PROPOSAL_URI'",
    "delete": true
  }')

DELETE_NONEXISTENT_ERROR=$(echo "$DELETE_NONEXISTENT_RESPONSE" | jq -r '.error // "null"')
test_result "Non-existent rating deletion returns error" "$([ "$DELETE_NONEXISTENT_ERROR" = "ProposalNotFound" ] && echo true || echo false)"

echo -e "${GREEN}🎉 Vote deletion integration test completed!${NC}"
echo ""
