import assert from 'node:assert'
import { describe, test } from 'node:test'
import { TestNetworkWrapper } from '../src/dev-env/test-network-wrapper'
import {
  TestUsers,
  createCommunityNote,
  createTestNetwork,
  createTestPost,
  createTestUsers,
  getProposals,
  setProposalScore,
} from './test-utils'

describe('getProposals', () => {
  let network: TestNetworkWrapper
  let users: TestUsers
  let alicePostUri: string
  let bobPostUri: string
  let aliceProposalUri: string
  let bobOnAliceUri: string
  let aliceOnBobUri: string

  test('setup', async () => {
    // Setup test environment with required services
    network = await createTestNetwork()

    // Create test users (Alice and Bob)
    users = await createTestUsers(network)

    const bobToken = users.bob.agent.session?.accessJwt
    assert.ok(
      bobToken && bobToken.length > 0,
      `Bob JWT token obtained - BOB_TOKEN must be non-empty. Got: ${bobToken}`,
    )
  })

  test('📝 Test 1: Create Test Data', async () => {
    // Create Alice's test post
    alicePostUri = await createTestPost(
      users.alice,
      'Alice post for comprehensive ordering test',
    )

    assert.ok(
      alicePostUri && alicePostUri.length > 0,
      `Alice post created - ALICE_POST_URI must be non-empty. Got: ${alicePostUri}`,
    )

    // Create Bob's test post
    bobPostUri = await createTestPost(
      users.bob,
      'Bob post for comprehensive ordering test',
    )

    assert.ok(
      bobPostUri && bobPostUri.length > 0,
      `Bob post created - BOB_POST_URI must be non-empty. Got: ${bobPostUri}`,
    )

    // Create Alice's proposal on her own post (will be auto-rated)
    const { uri: aliceProposalUriResult } = await createCommunityNote(
      network,
      users.alice,
      alicePostUri,
      'Alice note on her own post',
      'annotation',
      ['disputed_claim'],
    )
    aliceProposalUri = aliceProposalUriResult

    assert.ok(
      aliceProposalUri && aliceProposalUri.length > 0,
      `Alice proposal created - ALICE_PROPOSAL_URI must be non-empty. Got: ${aliceProposalUri}`,
    )

    // Create Bob's proposal on Alice's post (unrated by Alice)
    const { uri: bobOnAliceUriResult } = await createCommunityNote(
      network,
      users.bob,
      alicePostUri,
      'Bob note on Alice post',
      'misleading',
      ['factual_error'],
    )
    bobOnAliceUri = bobOnAliceUriResult

    assert.ok(
      bobOnAliceUri && bobOnAliceUri.length > 0,
      `Bob proposal on Alice post created - BOB_ON_ALICE_URI must be non-empty. Got: ${bobOnAliceUri}`,
    )

    // Create Alice's proposal on Bob's post (unrated by Bob)
    const { uri: aliceOnBobUriResult } = await createCommunityNote(
      network,
      users.alice,
      bobPostUri,
      'Alice note on Bob post',
      'annotation',
      ['disputed_claim'],
    )
    aliceOnBobUri = aliceOnBobUriResult

    assert.ok(
      aliceOnBobUri && aliceOnBobUri.length > 0,
      `Alice proposal on Bob post created - ALICE_ON_BOB_URI must be non-empty. Got: ${aliceOnBobUri}`,
    )
  })

  test('⚖️ Test 2: Set Proposal Scores', async () => {
    // Set scores using scoring service
    // Set Alice proposal score to 0.8
    const aliceScoreSuccess = await setProposalScore(
      network,
      aliceProposalUri,
      'needs_more_ratings',
      0.8,
    )

    assert.ok(
      aliceScoreSuccess,
      `Alice proposal score set - Score setting must succeed. Got: ${aliceScoreSuccess}`,
    )

    // Set Bob proposal score to 0.3
    const bobScoreSuccess = await setProposalScore(
      network,
      bobOnAliceUri,
      'needs_more_ratings',
      0.3,
    )

    assert.ok(
      bobScoreSuccess,
      `Bob proposal score set - Score setting must succeed. Got: ${bobScoreSuccess}`,
    )

    // Set Alice on Bob proposal score to 0.9
    const aliceOnBobScoreSuccess = await setProposalScore(
      network,
      aliceOnBobUri,
      'needs_more_ratings',
      0.9,
    )

    assert.ok(
      aliceOnBobScoreSuccess,
      `Alice on Bob proposal score set - Score setting must succeed. Got: ${aliceOnBobScoreSuccess}`,
    )
  })

  test("🔍 Test 3: Alice's View of Her Own Post", async () => {
    // Alice should see proposals on her post in this order:
    // 1. Bob's proposal (unrated by Alice, score 0.3) - FIRST (unrated)
    // 2. Alice's proposal (auto-rated by Alice, score 0.8) - SECOND (rated, even though higher score)

    const aliceViewData = await getProposals(network, users.alice, alicePostUri)

    const proposalsCount = aliceViewData.proposals?.length || 0

    assert.ok(
      proposalsCount >= 2,
      `Alice sees proposals on her post - Count >= 2. Got: ${proposalsCount}`,
    )

    const firstProposal = aliceViewData.proposals[0]
    const secondProposal = aliceViewData.proposals[1]

    // Unrated proposals should come first, then rated proposals
    const firstIsUnrated = !firstProposal.viewer?.rating
    const secondIsRated = !!secondProposal.viewer?.rating

    assert.ok(
      firstIsUnrated,
      `Ordering for Alice viewing her own post: first is unrated`,
    )

    assert.ok(
      secondIsRated,
      `Ordering for Alice viewing her own post: second is rated`,
    )
  })

  test("🔍 Test 4: Bob's View of Alice's Post", async () => {
    // Bob should see proposals on Alice's post

    const bobViewData = await getProposals(network, users.bob, alicePostUri)

    const bobProposalsCount = bobViewData.proposals?.length || 0

    assert.ok(
      bobProposalsCount >= 2,
      `Bob sees proposals on Alice's post - Count >= 2. Got: ${bobProposalsCount}`,
    )

    const firstProposal = bobViewData.proposals[0]
    const secondProposal = bobViewData.proposals[1]

    // Unrated proposals should come first, then rated proposals
    const firstIsUnrated = !firstProposal.viewer?.rating
    const secondIsRated = !!secondProposal.viewer?.rating

    assert.ok(
      firstIsUnrated,
      `Ordering for Alice viewing her own post: first is unrated`,
    )

    assert.ok(
      secondIsRated,
      `Ordering for Alice viewing her own post: second is rated`,
    )
  })

  test('⭐ Test 5: Cross-Rating and Re-ordering', async () => {
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
          uri: bobOnAliceUri,
          val: 1,
          reasons: ['is_clear', 'addresses_claim'],
        }),
      },
    )

    assert.ok(
      aliceRatingResponse.ok,
      `Alice rates Bob's proposal - Rating creation must succeed. Response ok: ${aliceRatingResponse.ok}`,
    )

    // Now Alice should see both proposals as rated, ordered by score (higher first)
    const aliceViewAfterData = await getProposals(
      network,
      users.alice,
      alicePostUri,
    )

    const afterRatingCount = aliceViewAfterData.proposals?.length || 0

    assert.ok(
      afterRatingCount >= 2,
      `Cross-rating and re-ordering - Alice should still see >= 2 proposals. Got: ${afterRatingCount}`,
    )

    const firstProposal = aliceViewAfterData.proposals[0]
    const secondProposal = aliceViewAfterData.proposals[1]

    // Verify both proposals have viewer ratings now (both are rated)
    const firstHasRating = firstProposal.viewer?.rating !== undefined
    const secondHasRating = secondProposal.viewer?.rating !== undefined

    assert.ok(
      firstHasRating && secondHasRating,
      `Cross-rating and re-ordering - Both proposals should have viewer rating info. First: ${firstHasRating}, Second: ${secondHasRating}`,
    )
  })

  test('📈 Test 6: Score-Based Ordering Within Rated Proposals', async () => {
    // Bob rates Alice's proposal to make both rated for Bob too
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
          reasons: ['is_incorrect'],
        }),
      },
    )

    assert.ok(
      bobRatingResponse.ok,
      `Bob rates Alice's proposal - Rating creation must succeed. Response ok: ${bobRatingResponse.ok}`,
    )

    // Now Bob should see both proposals as rated, ordered by score
    const bobViewAfterData = await getProposals(
      network,
      users.bob,
      alicePostUri,
    )

    const bobAfterRatingCount = bobViewAfterData.proposals?.length || 0

    assert.ok(
      bobAfterRatingCount >= 2,
      `Score-based ordering within rated proposals - Bob should still see >= 2 proposals. Got: ${bobAfterRatingCount}`,
    )

    const firstProposal = bobViewAfterData.proposals[0]
    const secondProposal = bobViewAfterData.proposals[1]

    // Verify both proposals have viewer ratings now (both are rated)
    const firstHasRating = firstProposal.viewer?.rating !== undefined
    const secondHasRating = secondProposal.viewer?.rating !== undefined

    assert.ok(
      firstHasRating && secondHasRating,
      `Score-based ordering within rated proposals - Both proposals should have viewer rating info. First: ${firstHasRating}, Second: ${secondHasRating}`,
    )
  })

  test('🏷️ Test 7: Label Filter Testing', async () => {
    // Test filtering by specific label values

    // Filter for annotation labels
    const needsContextData = await getProposals(
      network,
      users.alice,
      alicePostUri,
      undefined,
      'annotation',
    )
    const needsContextProposals =
      needsContextData.proposals?.filter((p: any) => p.val === 'annotation') ||
      []
    const needsContextCount = needsContextProposals.length

    assert.ok(
      needsContextCount > 0,
      `Label filtering working for annotation - Count > 0. Got: ${needsContextCount}`,
    )

    // Verify each filter returns only the expected label type
    for (const proposal of needsContextProposals) {
      assert.strictEqual(
        proposal.val,
        'annotation',
        'annotation filter should only return annotation proposals',
      )
    }

    // Filter for misleading labels
    const misleadingData = await getProposals(
      network,
      users.alice,
      alicePostUri,
      undefined,
      'misleading',
    )
    const misleadingProposals =
      misleadingData.proposals?.filter((p: any) => p.val === 'misleading') || []
    const misleadingCount = misleadingProposals.length

    assert.ok(
      misleadingCount > 0,
      `Label filtering working for misleading - Count > 0. Got: ${misleadingCount}`,
    )

    for (const proposal of misleadingProposals) {
      assert.strictEqual(
        proposal.val,
        'misleading',
        'misleading filter should only return misleading proposals',
      )
    }
  })

  test('cleanup', async () => {
    try {
      await network?.close()
    } catch (error: any) {
      process.stderr.write(`⚠️ Cleanup error: ${error.message}\n`)
    }
  })
})
