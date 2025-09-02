#!/bin/bash

# Community Notes Labeler End-to-End Integration Test
# Tests the complete labeling flow by mocking algorithm status events
set -e

# Load shared test utilities
source "$(dirname "$0")/test-utils.sh"

echo "🏷️  Community Notes Labeler End-to-End Integration Test"
echo "====================================================="

# Setup test environment with required services
setup_complete_test_environment "notes" "bsky" "scoring"

# Get database path from introspection server
INTROSPECT_RESPONSE=$(get_service_info)

# Authentication setup
TOKEN=$(setup_authentication)

# Test 1: Create test post and community note
print_test_section "📝 Test 1: Create Test Post and Community Note"

# Create test post using utility
TEST_POST_URI=$(create_test_post "$TOKEN" "This is a test post for end-to-end labeler testing")
test_result "Test post created" "$([ -n "$TEST_POST_URI" ] && echo true || echo false)"

# Create community note using utility
PROPOSAL_URI=$(create_community_note "$TOKEN" "$TEST_POST_URI" "This post needs additional context for end-to-end testing" "needs-context" "[\"disputed_claim\"]")
test_result "Community note created" "$([ -n "$PROPOSAL_URI" ] && echo true || echo false)"

# Test 2: Mock algorithm with "rated_helpful" score via API
print_test_section "🧮 Test 2: Mock Algorithm - Rated Helpful Flow"

# First simulate algorithm detecting new proposal
INITIAL_SCORE_SUCCESS=$(set_proposal_score "$PROPOSAL_URI" "needs_more_ratings" "0.0")
test_result "Initial score set (needs_more_ratings)" "$([ "$INITIAL_SCORE_SUCCESS" = "true" ] && echo true || echo false)"

# Then simulate final algorithm scoring
FINAL_SCORE_SUCCESS=$(set_proposal_score "$PROPOSAL_URI" "rated_helpful" "0.85")
test_result "Score set via API" "$([ "$FINAL_SCORE_SUCCESS" = "true" ] && echo true || echo false)"

# Test 3: Verify status via getProposals API
print_test_section "🔍 Test 3: Verify Status via API"

PROPOSALS_RESPONSE=$(get_proposals_for_subject "$TOKEN" "$TEST_POST_URI")
PROPOSAL_STATUS=$(echo "$PROPOSALS_RESPONSE" | jq -r '.proposals[0].status // "null"')
test_result "Proposal status is rated_helpful" "$([ "$PROPOSAL_STATUS" = "rated_helpful" ] && echo true || echo false)" "Status: $PROPOSAL_STATUS"

# Test 6: Mock algorithm with "rated_not_helpful" status event (negative label)
print_test_section "🧮 Test 6: Mock Algorithm - Rated Not Helpful Flow"

# Create another test post and proposal for negative label testing
TEST_POST_URI_2=$(create_test_post "$TOKEN" "Second test post for negative label testing")
PROPOSAL_URI_2=$(create_community_note "$TOKEN" "$TEST_POST_URI_2" "Second test note for negative label testing" "needs-context" "[\"disputed_claim\"]")

test_result "Second test post and proposal created" "$([ -n "$TEST_POST_URI_2" ] && [ -n "$PROPOSAL_URI_2" ] && echo true || echo false)" "Post: $TEST_POST_URI_2, Proposal: $PROPOSAL_URI_2"

# Test the negative label transition sequence
# First set as needs_more_ratings
set_proposal_score "$PROPOSAL_URI_2" "needs_more_ratings" "0.0" > /dev/null

# Then set as rated_helpful first (to test the negative label transition)
set_proposal_score "$PROPOSAL_URI_2" "rated_helpful" "0.6" > /dev/null

# Finally change to rated_not_helpful to create negative label
NEGATIVE_SCORE_SUCCESS=$(set_proposal_score "$PROPOSAL_URI_2" "rated_not_helpful" "-0.3")
test_result "Negative label transition completed" "$([ "$NEGATIVE_SCORE_SUCCESS" = "true" ] && echo true || echo false)"

# Test 7: Verify negative label status via API
print_test_section "🔍 Test 7: Verify Negative Label Status via API"

PROPOSALS_RESPONSE_2=$(get_proposals_for_subject "$TOKEN" "$TEST_POST_URI_2")
PROPOSAL_STATUS_2=$(echo "$PROPOSALS_RESPONSE_2" | jq -r '.proposals[0].status // "null"')
test_result "Second proposal status is rated_not_helpful" "$([ "$PROPOSAL_STATUS_2" = "rated_not_helpful" ] && echo true || echo false)" "Status: $PROPOSAL_STATUS_2"

# Test 9: Status filtering functionality
print_test_section "🔍 Test 9: Status Filtering via API"

# Test status filter: rated_helpful
HELPFUL_PROPOSALS=$(get_proposals_for_subject "$TOKEN" "$TEST_POST_URI" "rated_helpful")
HELPFUL_COUNT=$(echo "$HELPFUL_PROPOSALS" | jq '.proposals | length')
test_result "Status filter: rated_helpful works" "$([ "$HELPFUL_COUNT" -gt "0" ] && echo true || echo false)"

# Test status filter: rated_not_helpful
NOT_HELPFUL_PROPOSALS=$(get_proposals_for_subject "$TOKEN" "$TEST_POST_URI_2" "rated_not_helpful")
NOT_HELPFUL_COUNT=$(echo "$NOT_HELPFUL_PROPOSALS" | jq '.proposals | length')
test_result "Status filter: rated_not_helpful works" "$([ "$NOT_HELPFUL_COUNT" -gt "0" ] && echo true || echo false)"

# Test status filter: needs_more_ratings (should return empty for our test posts)
NEEDS_MORE_PROPOSALS=$(get_proposals_for_subject "$TOKEN" "$TEST_POST_URI" "needs_more_ratings")
NEEDS_MORE_COUNT=$(echo "$NEEDS_MORE_PROPOSALS" | jq '.proposals | length')
test_result "Status filter: needs_more_ratings works" "$([ "$NEEDS_MORE_COUNT" = "0" ] && echo true || echo false)"



echo -e "${GREEN}🎉 Community Notes Labeler End-to-End Integration Tests Passed!${NC}"
echo ""

