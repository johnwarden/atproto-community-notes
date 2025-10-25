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
} from './test-utils'

describe('Notes API', () => {
  let network: TestNetworkWrapper
  let users: TestUsers
  let testPostUri: string
  let realProposalUri: string

  test('setup', async () => {
    network = await createTestNetwork()
    users = await createTestUsers(network)

    assert.ok(
      network && users,
      'Test environment should be set up successfully',
    )
  })

  test('🔐 Test 1: Invalid Authentication Fails Hard', async () => {
    // Test that invalid bearer tokens are rejected (fail hard)
    const testUri = 'at://did:plc:test/app.bsky.feed.post/test'
    const encodedUri = encodeURIComponent(testUri)

    const invalidAuthResponse = await fetch(
      `${network.notes?.url}/xrpc/org.opencommunitynotes.getProposals?uris=${encodedUri}`,
      {
        headers: {
          Authorization: 'Bearer invalid-token-12345',
        },
      },
    )

    assert.ok(
      !invalidAuthResponse.ok,
      'Invalid authentication should be rejected',
    )
    assert.strictEqual(
      invalidAuthResponse.status,
      401,
      'Invalid auth should return 401',
    )

    const errorData = await invalidAuthResponse.json().catch(() => ({}))
    assert.strictEqual(
      errorData.error,
      'AuthenticationRequired',
      'Error should be AuthenticationRequired',
    )
  })

  test('📝 Test 2: Note Creation', async () => {
    // Create test post using TestNetwork utilities
    testPostUri = await createTestPost(
      users.alice,
      `Test post for note creation ${Date.now()}`,
    )

    // Create community note using TestNetwork utilities
    const { uri } = await createCommunityNote(
      network,
      users.alice,
      testPostUri,
      'Test note creation',
      'annotation',
      ['factual_error'],
    )
    realProposalUri = uri

    assert.ok(
      realProposalUri && realProposalUri !== 'null',
      `Note created successfully - REAL_PROPOSAL_URI must be non-empty and not "null". Got: ${realProposalUri}`,
    )
  })

  test('🤖 Test 2.5: Auto-Rating Verification', async () => {
    // Retrieve the proposal to check if auto-rating was created (using utility function)
    const autoRatingData = await getProposals(network, users.alice, testPostUri)

    if (autoRatingData.proposals && autoRatingData.proposals.length > 0) {
      const proposal = autoRatingData.proposals[0]

      const hasAutoRating =
        proposal.viewer?.rating && typeof proposal.viewer.rating === 'object'
      assert.ok(
        hasAutoRating,
        `Auto-rating created - proposals[0].viewer.rating type must be "object". Got type: ${typeof proposal.viewer?.rating}`,
      )

      assert.strictEqual(
        proposal.viewer.rating.val,
        1,
        `Auto-rating is helpful (val=1) - Rating val must be 1. Got: ${proposal.viewer.rating.val}`,
      )

      const reasonsCount = proposal.viewer.rating.reasons?.length || 0
      assert.strictEqual(
        reasonsCount,
        5,
        `Auto-rating has 5 standard reasons - Reasons count must be 5. Got: ${reasonsCount}`,
      )
    }

    // Test duplicate prevention
    const duplicateResponse = await fetch(
      `${network.notes?.url}/xrpc/org.opencommunitynotes.propose`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${users.alice.agent.session?.accessJwt}`,
        },
        body: JSON.stringify({
          typ: 'label',
          uri: testPostUri,
          val: 'annotation',
          note: 'Duplicate note attempt',
          reasons: ['disputed_claim'],
        }),
      },
    )

    assert.ok(!duplicateResponse.ok, 'Duplicate proposal should be rejected')
    const duplicateData = await duplicateResponse.json().catch(() => ({}))
    assert.strictEqual(
      duplicateData.error,
      'DuplicateProposal',
      `Duplicate prevention working - Error must be "DuplicateProposal". Got: ${duplicateData.error}`,
    )
  })

  test('🏷️ Test 2.6: Multiple Labels Per User Per Post', async () => {
    // Create a second proposal with a different label - this should succeed
    const differentLabelResponse = await fetch(
      `${network.notes?.url}/xrpc/org.opencommunitynotes.propose`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${users.alice.agent.session?.accessJwt}`,
        },
        body: JSON.stringify({
          typ: 'label',
          uri: testPostUri,
          val: 'misleading',
          note: 'This post is misleading - different label',
          reasons: ['disputed_claim'],
        }),
      },
    )

    assert.ok(
      differentLabelResponse.ok,
      'Different label proposal should be created successfully',
    )
    const differentLabelData = await differentLabelResponse.json()
    const differentLabelUri = differentLabelData.uri
    const differentLabelError = differentLabelData.error

    assert.ok(
      differentLabelUri && differentLabelUri !== 'null' && !differentLabelError,
      `Different label proposal created successfully - URI must be non-empty, not null, no error. URI: ${differentLabelUri}, Error: ${differentLabelError}`,
    )

    // Verify both proposals exist for the same post (using utility function)
    const multipleProposalsData = await getProposals(
      network,
      users.alice,
      testPostUri,
    )
    const proposalCount = multipleProposalsData.proposals.length
    assert.strictEqual(
      proposalCount,
      2,
      `Post now has 2 proposals with different labels - Count must be 2. Got: ${proposalCount}`,
    )

    const firstLabel = multipleProposalsData.proposals[0]?.val
    const secondLabel = multipleProposalsData.proposals[1]?.val
    assert.ok(
      firstLabel !== secondLabel,
      `Proposals have different labels - First and second labels must be different. Got: ${firstLabel}, ${secondLabel}`,
    )

    // Test that duplicate with second label is also prevented
    const duplicateMisleadingResponse = await fetch(
      `${network.notes?.url}/xrpc/org.opencommunitynotes.propose`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${users.alice.agent.session?.accessJwt}`,
        },
        body: JSON.stringify({
          typ: 'label',
          uri: testPostUri,
          val: 'misleading',
          note: 'Another misleading attempt',
          reasons: ['disputed_claim'],
        }),
      },
    )

    assert.ok(
      !duplicateMisleadingResponse.ok,
      'Duplicate misleading label should be prevented',
    )
    const duplicateMisleadingData = await duplicateMisleadingResponse
      .json()
      .catch(() => ({}))
    assert.strictEqual(
      duplicateMisleadingData.error,
      'DuplicateProposal',
      `Duplicate 'misleading' label also prevented - Error must be "DuplicateProposal". Got: ${duplicateMisleadingData.error}`,
    )
  })

  test('⭐ Test 3: Note Rating System', async () => {
    // Create rating on real proposal
    const ratingResponse = await fetch(
      `${network.notes?.url}/xrpc/org.opencommunitynotes.vote`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${users.alice.agent.session?.accessJwt}`,
        },
        body: JSON.stringify({
          uri: realProposalUri,
          val: 1,
          reasons: ['helpful'],
        }),
      },
    )

    assert.ok(
      ratingResponse.ok,
      `Rating created - RATING_URI must be non-empty. Response ok: ${ratingResponse.ok}`,
    )

    // Verify rating structure by retrieving proposals for the test post (using utility function)
    const viewerData = await getProposals(network, users.alice, testPostUri)

    if (viewerData.proposals && viewerData.proposals.length > 0) {
      const proposal = viewerData.proposals[0]

      const hasRatingObject =
        proposal.viewer?.rating && typeof proposal.viewer.rating === 'object'
      const ratingVal = proposal.viewer?.rating?.val
      const hasCreatedAt = proposal.viewer?.rating?.createdAt
      const hasUpdatedAt = proposal.viewer?.rating?.updatedAt

      assert.ok(
        hasRatingObject && ratingVal === 1 && hasCreatedAt && hasUpdatedAt,
        `Rating structure valid - Must have object type, val=1, and timestamps. Object: ${hasRatingObject}, Val: ${ratingVal}, CreatedAt: ${!!hasCreatedAt}, UpdatedAt: ${!!hasUpdatedAt}`,
      )
    }

    // Test rating deletion
    const deleteResponse = await fetch(
      `${network.notes?.url}/xrpc/org.opencommunitynotes.vote`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${users.alice.agent.session?.accessJwt}`,
        },
        body: JSON.stringify({
          uri: realProposalUri,
          delete: true,
        }),
      },
    )

    assert.ok(deleteResponse.ok, 'Rating deletion should succeed')
    const deleteData = await deleteResponse.json()
    assert.strictEqual(
      deleteData.success,
      true,
      `Rating deleted - Response success must be true. Got: ${deleteData.success}`,
    )
  })

  test('📋 Test 4: Data Retrieval', async () => {
    // Test data retrieval using real database data (using utility function)
    const notesData = await getProposals(network, users.alice, testPostUri)

    const getNotesError = notesData.error
    assert.ok(
      !getNotesError || getNotesError === null,
      `Proposals retrieved successfully - Error must be "null". Got: ${getNotesError}`,
    )

    assert.ok(notesData.proposals?.length || 0 > 0, 'Got proposals')
  })

  test('📋 Test 5: Input Validation', async () => {
    // Test input validation with invalid data
    const invalidResponse = await fetch(
      `${network.notes?.url}/xrpc/org.opencommunitynotes.propose`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${users.alice.agent.session?.accessJwt}`,
        },
        body: JSON.stringify({
          typ: 'invalid_type',
          uri: 'at://fake.uri/invalid',
          val: 'annotation',
          note: '',
        }),
      },
    )

    assert.ok(!invalidResponse.ok, 'Invalid input should be rejected')
    const invalidData = await invalidResponse.json().catch(() => ({}))
    assert.strictEqual(
      invalidData.error,
      'InvalidTarget',
      `Input validation working - Error must be "InvalidTarget". Got: ${invalidData.error}`,
    )
  })

  test('📏 Test 5.1: Note Length Validation', async () => {
    // Test that note length validation is enforced (over limit should fail)
    // Use HTTP URI to avoid duplicate proposal conflicts
    const lengthTestUri = `https://example.com/length-test-${Date.now()}`
    const overLimitText = 'a'.repeat(279) + ' https://example.com' // 281 chars: exceeds 280 limit
    const overLimitResponse = await fetch(
      `${network.notes?.url}/xrpc/org.opencommunitynotes.propose`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${users.alice.agent.session?.accessJwt}`,
        },
        body: JSON.stringify({
          typ: 'label',
          uri: lengthTestUri,
          val: 'annotation',
          note: overLimitText,
        }),
      },
    )

    assert.ok(!overLimitResponse.ok, 'Note over 280 character limit should be rejected')
    
    const overLimitData = await overLimitResponse.json().catch(() => ({}))
    assert.strictEqual(
      overLimitData.error,
      'InvalidTarget',
      `Over-limit note rejected - Error must be "InvalidTarget". Got: ${overLimitData.error}`,
    )
    
    assert.ok(
      overLimitData.message?.includes('280 characters'),
      `Error message should mention 280 character limit. Got: ${overLimitData.message}`,
    )
    
    assert.ok(
      overLimitData.message?.includes('counting URLs as 1 character'),
      `Error message should mention URL counting. Got: ${overLimitData.message}`,
    )
  })

  test('🌐 Test 6: HTTP URI Support', async () => {
    // Test non-AT Protocol URI support
    const httpUri = `https://example.com/test-${Date.now()}`
    const httpNoteResponse = await fetch(
      `${network.notes?.url}/xrpc/org.opencommunitynotes.propose`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${users.alice.agent.session?.accessJwt}`,
        },
        body: JSON.stringify({
          typ: 'label',
          uri: httpUri,
          val: 'annotation',
          note: 'Test HTTP URI support',
          reasons: ['factual_error'],
        }),
      },
    )

    assert.ok(httpNoteResponse.ok, 'HTTP URI proposals should be supported')
    const httpNoteData = await httpNoteResponse.json()
    const httpNoteUri = httpNoteData.uri
    assert.ok(
      httpNoteUri && httpNoteUri !== 'null',
      `HTTP URI supported - HTTP_NOTE_URI must be non-empty and not "null". Got: ${httpNoteUri}`,
    )

    // Try to rate the HTTP URI proposal
    const httpRatingResponse = await fetch(
      `${network.notes?.url}/xrpc/org.opencommunitynotes.vote`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${users.alice.agent.session?.accessJwt}`,
        },
        body: JSON.stringify({
          uri: httpNoteData.uri,
          val: 1,
          reasons: ['helpful'],
        }),
      },
    )

    assert.ok(
      httpRatingResponse.ok,
      `Rating created - HTTP_RATING_URI must be non-empty. Response ok: ${httpRatingResponse.ok}`,
    )
  })

  test('🔍 Test 7: Status Filtering', async () => {
    // Create a fresh test post for status filtering using TestNetwork utilities
    const statusTestPostUri = await createTestPost(
      users.alice,
      `Status filtering test post ${Date.now()}`,
    )

    // Create a proposal for status testing (without rating it)
    const statusCreateResponse = await fetch(
      `${network.notes?.url}/xrpc/org.opencommunitynotes.propose`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${users.alice.agent.session?.accessJwt}`,
        },
        body: JSON.stringify({
          typ: 'label',
          uri: statusTestPostUri,
          val: 'annotation',
          note: 'Status filtering test note',
          reasons: ['factual_error'],
        }),
      },
    )

    assert.ok(
      statusCreateResponse.ok,
      'Status filtering test proposal should be created successfully',
    )

    // Wait for proposal initialization
    await new Promise((resolve) => setTimeout(resolve, 1000))

    // Test filtering by needs_more_ratings (default status for new proposals) - using utility function
    const needsMoreData = await getProposals(
      network,
      users.alice,
      statusTestPostUri,
      'needs_more_ratings',
    )
    const needsMoreCount = needsMoreData.proposals?.length || 0
    const needsMoreStatus = needsMoreData.proposals?.[0]?.status

    assert.ok(
      needsMoreCount > 0 && needsMoreStatus === 'needs_more_ratings',
      `Status filter: needs_more_ratings - Count > 0 AND status = "needs_more_ratings". Count: ${needsMoreCount}, Status: ${needsMoreStatus}`,
    )

    // Test filtering by rated_helpful (should return 0 results for unrated proposal) - using utility function
    const ratedHelpfulData = await getProposals(
      network,
      users.alice,
      statusTestPostUri,
      'rated_helpful',
    )
    const ratedHelpfulCount = ratedHelpfulData.proposals?.length || 0
    assert.strictEqual(
      ratedHelpfulCount,
      0,
      `Status filter: rated_helpful (empty) - Count must be 0. Got: ${ratedHelpfulCount}`,
    )

    // Test filtering by rated_not_helpful (should return 0 results for unrated proposal) - using utility function
    const ratedNotHelpfulData = await getProposals(
      network,
      users.alice,
      statusTestPostUri,
      'rated_not_helpful',
    )
    const ratedNotHelpfulCount = ratedNotHelpfulData.proposals?.length || 0
    assert.strictEqual(
      ratedNotHelpfulCount,
      0,
      `Status filter: rated_not_helpful (empty) - Count must be 0. Got: ${ratedNotHelpfulCount}`,
    )

    // Test with no status filter (should return all proposals) - using utility function
    const noFilterData = await getProposals(
      network,
      users.alice,
      statusTestPostUri,
    )
    const noFilterCount = noFilterData.proposals?.length || 0
    assert.ok(
      noFilterCount > 0,
      `No status filter (all proposals) - Count > 0. Got: ${noFilterCount}`,
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
