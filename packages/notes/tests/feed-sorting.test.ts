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

describe('Feed Sorting', () => {
  let network: TestNetworkWrapper
  let users: TestUsers
  let feedGeneratorDid: string | undefined
  let testPostUri: string
  let aliceProposalUri: string
  let bobProposalUri: string

  test('setup', async () => {
    // Setup test environment with required services (notes and scoring for multiple notes feed)
    network = await createTestNetwork()

    // Create test users (Alice and Bob)
    users = await createTestUsers(network)

    const bobToken = users.bob.agent.session?.accessJwt
    assert.ok(
      bobToken && bobToken.length > 0,
      `Bob JWT token obtained - BOB_TOKEN must be non-empty. Got: ${bobToken}`,
    )

    // Get feed generator DID from network (after services are fully initialized)
    feedGeneratorDid = network.notes?.feedGeneratorDid
  })

  test('📝 Test 1: Create Post for Multiple Notes', async () => {
    // Create a test post that will have multiple community notes
    testPostUri = await createTestPost(
      users.alice,
      'Controversial post that will get multiple community notes',
    )

    assert.ok(
      testPostUri && testPostUri.length > 0,
      `Test post created - TEST_POST_URI must be non-empty. Got: ${testPostUri}`,
    )
  })

  test('📝 Test 2: Alice Creates First Note', async () => {
    // Create Alice's note using utility function
    const { uri } = await createCommunityNote(
      network,
      users.alice,
      testPostUri,
      'This post needs additional context - first note',
      'annotation',
      ['factual_error'],
    )
    aliceProposalUri = uri

    assert.ok(
      aliceProposalUri && aliceProposalUri.length > 0,
      `Alice note created - ALICE_PROPOSAL_URI must be non-empty. Got: ${aliceProposalUri}`,
    )

    // Set score to needs_more_ratings
    const aliceScoreSuccess = await setProposalScore(
      network,
      aliceProposalUri,
      'needs_more_ratings',
      0.0,
    )

    assert.ok(
      aliceScoreSuccess,
      `Alice proposal score set - Score setting must succeed. Got: ${aliceScoreSuccess}`,
    )
  })

  test('📝 Test 3: Bob Creates Second Note', async () => {
    // Create Bob's note using utility function
    const { uri } = await createCommunityNote(
      network,
      users.bob,
      testPostUri,
      'This post is misleading - second note',
      'misleading',
      ['factual_error'],
    )
    bobProposalUri = uri

    assert.ok(
      bobProposalUri && bobProposalUri.length > 0,
      `Bob note created - BOB_PROPOSAL_URI must be non-empty. Got: ${bobProposalUri}`,
    )

    // Set score to needs_more_ratings
    const bobScoreSuccess = await setProposalScore(
      network,
      bobProposalUri,
      'needs_more_ratings',
      0.0,
    )

    assert.ok(
      bobScoreSuccess,
      `Bob proposal score set - Score setting must succeed. Got: ${bobScoreSuccess}`,
    )
  })

  test('🔍 Test 4: Check Feed with Multiple Notes', async () => {
    const needsHelpFeedUri = `at://${feedGeneratorDid}/app.bsky.feed.generator/needs_your_help`
    const encodedFeedUri = encodeURIComponent(needsHelpFeedUri)

    // Anonymous user should see the post (both notes need ratings)
    const anonResponse = await fetch(
      `${network.notes?.url}/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodedFeedUri}`,
    )

    assert.ok(anonResponse.ok, 'Anonymous feed request should succeed')
    const anonData = await anonResponse.json()

    const anonHasPost = anonData.feed.some(
      (item: any) => item.post === testPostUri,
    )

    assert.ok(
      anonHasPost,
      `Anonymous user sees test post with multiple notes - Post must be in feed. Found: ${anonHasPost}`,
    )

    // Alice should see the post (Bob's note needs her rating)
    const aliceResponse = await fetch(
      `${network.notes?.url}/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodedFeedUri}`,
      {
        headers: {
          Authorization: `Bearer ${users.alice.agent.session?.accessJwt}`,
        },
      },
    )

    assert.ok(aliceResponse.ok, 'Alice feed request should succeed')
    const aliceData = await aliceResponse.json()

    const aliceHasPost = aliceData.feed.some(
      (item: any) => item.post === testPostUri,
    )

    assert.ok(
      aliceHasPost,
      `Alice sees test post (Bob's note needs rating) - Post must be in Alice's feed. Found: ${aliceHasPost}`,
    )

    // Bob should see the post (Alice's note needs his rating)
    const bobResponse = await fetch(
      `${network.notes?.url}/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodedFeedUri}`,
      {
        headers: {
          Authorization: `Bearer ${users.bob.agent.session?.accessJwt}`,
        },
      },
    )

    assert.ok(bobResponse.ok, 'Bob feed request should succeed')
    const bobData = await bobResponse.json()

    const bobHasPost = bobData.feed.some(
      (item: any) => item.post === testPostUri,
    )

    assert.ok(
      bobHasPost,
      `Bob sees test post (Alice's note needs rating) - Post must be in Bob's feed. Found: ${bobHasPost}`,
    )
  })

  test("⭐ Test 5: Alice Rates Bob's Note", async () => {
    // Alice rates Bob's proposal
    const aliceRatingResponse = await fetch(
      `${network.notes?.url}/xrpc/org.opencommunitynotes.vote`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${users.alice.agent.session?.accessJwt}`,
        },
        body: JSON.stringify({
          uri: bobProposalUri,
          val: 1,
          reasons: ['is_clear', 'addresses_claim'],
        }),
      },
    )

    assert.ok(
      aliceRatingResponse.ok,
      `Alice rates Bob's note - Rating creation must succeed. Response ok: ${aliceRatingResponse.ok}`,
    )
  })

  test('🔍 Test 6: Check Feed After Cross-Rating', async () => {
    const needsHelpFeedUri = `at://${feedGeneratorDid}/app.bsky.feed.generator/needs_your_help`
    const encodedFeedUri = encodeURIComponent(needsHelpFeedUri)

    // Alice should NOT see the test post (she has rated both notes now)
    const aliceResponse2 = await fetch(
      `${network.notes?.url}/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodedFeedUri}`,
      {
        headers: {
          Authorization: `Bearer ${users.alice.agent.session?.accessJwt}`,
        },
      },
    )

    assert.ok(aliceResponse2.ok, 'Alice feed request should succeed')
    const aliceData2 = await aliceResponse2.json()

    const aliceSeesTestPost = aliceData2.feed.some(
      (item: any) => item.post === testPostUri,
    )

    assert.ok(
      !aliceSeesTestPost,
      `Alice does NOT see test post (rated both notes) - Post must not be in Alice's feed. Found: ${aliceSeesTestPost}`,
    )

    // Bob should see the post (Alice's note still needs his rating)
    const bobResponse2 = await fetch(
      `${network.notes?.url}/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodedFeedUri}`,
      {
        headers: {
          Authorization: `Bearer ${users.bob.agent.session?.accessJwt}`,
        },
      },
    )

    assert.ok(bobResponse2.ok, 'Bob feed request should succeed')
    const bobData2 = await bobResponse2.json()

    const bobHasPost2 = bobData2.feed.some(
      (item: any) => item.post === testPostUri,
    )

    assert.ok(
      bobHasPost2,
      `Bob sees test post (Alice's note still needs rating) - Post must be in Bob's feed. Found: ${bobHasPost2}`,
    )
  })

  test("⭐ Test 7: Bob Rates Alice's Note", async () => {
    // Bob rates Alice's proposal
    const bobRatingResponse = await fetch(
      `${network.notes?.url}/xrpc/org.opencommunitynotes.vote`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${users.bob.agent.session?.accessJwt}`,
        },
        body: JSON.stringify({
          uri: aliceProposalUri,
          val: -1,
          reasons: ['is_incorrect', 'sources_missing_or_unreliable'],
        }),
      },
    )

    assert.ok(
      bobRatingResponse.ok,
      `Bob rates Alice's note - Rating creation must succeed. Response ok: ${bobRatingResponse.ok}`,
    )
  })

  test('🔍 Test 8: Check Feed After All Notes Rated', async () => {
    const needsHelpFeedUri = `at://${feedGeneratorDid}/app.bsky.feed.generator/needs_your_help`
    const encodedFeedUri = encodeURIComponent(needsHelpFeedUri)

    // Alice should still NOT see the test post (rated both notes)
    const aliceResponse3 = await fetch(
      `${network.notes?.url}/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodedFeedUri}`,
      {
        headers: {
          Authorization: `Bearer ${users.alice.agent.session?.accessJwt}`,
        },
      },
    )

    assert.ok(aliceResponse3.ok, 'Alice feed request should succeed')
    const aliceData3 = await aliceResponse3.json()

    const aliceSeesTestPost3 = aliceData3.feed.some(
      (item: any) => item.post === testPostUri,
    )

    assert.ok(
      !aliceSeesTestPost3,
      `Alice does NOT see test post (rated all notes) - Post must not be in Alice's feed. Found: ${aliceSeesTestPost3}`,
    )

    // Bob should NOT see the test post (rated both notes)
    const bobResponse3 = await fetch(
      `${network.notes?.url}/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodedFeedUri}`,
      {
        headers: {
          Authorization: `Bearer ${users.bob.agent.session?.accessJwt}`,
        },
      },
    )

    assert.ok(bobResponse3.ok, 'Bob feed request should succeed')
    const bobData3 = await bobResponse3.json()

    const bobSeesTestPost3 = bobData3.feed.some(
      (item: any) => item.post === testPostUri,
    )

    assert.ok(
      !bobSeesTestPost3,
      `Bob does NOT see test post (rated all notes) - Post must not be in Bob's feed. Found: ${bobSeesTestPost3}`,
    )

    // Anonymous users should still see it (notes still need more ratings from other users)
    const anonResponse2 = await fetch(
      `${network.notes?.url}/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodedFeedUri}`,
    )

    assert.ok(anonResponse2.ok, 'Anonymous feed request should succeed')
    const anonData2 = await anonResponse2.json()

    const anonHasPost2 = anonData2.feed.some(
      (item: any) => item.post === testPostUri,
    )

    assert.ok(
      anonHasPost2,
      `Anonymous users still see test post (needs more ratings) - Post must be in anonymous feed. Found: ${anonHasPost2}`,
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
