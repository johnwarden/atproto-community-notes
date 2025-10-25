#!/bin/bash

# Comprehensive test for getProposals functionality:
# 1) Proposals the current user hasn't rated first
# 2) Score descending within each group (unrated vs rated)
# 3) Label filtering with proper ordering maintained
set -e

# Load shared test utilities
source "$(dirname "$0")/test-utils.sh"

echo "📊 Comprehensive getProposals Test (Ordering & Label Filtering)"
echo "=============================================================="

# Setup test environment with required services
setup_complete_test_environment "notes" "scoring"

# Authentication setup
ALICE_TOKEN=$(setup_authentication)

print_test_section "🔐 Bob Authentication Setup"
BOB_TOKEN=$(create_auth_token "bob.test")
test_result "Bob JWT token obtained" "$([ -n "$BOB_TOKEN" ] && echo true || echo false)"

# Test 1: Create posts and proposals with different scores
print_test_section "📝 Test 1: Create Test Data"

# Create test posts using utilities
ALICE_POST_URI=$(create_test_post "$ALICE_TOKEN" "Alice post for comprehensive ordering test")
test_result "Alice post created" "$([ -n "$ALICE_POST_URI" ] && echo true || echo false)"

BOB_POST_URI=$(create_test_post "$BOB_TOKEN" "Bob post for comprehensive ordering test" "bob.test")
test_result "Bob post created" "$([ -n "$BOB_POST_URI" ] && echo true || echo false)"

# Create proposals using utilities
ALICE_PROPOSAL_URI=$(create_community_note "$ALICE_TOKEN" "$ALICE_POST_URI" "Alice proposal on her own post - will be auto-rated" "annotation")
test_result "Alice proposal created" "$([ -n "$ALICE_PROPOSAL_URI" ] && echo true || echo false)"

BOB_ON_ALICE_URI=$(create_community_note "$BOB_TOKEN" "$ALICE_POST_URI" "Bob proposal on Alice post - unrated by Alice" "misleading")
test_result "Bob proposal on Alice post created" "$([ -n "$BOB_ON_ALICE_URI" ] && echo true || echo false)"

ALICE_ON_BOB_URI=$(create_community_note "$ALICE_TOKEN" "$BOB_POST_URI" "Alice proposal on Bob post - unrated by Bob" "harassment")
test_result "Alice proposal on Bob post created" "$([ -n "$ALICE_ON_BOB_URI" ] && echo true || echo false)"

# Test 2: Set different scores for proposals
print_test_section "⚖️ Test 2: Set Proposal Scores"

# Set scores using utility functions
ALICE_SCORE_SUCCESS=$(set_proposal_score "$ALICE_PROPOSAL_URI" "needs_more_ratings" "0.8")
test_result "Alice proposal score set to 0.8" "$([ "$ALICE_SCORE_SUCCESS" = "true" ] && echo true || echo false)"

BOB_ALICE_SCORE_SUCCESS=$(set_proposal_score "$BOB_ON_ALICE_URI" "needs_more_ratings" "0.3")
test_result "Bob proposal score set to 0.3" "$([ "$BOB_ALICE_SCORE_SUCCESS" = "true" ] && echo true || echo false)"

ALICE_BOB_SCORE_SUCCESS=$(set_proposal_score "$ALICE_ON_BOB_URI" "needs_more_ratings" "0.9")
test_result "Alice proposal on Bob post score set to 0.9" "$([ "$ALICE_BOB_SCORE_SUCCESS" = "true" ] && echo true || echo false)"

# Test 3: Check ordering for Alice viewing Alice's post
print_test_section "🔍 Test 3: Alice's View of Her Own Post"

# Alice should see proposals on her post in this order:
# 1. Bob's proposal (unrated by Alice, score 0.3) - FIRST (unrated)
# 2. Alice's proposal (auto-rated by Alice, score 0.8) - SECOND (rated, even though higher score)

ALICE_VIEW_RESPONSE=$(get_proposals_for_subject "$ALICE_TOKEN" "$ALICE_POST_URI")

# Extract Alice's view for testing

# Extract proposals
ALICE_FIRST=$(echo "$ALICE_VIEW_RESPONSE" | jq -r '.proposals[0].uri // "null"')
ALICE_SECOND=$(echo "$ALICE_VIEW_RESPONSE" | jq -r '.proposals[1].uri // "null"')

ALICE_FIRST_SCORE=$(echo "$ALICE_VIEW_RESPONSE" | jq -r '.proposals[0].score // "null"')
ALICE_SECOND_SCORE=$(echo "$ALICE_VIEW_RESPONSE" | jq -r '.proposals[1].score // "null"')

ALICE_FIRST_RATED=$(echo "$ALICE_VIEW_RESPONSE" | jq -r '.proposals[0].viewer.rating != null')
ALICE_SECOND_RATED=$(echo "$ALICE_VIEW_RESPONSE" | jq -r '.proposals[1].viewer.rating != null')



# Test ordering: unrated first (Bob's), then rated (Alice's)
test_result "First proposal for Alice is Bob's (unrated)" "$([ "$ALICE_FIRST" = "$BOB_ON_ALICE_URI" ] && echo true || echo false)"
test_result "First proposal is unrated by Alice" "$([ "$ALICE_FIRST_RATED" = "false" ] && echo true || echo false)"
test_result "Second proposal for Alice is Alice's (auto-rated)" "$([ "$ALICE_SECOND" = "$ALICE_PROPOSAL_URI" ] && echo true || echo false)"
test_result "Second proposal is rated by Alice" "$([ "$ALICE_SECOND_RATED" = "true" ] && echo true || echo false)"

# Test 4: Check ordering for Bob viewing Alice's post
print_test_section "🔍 Test 4: Bob's View of Alice's Post"

# Bob should see proposals on Alice's post in this order:
# 1. Alice's proposal (unrated by Bob, score 0.8) - FIRST (unrated + higher score)
# 2. Bob's proposal (auto-rated by Bob, score 0.3) - SECOND (rated)

BOB_VIEW_ALICE_RESPONSE=$(get_proposals_for_subject "$BOB_TOKEN" "$ALICE_POST_URI")

# Extract Bob's view for testing

BOB_ALICE_FIRST=$(echo "$BOB_VIEW_ALICE_RESPONSE" | jq -r '.proposals[0].uri // "null"')
BOB_ALICE_SECOND=$(echo "$BOB_VIEW_ALICE_RESPONSE" | jq -r '.proposals[1].uri // "null"')

BOB_ALICE_FIRST_RATED=$(echo "$BOB_VIEW_ALICE_RESPONSE" | jq -r '.proposals[0].viewer.rating != null')
BOB_ALICE_SECOND_RATED=$(echo "$BOB_VIEW_ALICE_RESPONSE" | jq -r '.proposals[1].viewer.rating != null')



test_result "First proposal for Bob is Alice's (unrated by Bob)" "$([ "$BOB_ALICE_FIRST" = "$ALICE_PROPOSAL_URI" ] && echo true || echo false)"
test_result "First proposal is unrated by Bob" "$([ "$BOB_ALICE_FIRST_RATED" = "false" ] && echo true || echo false)"
test_result "Second proposal for Bob is Bob's (auto-rated)" "$([ "$BOB_ALICE_SECOND" = "$BOB_ON_ALICE_URI" ] && echo true || echo false)"
test_result "Second proposal is rated by Bob" "$([ "$BOB_ALICE_SECOND_RATED" = "true" ] && echo true || echo false)"

# Test 5: Test cross-rating and re-ordering
print_test_section "⭐ Test 5: Cross-Rating and Re-ordering"

# Alice rates Bob's proposal
ALICE_RATING_URI=$(rate_proposal "$ALICE_TOKEN" "$BOB_ON_ALICE_URI" "-1" "[\"is_incorrect\"]")
test_result "Alice rated Bob's proposal" "$([ -n "$ALICE_RATING_URI" ] && echo true || echo false)"

# Now Alice should see only her own proposal (both are rated by her)
ALICE_VIEW_AFTER_RESPONSE=$(get_proposals_for_subject "$ALICE_TOKEN" "$ALICE_POST_URI")

ALICE_AFTER_COUNT=$(echo "$ALICE_VIEW_AFTER_RESPONSE" | jq '.proposals | length')
ALICE_AFTER_FIRST=$(echo "$ALICE_VIEW_AFTER_RESPONSE" | jq -r '.proposals[0].uri // "null"')
ALICE_AFTER_FIRST_RATED=$(echo "$ALICE_VIEW_AFTER_RESPONSE" | jq -r '.proposals[0].viewer.rating != null')

# Check Alice's view after rating

# Both proposals should still be visible, but now both are rated by Alice
# They should be ordered by score descending: Alice's (0.8) then Bob's (0.3)
test_result "Alice sees both proposals after rating" "$([ "$ALICE_AFTER_COUNT" -eq "2" ] && echo true || echo false)"
test_result "First proposal is Alice's (higher score)" "$([ "$ALICE_AFTER_FIRST" = "$ALICE_PROPOSAL_URI" ] && echo true || echo false)"

# Test 6: Score-based ordering within rated proposals
print_test_section "📈 Test 6: Score-Based Ordering Within Rated Proposals"

# Bob rates Alice's proposal too
BOB_RATING_URI=$(rate_proposal "$BOB_TOKEN" "$ALICE_PROPOSAL_URI" "1" "[\"is_clear\", \"addresses_claim\"]")
test_result "Bob rated Alice's proposal" "$([ -n "$BOB_RATING_URI" ] && echo true || echo false)"

# Now Bob should see proposals ordered by score (both are rated by him)
# Alice's (0.8) should come before Bob's (0.3)
BOB_VIEW_AFTER_RESPONSE=$(get_proposals_for_subject "$BOB_TOKEN" "$ALICE_POST_URI")

BOB_AFTER_FIRST=$(echo "$BOB_VIEW_AFTER_RESPONSE" | jq -r '.proposals[0].uri // "null"')
BOB_AFTER_FIRST_SCORE=$(echo "$BOB_VIEW_AFTER_RESPONSE" | jq -r '.proposals[0].score // "null"')

# Check Bob's view after rating

test_result "Bob sees Alice's proposal first (higher score)" "$([ "$BOB_AFTER_FIRST" = "$ALICE_PROPOSAL_URI" ] && echo true || echo false)"
test_result "First proposal has higher score (0.8)" "$([ "$BOB_AFTER_FIRST_SCORE" = "0.8" ] && echo true || echo false)"

# Test 7: Label Filter Testing
print_test_section "🏷️ Test 7: Label Filter Testing"

# Test basic label filtering - we have "annotation", "misleading", "harassment" labels
NEEDS_CONTEXT_COUNT=$(get_proposals_for_subject "$ALICE_TOKEN" "$ALICE_POST_URI" "" "annotation" | jq '.proposals | length')
MISLEADING_COUNT=$(get_proposals_for_subject "$ALICE_TOKEN" "$ALICE_POST_URI" "" "misleading" | jq '.proposals | length')
HARASSMENT_COUNT=$(get_proposals_for_subject "$BOB_TOKEN" "$BOB_POST_URI" "" "harassment" | jq '.proposals | length')
NONEXISTENT_COUNT=$(get_proposals_for_subject "$ALICE_TOKEN" "$ALICE_POST_URI" "" "nonexistent" | jq '.proposals | length')

test_result "Label filter 'annotation' returns 1 proposal" "$([ "$NEEDS_CONTEXT_COUNT" -eq "1" ] && echo true || echo false)"
test_result "Label filter 'misleading' returns 1 proposal" "$([ "$MISLEADING_COUNT" -eq "1" ] && echo true || echo false)"
test_result "Label filter 'harassment' returns 1 proposal" "$([ "$HARASSMENT_COUNT" -eq "1" ] && echo true || echo false)"
test_result "Label filter 'nonexistent' returns 0 proposals" "$([ "$NONEXISTENT_COUNT" -eq "0" ] && echo true || echo false)"

# Test that filtering preserves ordering (Bob should see Alice's unrated proposal first when filtering)
FILTERED_FIRST_URI=$(get_proposals_for_subject "$BOB_TOKEN" "$ALICE_POST_URI" "" "annotation" | jq -r '.proposals[0].uri')
test_result "Label filtering preserves ordering" "$([ "$FILTERED_FIRST_URI" = "$ALICE_PROPOSAL_URI" ] && echo true || echo false)"

# Test 8: Unauthenticated Access
print_test_section "🔓 Test 8: Unauthenticated Access"

# Call getProposals without authentication (empty token)
UNAUTH_RESPONSE=$(get_proposals_for_subject "" "$ALICE_POST_URI")
UNAUTH_COUNT=$(echo "$UNAUTH_RESPONSE" | jq '.proposals | length')

test_result "Unauthenticated access works" "$([ "$UNAUTH_COUNT" -ge "2" ] && echo true || echo false)"

# Verify no viewer rating information is present
UNAUTH_FIRST_HAS_VIEWER=$(echo "$UNAUTH_RESPONSE" | jq '.proposals[0].viewer != null')
UNAUTH_SECOND_HAS_VIEWER=$(echo "$UNAUTH_RESPONSE" | jq '.proposals[1].viewer != null')

test_result "First proposal has no viewer info" "$([ "$UNAUTH_FIRST_HAS_VIEWER" = "false" ] && echo true || echo false)"
test_result "Second proposal has no viewer info" "$([ "$UNAUTH_SECOND_HAS_VIEWER" = "false" ] && echo true || echo false)"

# Verify proposals are ordered by score (highest first)
UNAUTH_FIRST_SCORE=$(echo "$UNAUTH_RESPONSE" | jq -r '.proposals[0].score // 0')
UNAUTH_SECOND_SCORE=$(echo "$UNAUTH_RESPONSE" | jq -r '.proposals[1].score // 0')

# Compare scores (using awk for floating point comparison)
SCORE_ORDERED=$(echo "$UNAUTH_FIRST_SCORE $UNAUTH_SECOND_SCORE" | awk '{print ($1 >= $2) ? "true" : "false"}')
test_result "Unauthenticated proposals ordered by score (highest first)" "$SCORE_ORDERED"

echo -e "${GREEN}🎉 Comprehensive proposal ordering and label filtering test completed!${NC}"
