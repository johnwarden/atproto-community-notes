import assert from 'node:assert'
import { describe, test } from 'node:test'
import { TestNetworkWrapper } from '../src/dev-env/test-network-wrapper'
import {
  TestUsers,
  createCommunityNote,
  createTestNetwork,
  createTestPost,
  createTestUsers,
  setProposalScore,
} from './test-utils'

describe('Feed Skeleton Test', () => {
  let network: TestNetworkWrapper
  let users: TestUsers
  let feedGeneratorDid: string
  let feeds: any[]
  let testPostUri: string

  test('setup', async () => {
    // Setup test environment with required services (notes, bsky, scoring for feeds)
    network = await createTestNetwork()

    // Create test users (Alice and Bob)
    users = await createTestUsers(network)
  })

  test('📊 Test 1: Feed Generator Discovery', async () => {
    // Test feed generator discovery
    const response = await fetch(
      `${network.notes?.url}/xrpc/app.bsky.feed.describeFeedGenerator`,
    )

    assert.ok(response.ok, 'describeFeedGenerator should succeed')
    const data = await response.json()

    assert.ok(data.did, 'Should have feed generator DID')
    assert.ok(Array.isArray(data.feeds), 'Should have feeds array')

    const feedCount = data.feeds.length
    assert.strictEqual(
      feedCount,
      3,
      `Feed generator describes 3 feeds - Feed count must be 3. Got: ${feedCount}`,
    )

    feedGeneratorDid = data.did
    feeds = data.feeds

    assert.ok(
      feedGeneratorDid && feedGeneratorDid !== 'unknown',
      `Feed generator repo DID matches expected - REPO_DID must be non-empty and not "unknown". Got: ${feedGeneratorDid}`,
    )

    // Verify expected feed types exist
    const feedUris = feeds.map((f) => f.uri)
    const expectedFeeds = ['new', 'needs_your_help', 'rated_helpful']

    for (const expectedFeed of expectedFeeds) {
      const feedExists = feedUris.some((uri) => uri.includes(expectedFeed))
      assert.ok(feedExists, `Should have ${expectedFeed} feed`)
    }
  })

  test('📝 Test 2: Create Test Data', async () => {
    // Create test post
    testPostUri = await createTestPost(
      users.alice,
      'This is a test post for feed testing',
    )

    assert.ok(
      testPostUri && testPostUri.length > 0,
      `Test post created - TEST_POST_URI must be non-empty. Got: ${testPostUri}`,
    )

    // Create scored proposal (matching shell test behavior)
    const { uri: aliceNoteUri } = await createCommunityNote(
      network,
      users.alice,
      testPostUri,
      'This post needs additional context for feed testing',
      'needs-context',
      ['disputed_claim'],
    )

    assert.ok(
      aliceNoteUri && aliceNoteUri.length > 0,
      `Scored proposal created - PROPOSAL_URI must be non-empty. Got: ${aliceNoteUri}`,
    )

    // Set proposal score to needs_more_ratings (matching shell test)
    const scoreSuccess = await setProposalScore(
      network,
      aliceNoteUri,
      'needs_more_ratings',
      0.0,
    )

    assert.ok(
      scoreSuccess,
      `Proposal score set - Score setting must succeed. Got: ${scoreSuccess}`,
    )
  })

  test('📊 Test 3: Feed Skeleton Endpoints', async () => {
    // Test each feed skeleton endpoint
    const feedResults: { [key: string]: boolean } = {}

    for (const feed of feeds) {
      const encodedFeedUri = encodeURIComponent(feed.uri)
      const response = await fetch(
        `${network.notes?.url}/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodedFeedUri}`,
      )

      const feedName = feed.uri.split('/').pop() || 'unknown'
      const isWorking = response.ok
      feedResults[feedName] = isWorking

      assert.ok(isWorking, `Feed ${feed.uri} should be accessible`)

      if (isWorking) {
        const data = await response.json()
        assert.ok(
          Array.isArray(data.feed),
          `Feed ${feed.uri} should return array`,
        )
      }
    }

    const allWorking = Object.values(feedResults).every((working) => working)
    assert.ok(
      allWorking,
      `All feed skeleton endpoints work - All feeds must be accessible. Results: ${JSON.stringify(feedResults)}`,
    )
  })

  test('🔐 Test 4: Authenticated vs Anonymous Access', async () => {
    // Test "Needs Your Help" feed with both anonymous and authenticated access
    const needsHelpFeed = feeds.find((f) => f.uri.includes('needs_your_help'))
    assert.ok(needsHelpFeed, 'Should find needs_your_help feed')

    const encodedFeedUri = encodeURIComponent(needsHelpFeed.uri)

    // Anonymous access
    const anonResponse = await fetch(
      `${network.notes?.url}/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodedFeedUri}`,
    )

    assert.ok(
      anonResponse.ok,
      `Anonymous access working - Anonymous access must succeed. Status: ${anonResponse.status}`,
    )
    const anonData = await anonResponse.json()
    assert.ok(
      Array.isArray(anonData.feed),
      'Anonymous response should have feed array',
    )

    // Authenticated access
    const authResponse = await fetch(
      `${network.notes?.url}/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodedFeedUri}`,
      {
        headers: {
          Authorization: `Bearer ${users.alice.agent.session?.accessJwt}`,
        },
      },
    )

    assert.ok(
      authResponse.ok,
      `Authenticated access working - Authenticated access must succeed. Status: ${authResponse.status}`,
    )
    const authData = await authResponse.json()
    assert.ok(
      Array.isArray(authData.feed),
      'Authenticated response should have feed array',
    )
  })

  test('📄 Test 5: Pagination', async () => {
    // Test pagination with limit parameter
    const newFeed = feeds.find((f) => f.uri.includes('new'))
    assert.ok(newFeed, 'Should find new feed')

    const encodedFeedUri = encodeURIComponent(newFeed.uri)
    const response = await fetch(
      `${network.notes?.url}/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodedFeedUri}&limit=1`,
    )

    assert.ok(
      response.ok,
      `Pagination response received - Pagination request must succeed. Status: ${response.status}`,
    )
    const data = await response.json()

    // Verify response structure
    assert.ok(Array.isArray(data.feed), 'Should have feed array')

    const feedItemCount = data.feed.length

    assert.ok(
      feedItemCount <= 1,
      `Pagination limit working - Feed items should be <= 1 with limit=1. Got: ${feedItemCount}`,
    )
  })

  test('🌅 Test 6: Feed Generator Integration', async () => {
    // Test feed generator integration points

    // Verify feed generator DID is returned correctly
    assert.ok(feedGeneratorDid, 'Feed generator DID should be available')

    // Verify feed URIs point to correct repository
    const firstFeedUri = feeds[0].uri
    const expectedUriPrefix = `at://${feedGeneratorDid}/app.bsky.feed.generator/`

    assert.ok(
      firstFeedUri.startsWith(expectedUriPrefix),
      `Feed URIs point to service account repository - URI must start with expected prefix. Expected: ${expectedUriPrefix}, Got: ${firstFeedUri}`,
    )

    // Verify our service can handle feed requests directly
    const encodedFeedUri = encodeURIComponent(firstFeedUri)
    const directFeedResponse = await fetch(
      `${network.notes?.url}/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodedFeedUri}`,
    )

    assert.ok(
      directFeedResponse.ok,
      `Service can handle direct feed requests - Direct feed request must succeed. Status: ${directFeedResponse.status}`,
    )
    const directFeedData = await directFeedResponse.json()
    assert.ok(
      Array.isArray(directFeedData.feed),
      'Direct feed response should have feed array',
    )
  })

  test('🚫 Test 7: Error Handling', async () => {
    // Test error handling with invalid feed URI
    const invalidFeedUri = `at://${feedGeneratorDid}/app.bsky.feed.generator/invalid-feed`
    const encodedInvalidUri = encodeURIComponent(invalidFeedUri)

    const response = await fetch(
      `${network.notes?.url}/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodedInvalidUri}`,
    )

    let invalidFeedHandled = false
    if (!response.ok) {
      // Invalid feed URI properly rejected
      invalidFeedHandled = true
    } else {
      const data = await response.json()
      if (Array.isArray(data.feed)) {
        // Invalid feed URI handled gracefully with proper structure
        invalidFeedHandled = true
      }
    }

    assert.ok(
      invalidFeedHandled,
      `Invalid feed URI handled gracefully - Must either reject or return proper structure. Status: ${response.status}`,
    )

    // Test with malformed feed URI
    const malformedUri = 'not-a-valid-uri'
    const encodedMalformedUri = encodeURIComponent(malformedUri)

    const malformedResponse = await fetch(
      `${network.notes?.url}/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodedMalformedUri}`,
    )

    assert.ok(
      !malformedResponse.ok,
      `Malformed URI handled gracefully - Must handle malformed URIs without crashing. Status: ${malformedResponse.status}`,
    )
  })

  test('cleanup', async () => {
    try {
      await network?.close()
    } catch (error: any) {
      process.stderr.write(`⚠️ Cleanup error: ${error.message}\n`)
    }
  })
})
