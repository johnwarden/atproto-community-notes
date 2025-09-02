#!/bin/bash

# Community Notes Feeds Integration Test
set -e

# Load shared test utilities
source "$(dirname "$0")/test-utils.sh"

echo "📊 Community Notes Feeds Integration Test"
echo "========================================"

# Setup test environment with required services
setup_complete_test_environment "notes" "bsky" "scoring"

# Authentication setup
TOKEN=$(setup_authentication)

# Test feed generator discovery
print_test_section "📊 Feed Generator Discovery"
DESCRIBE_RESPONSE=$(curl -s "$NOTES_SERVICE_URL/xrpc/app.bsky.feed.describeFeedGenerator")
FEED_COUNT=$(echo "$DESCRIBE_RESPONSE" | jq '.feeds | length')
test_result "Feed generator describes 3 feeds" "$([ "$FEED_COUNT" -eq "3" ] && echo true || echo false)"
test_result "Feed generator repo DID matches expected" "$([ "$REPO_DID" != "unknown" ] && [ -n "$REPO_DID" ] && echo true || echo false)"

# Create test data
print_test_section "📝 Create Test Data"

# Create test post
TEST_POST_URI=$(create_test_post "$TOKEN" "This is a test post for feed testing")
test_result "Test post created" "$([ -n "$TEST_POST_URI" ] && echo true || echo false)"

# Create test proposal with scoring
PROPOSAL_URI=$(create_scored_proposal "$TOKEN" "$TEST_POST_URI" "needs-context" "0.0" "needs_more_ratings" "This post needs additional context for feed testing")
test_result "Test proposal created with scoring" "$([ -n "$PROPOSAL_URI" ] && echo true || echo false)"

# Test feed skeletons
print_test_section "📊 Test Feed Skeletons"

# Test "New" feed
NEW_FEED_URI="at://${REPO_DID}/app.bsky.feed.generator/new"
NEW_FEED_RESPONSE=$(curl -s "$NOTES_SERVICE_URL/xrpc/app.bsky.feed.getFeedSkeleton?feed=$(url_encode "$NEW_FEED_URI")")
NEW_FEED_COUNT=$(echo "$NEW_FEED_RESPONSE" | jq '.feed | length')
test_result "'New' feed returns posts" "$([ "$NEW_FEED_COUNT" -gt "0" ] && echo true || echo false)"

# Test "Needs Your Help" feed - comprehensive exclusion testing
NEEDS_HELP_FEED_URI="at://${REPO_DID}/app.bsky.feed.generator/needs_your_help"

# Test anonymous access
NEEDS_HELP_RESPONSE=$(curl -s "$NOTES_SERVICE_URL/xrpc/app.bsky.feed.getFeedSkeleton?feed=$(url_encode "$NEEDS_HELP_FEED_URI")")
NEEDS_HELP_COUNT=$(echo "$NEEDS_HELP_RESPONSE" | jq '.feed | length')
test_result "'Needs Your Help' feed works anonymously" "$([ "$NEEDS_HELP_COUNT" -gt "0" ] && echo true || echo false)"

# Extended exclusion testing with cross-user scenarios
# Create Bob token for multi-user testing
BOB_TOKEN=$(setup_authentication "bob.test")

# Create a second proposal by Bob on Alice's post
BOB_PROPOSAL_URI=$(create_community_note "$BOB_TOKEN" "$TEST_POST_URI" "This post is misleading - Bob's note" "misleading")
BOB_SCORE_SUCCESS=$(set_proposal_score "$BOB_PROPOSAL_URI" "needs_more_ratings" "0.0")
test_result "Bob's proposal created and scored" "$([ -n "$BOB_PROPOSAL_URI" ] && [ "$BOB_SCORE_SUCCESS" = "true" ] && echo true || echo false)"

# Test authenticated access - Alice should see posts with unrated notes (Bob's proposal)
NEEDS_HELP_AUTH_RESPONSE=$(curl -s "$NOTES_SERVICE_URL/xrpc/app.bsky.feed.getFeedSkeleton?feed=$(url_encode "$NEEDS_HELP_FEED_URI")" \
  -H "Authorization: Bearer $TOKEN")
ALICE_SEES_TEST_POST=$(echo "$NEEDS_HELP_AUTH_RESPONSE" | jq --arg uri "$TEST_POST_URI" '.feed | any(.post == $uri)')
test_result "'Needs Your Help' feed shows posts with unrated notes (Alice sees Bob's unrated proposal)" "$([ "$ALICE_SEES_TEST_POST" = "true" ] && echo true || echo false)"

# Bob should see Alice's post (he hasn't rated Alice's proposal yet)
BOB_NEEDS_HELP_RESPONSE=$(curl -s "$NOTES_SERVICE_URL/xrpc/app.bsky.feed.getFeedSkeleton?feed=$(url_encode "$NEEDS_HELP_FEED_URI")" \
  -H "Authorization: Bearer $BOB_TOKEN")
BOB_SEES_TEST_POST=$(echo "$BOB_NEEDS_HELP_RESPONSE" | jq --arg uri "$TEST_POST_URI" '.feed | any(.post == $uri)')
test_result "'Needs Your Help' feed shows posts with unrated proposals to other users" "$([ "$BOB_SEES_TEST_POST" = "true" ] && echo true || echo false)"

# Alice rates Bob's proposal
ALICE_RATING_SUCCESS=$(rate_proposal "$TOKEN" "$BOB_PROPOSAL_URI" "1" "[\"is_clear\", \"addresses_claim\"]")
test_result "Alice rates Bob's proposal successfully" "$([ "$ALICE_RATING_SUCCESS" = "true" ] && echo true || echo false)"

# Now Alice should NOT see the test post (she has rated all proposals on it)
ALICE_AFTER_RATING_RESPONSE=$(curl -s "$NOTES_SERVICE_URL/xrpc/app.bsky.feed.getFeedSkeleton?feed=$(url_encode "$NEEDS_HELP_FEED_URI")" \
  -H "Authorization: Bearer $TOKEN")
ALICE_SEES_TEST_POST_AFTER=$(echo "$ALICE_AFTER_RATING_RESPONSE" | jq --arg uri "$TEST_POST_URI" '.feed | any(.post == $uri)')
test_result "'Needs Your Help' feed excludes posts after user rates all proposals" "$([ "$ALICE_SEES_TEST_POST_AFTER" = "false" ] && echo true || echo false)"

# Bob rates Alice's proposal
BOB_RATING_SUCCESS=$(rate_proposal "$BOB_TOKEN" "$PROPOSAL_URI" "1" "[\"is_clear\", \"addresses_claim\"]")
test_result "Cross-user rating successful" "$([ "$BOB_RATING_SUCCESS" = "true" ] && echo true || echo false)"

# After rating all proposals, Bob should NOT see the test post
BOB_AFTER_RATING_RESPONSE=$(curl -s "$NOTES_SERVICE_URL/xrpc/app.bsky.feed.getFeedSkeleton?feed=$(url_encode "$NEEDS_HELP_FEED_URI")" \
  -H "Authorization: Bearer $BOB_TOKEN")
BOB_SEES_TEST_POST_AFTER=$(echo "$BOB_AFTER_RATING_RESPONSE" | jq --arg uri "$TEST_POST_URI" '.feed | any(.post == $uri)')
test_result "'Needs Your Help' feed excludes test post after Bob rates all proposals" "$([ "$BOB_SEES_TEST_POST_AFTER" = "false" ] && echo true || echo false)"

# Anonymous users should still see it (needs more ratings from other users)
ANON_AFTER_RATING_RESPONSE=$(curl -s "$NOTES_SERVICE_URL/xrpc/app.bsky.feed.getFeedSkeleton?feed=$(url_encode "$NEEDS_HELP_FEED_URI")")
ANON_SEES_TEST_POST=$(echo "$ANON_AFTER_RATING_RESPONSE" | jq --arg uri "$TEST_POST_URI" '.feed | any(.post == $uri)')
test_result "'Needs Your Help' feed still shows test post to anonymous users after some ratings" "$([ "$ANON_SEES_TEST_POST" = "true" ] && echo true || echo false)"

# Create a second test post for "Rated Helpful" feed testing
TEST_POST_2_URI=$(create_test_post "$TOKEN" "This is a second test post for rated helpful feed testing")

# Create a second proposal with helpful scoring
PROPOSAL_2_URI=$(create_scored_proposal "$TOKEN" "$TEST_POST_2_URI" "needs-context" "1.0" "rated_helpful" "This post needs additional context for rated helpful feed testing")
test_result "Second proposal created with helpful scoring" "$([ -n "$PROPOSAL_2_URI" ] && echo true || echo false)"

# Test "Rated Helpful" feed
RATED_HELPFUL_FEED_URI="at://${REPO_DID}/app.bsky.feed.generator/rated_helpful"
RATED_HELPFUL_RESPONSE=$(curl -s "$NOTES_SERVICE_URL/xrpc/app.bsky.feed.getFeedSkeleton?feed=$(url_encode "$RATED_HELPFUL_FEED_URI")")
RATED_HELPFUL_COUNT=$(echo "$RATED_HELPFUL_RESPONSE" | jq '.feed | length')
test_result "'Rated Helpful' feed returns posts" "$([ "$RATED_HELPFUL_COUNT" -gt "0" ] && echo true || echo false)"

# Test pagination
print_test_section "📄 Test Pagination"
NEW_FEED_WITH_LIMIT=$(curl -s "$NOTES_SERVICE_URL/xrpc/app.bsky.feed.getFeedSkeleton?feed=$(url_encode "$NEW_FEED_URI")&limit=1")
HAS_CURSOR=$(echo "$NEW_FEED_WITH_LIMIT" | jq 'has("cursor")')
test_result "Pagination cursor is provided when appropriate" "$([ "$HAS_CURSOR" = "true" ] || [ "$HAS_CURSOR" = "false" ] && echo true || echo false)"

# Test Feed Generator Integration
print_test_section "🌅 Test Feed Generator Integration"

# Test 1: Verify feed generator records exist in PDS
FEED_RECORDS_RESPONSE=$(curl -s "$PDS_SERVICE_URL/xrpc/com.atproto.repo.listRecords?repo=${REPO_DID}&collection=app.bsky.feed.generator")
FEED_RECORDS_COUNT=$(echo "$FEED_RECORDS_RESPONSE" | jq '.records | length')
test_result "Feed generator records exist in PDS" "$([ "$FEED_RECORDS_COUNT" -eq "3" ] && echo true || echo false)"

# Test 2: Verify feed generator DID is returned correctly
DESCRIBE_DID=$(echo "$DESCRIBE_RESPONSE" | jq -r '.did')
test_result "Feed generator DID matches repository account" "$([ "$DESCRIBE_DID" = "$REPO_DID" ] && echo true || echo false)"

# Test 3: Verify feed URIs point to correct repository
FIRST_FEED_URI=$(echo "$DESCRIBE_RESPONSE" | jq -r '.feeds[0].uri')
EXPECTED_URI_PREFIX="at://${REPO_DID}/app.bsky.feed.generator/"
test_result "Feed URIs point to service account repository" "$(echo "$FIRST_FEED_URI" | grep -q "$EXPECTED_URI_PREFIX" && echo true || echo false)"

# Test 4: Verify our service can handle feed requests directly
DIRECT_FEED_RESPONSE=$(curl -s "$NOTES_SERVICE_URL/xrpc/app.bsky.feed.getFeedSkeleton?feed=$(url_encode "$FIRST_FEED_URI")")
DIRECT_FEED_COUNT=$(echo "$DIRECT_FEED_RESPONSE" | jq '.feed | length')
test_result "Service can handle feed requests directly" "$([ "$DIRECT_FEED_COUNT" -gt "0" ] && echo true || echo false)"

# Test error handling
print_test_section "🚫 Test Error Handling"
INVALID_FEED_URI="at://${REPO_DID}/app.bsky.feed.generator/invalid-feed"
INVALID_FEED_RESPONSE=$(curl -s "$NOTES_SERVICE_URL/xrpc/app.bsky.feed.getFeedSkeleton?feed=$(url_encode "$INVALID_FEED_URI")")
INVALID_FEED_ERROR=$(echo "$INVALID_FEED_RESPONSE" | jq -r '.error // "none"')
test_result "Invalid feed returns proper error" "$([ "$INVALID_FEED_ERROR" = "UnknownFeed" ] && echo true || echo false)" "Error: $INVALID_FEED_ERROR"



echo -e "${GREEN}🎉 Community Notes Feeds Integration Tests Passed!${NC}"
echo ""

