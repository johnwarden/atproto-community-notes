#!/bin/bash

# Test that "Needs Your Help" feed correctly handles posts with multiple community notes
set -e

# Load shared test utilities
source "$(dirname "$0")/test-utils.sh"

echo "📝 Multiple Notes Per Post Feed Test"
echo "==================================="

# Setup test environment with required services
setup_complete_test_environment "notes"

# Authentication setup
ALICE_TOKEN=$(setup_authentication)

print_test_section "🔐 Bob Authentication Setup"
BOB_TOKEN=$(create_auth_token "bob.test")
test_result "Bob JWT token obtained" "$([ -n "$BOB_TOKEN" ] && echo true || echo false)"

# Test 1: Create a post that will have multiple community notes
print_test_section "📝 Test 1: Create Post for Multiple Notes"

# Create a test post using utility
TEST_POST_URI=$(create_test_post "$ALICE_TOKEN" "Controversial post that will get multiple community notes")
test_result "Test post created" "$([ -n "$TEST_POST_URI" ] && echo true || echo false)"

# Test 2: Alice creates first community note
print_test_section "📝 Test 2: Alice Creates First Note"

# Create Alice's note and set it to needs_more_ratings
ALICE_PROPOSAL_URI=$(create_community_note "$ALICE_TOKEN" "$TEST_POST_URI" "This post needs additional context - first note" "needs-context")
ALICE_SCORE_SUCCESS=$(set_proposal_score "$ALICE_PROPOSAL_URI" "needs_more_ratings" "0.0")

test_result "Alice note created and scored" "$([ -n "$ALICE_PROPOSAL_URI" ] && [ "$ALICE_SCORE_SUCCESS" = "true" ] && echo true || echo false)"

# Test 3: Bob creates second community note on same post
print_test_section "📝 Test 3: Bob Creates Second Note"

# Create Bob's note and set it to needs_more_ratings
BOB_PROPOSAL_URI=$(create_community_note "$BOB_TOKEN" "$TEST_POST_URI" "This post is misleading - second note" "misleading")
BOB_SCORE_SUCCESS=$(set_proposal_score "$BOB_PROPOSAL_URI" "needs_more_ratings" "0.0")

test_result "Bob note created and scored" "$([ -n "$BOB_PROPOSAL_URI" ] && [ "$BOB_SCORE_SUCCESS" = "true" ] && echo true || echo false)"

# Test 4: Check feed behavior with multiple notes
print_test_section "🔍 Test 4: Check Feed with Multiple Notes"

NEEDS_HELP_FEED_URI="at://${REPO_DID}/app.bsky.feed.generator/needs_your_help"
ENCODED_FEED_URI=$(url_encode "$NEEDS_HELP_FEED_URI")

# Anonymous user should see the post (both notes need ratings)
ANON_RESPONSE=$(curl -s "$NOTES_SERVICE_URL/xrpc/app.bsky.feed.getFeedSkeleton?feed=$ENCODED_FEED_URI")
ANON_HAS_POST=$(echo "$ANON_RESPONSE" | jq --arg uri "$TEST_POST_URI" '.feed | any(.post == $uri)')
test_result "Anonymous user sees test post with multiple notes" "$([ "$ANON_HAS_POST" = "true" ] && echo true || echo false)"

# Alice should see the post (Bob's note needs her rating)
ALICE_RESPONSE=$(curl -s "$NOTES_SERVICE_URL/xrpc/app.bsky.feed.getFeedSkeleton?feed=$ENCODED_FEED_URI" \
  -H "Authorization: Bearer $ALICE_TOKEN")
ALICE_HAS_POST=$(echo "$ALICE_RESPONSE" | jq --arg uri "$TEST_POST_URI" '.feed | any(.post == $uri)')
test_result "Alice sees test post (Bob's note needs rating)" "$([ "$ALICE_HAS_POST" = "true" ] && echo true || echo false)"

# Bob should see the post (Alice's note needs his rating)
BOB_RESPONSE=$(curl -s "$NOTES_SERVICE_URL/xrpc/app.bsky.feed.getFeedSkeleton?feed=$ENCODED_FEED_URI" \
  -H "Authorization: Bearer $BOB_TOKEN")
BOB_HAS_POST=$(echo "$BOB_RESPONSE" | jq --arg uri "$TEST_POST_URI" '.feed | any(.post == $uri)')
test_result "Bob sees test post (Alice's note needs rating)" "$([ "$BOB_HAS_POST" = "true" ] && echo true || echo false)"

# Test 5: Alice rates Bob's note
print_test_section "⭐ Test 5: Alice Rates Bob's Note"

ALICE_RATING_URI=$(rate_proposal "$ALICE_TOKEN" "$BOB_PROPOSAL_URI" "1" "[\"is_clear\", \"addresses_claim\"]")
test_result "Alice rated Bob's note" "$([ -n "$ALICE_RATING_URI" ] && echo true || echo false)"

# Test 6: Check feed after Alice rates Bob's note
print_test_section "🔍 Test 6: Check Feed After Cross-Rating"

# Alice should NOT see the test post (she has rated both notes now)
ALICE_RESPONSE_2=$(curl -s "$NOTES_SERVICE_URL/xrpc/app.bsky.feed.getFeedSkeleton?feed=$ENCODED_FEED_URI" \
  -H "Authorization: Bearer $ALICE_TOKEN")

# Check if Alice sees the specific test post (not just any post)
ALICE_SEES_TEST_POST=$(echo "$ALICE_RESPONSE_2" | jq --arg test_post "$TEST_POST_URI" '.feed[] | select(.post == $test_post) | length')
test_result "Alice does NOT see the test post (rated both notes)" "$([ "$ALICE_SEES_TEST_POST" = "null" ] || [ "$ALICE_SEES_TEST_POST" = "" ] && echo true || echo false)" "Alice sees test post: $ALICE_SEES_TEST_POST"

# Bob should see the post (Alice's note still needs his rating)
BOB_RESPONSE_2=$(curl -s "$NOTES_SERVICE_URL/xrpc/app.bsky.feed.getFeedSkeleton?feed=$ENCODED_FEED_URI" \
  -H "Authorization: Bearer $BOB_TOKEN")
BOB_HAS_POST_2=$(echo "$BOB_RESPONSE_2" | jq --arg uri "$TEST_POST_URI" '.feed | any(.post == $uri)')
test_result "Bob sees test post (Alice's note still needs rating)" "$([ "$BOB_HAS_POST_2" = "true" ] && echo true || echo false)"

# Test 7: Bob rates Alice's note
print_test_section "⭐ Test 7: Bob Rates Alice's Note"

BOB_RATING_URI=$(rate_proposal "$BOB_TOKEN" "$ALICE_PROPOSAL_URI" "-1" "[\"is_incorrect\", \"sources_missing_or_unreliable\"]")
test_result "Bob rated Alice's note" "$([ -n "$BOB_RATING_URI" ] && echo true || echo false)"

# Test 8: Check feed after both users have rated both notes
print_test_section "🔍 Test 8: Check Feed After All Notes Rated"

# Alice should still NOT see the test post (rated both notes)
ALICE_RESPONSE_3=$(curl -s "$NOTES_SERVICE_URL/xrpc/app.bsky.feed.getFeedSkeleton?feed=$ENCODED_FEED_URI" \
  -H "Authorization: Bearer $ALICE_TOKEN")
ALICE_SEES_TEST_POST_3=$(echo "$ALICE_RESPONSE_3" | jq --arg test_post "$TEST_POST_URI" '.feed[] | select(.post == $test_post) | length')
test_result "Alice does NOT see test post (rated all notes)" "$([ "$ALICE_SEES_TEST_POST_3" = "null" ] || [ "$ALICE_SEES_TEST_POST_3" = "" ] && echo true || echo false)" "Alice sees test post: $ALICE_SEES_TEST_POST_3"

# Bob should NOT see the test post (rated both notes)
BOB_RESPONSE_3=$(curl -s "$NOTES_SERVICE_URL/xrpc/app.bsky.feed.getFeedSkeleton?feed=$ENCODED_FEED_URI" \
  -H "Authorization: Bearer $BOB_TOKEN")
BOB_SEES_TEST_POST_3=$(echo "$BOB_RESPONSE_3" | jq --arg test_post "$TEST_POST_URI" '.feed[] | select(.post == $test_post) | length')
test_result "Bob does NOT see test post (rated all notes)" "$([ "$BOB_SEES_TEST_POST_3" = "null" ] || [ "$BOB_SEES_TEST_POST_3" = "" ] && echo true || echo false)" "Bob sees test post: $BOB_SEES_TEST_POST_3"

# Anonymous users should still see it (notes still need more ratings from other users)
ANON_RESPONSE_2=$(curl -s "$NOTES_SERVICE_URL/xrpc/app.bsky.feed.getFeedSkeleton?feed=$ENCODED_FEED_URI")
ANON_HAS_POST_2=$(echo "$ANON_RESPONSE_2" | jq --arg uri "$TEST_POST_URI" '.feed | any(.post == $uri)')
test_result "Anonymous users still see test post (needs more ratings)" "$([ "$ANON_HAS_POST_2" = "true" ] && echo true || echo false)"

echo -e "${GREEN}🎉 Multiple notes per post feed test completed!${NC}"
echo ""
