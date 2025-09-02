import assert from 'node:assert'
import { describe, test } from 'node:test'
import { TestNetworkWrapper } from '../src/dev-env/test-network-wrapper'
import {
  TestUsers,
  createCommunityNote,
  createTestNetwork,
  createTestPost,
  createTestUsers,
} from './test-utils'

describe('Vote Deletion', () => {
  let network: TestNetworkWrapper
  let users: TestUsers
  let testPostUri: string
  let proposalUri: string

  test('setup', async () => {
    // Setup test environment with notes service only using standard helper
    network = await createTestNetwork()

    // Create test users (Alice only for this test)
    users = await createTestUsers(network)
  })

  test('📝 Setting up test data', async () => {
    // Create test post
    testPostUri = await createTestPost(
      users.alice,
      'Test post for vote deletion testing',
    )

    assert.ok(
      testPostUri && testPostUri.length > 0,
      `Test post created - TEST_POST_URI must be non-empty. Got: ${testPostUri}`,
    )

    // Create community note
    const { uri } = await createCommunityNote(
      network,
      users.alice,
      testPostUri,
      'This post needs additional context for vote deletion testing',
      'needs-context',
      ['disputed_claim'],
    )
    proposalUri = uri

    assert.ok(
      proposalUri && proposalUri.length > 0,
      `Community note created - PROPOSAL_URI must be non-empty. Got: ${proposalUri}`,
    )
  })

  test('🗑️  Testing auto-rating deletion', async () => {
    // SETUP VERIFICATION: Verify auto-rating exists
    const encodedUri = encodeURIComponent(testPostUri)
    const proposalsResponse = await fetch(
      `${network.notes?.url}/xrpc/org.opencommunitynotes.getProposals?uris=${encodedUri}`,
      {
        headers: {
          Authorization: `Bearer ${users.alice.agent.session?.accessJwt}`,
        },
      },
    )

    assert.ok(proposalsResponse.ok, 'Should be able to get proposals')
    const proposalsData = await proposalsResponse.json()

    assert.ok(proposalsData.proposals.length > 0, 'Should have proposals')
    const proposal = proposalsData.proposals[0]

    const viewerRatingVal = proposal.viewer?.rating?.val
    assert.strictEqual(
      viewerRatingVal,
      1,
      `Auto-rating exists - proposals[0].viewer.rating.val must be "1". Got: ${viewerRatingVal}`,
    )

    // DELETION REQUEST: Delete auto-rating
    const deleteResponse = await fetch(
      `${network.notes?.url}/xrpc/org.opencommunitynotes.rateProposal`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${users.alice.agent.session?.accessJwt}`,
        },
        body: JSON.stringify({
          uri: proposalUri,
          delete: true,
        }),
      },
    )

    assert.ok(deleteResponse.ok, 'Auto-rating deletion should succeed')
    const deleteData = await deleteResponse.json()

    const deleteSuccess = deleteData.success
    const deleteDeleted = deleteData.deleted
    assert.ok(
      deleteSuccess && deleteDeleted,
      `Auto-rating deletion succeeded - Both success and deleted must be true. Success: ${deleteSuccess}, Deleted: ${deleteDeleted}`,
    )

    // VERIFICATION AFTER DELETION: Verify auto-rating is gone
    const proposalsAfterResponse = await fetch(
      `${network.notes?.url}/xrpc/org.opencommunitynotes.getProposals?uris=${encodedUri}`,
      {
        headers: {
          Authorization: `Bearer ${users.alice.agent.session?.accessJwt}`,
        },
      },
    )

    assert.ok(
      proposalsAfterResponse.ok,
      'Should be able to get proposals after deletion',
    )
    const proposalsAfterData = await proposalsAfterResponse.json()

    const proposalAfter = proposalsAfterData.proposals[0]
    const viewerRatingAfter = proposalAfter.viewer?.rating?.val

    assert.ok(
      !proposalAfter.viewer?.rating || viewerRatingAfter === null,
      `Auto-rating deleted - proposals[0].viewer.rating.val must be "null". Got: ${viewerRatingAfter}`,
    )
  })

  test('⭐ Testing manual rating deletion', async () => {
    // MANUAL RATING CREATION: Create manual rating
    const manualRatingResponse = await fetch(
      `${network.notes?.url}/xrpc/org.opencommunitynotes.rateProposal`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${users.alice.agent.session?.accessJwt}`,
        },
        body: JSON.stringify({
          uri: proposalUri,
          val: -1,
          reasons: ['is_incorrect', 'sources_missing_or_unreliable'],
        }),
      },
    )

    assert.ok(
      manualRatingResponse.ok,
      `Manual rating created - MANUAL_RATING_URI must be non-empty. Response ok: ${manualRatingResponse.ok}`,
    )

    // VERIFICATION OF MANUAL RATING: Verify manual rating exists
    const encodedUri = encodeURIComponent(testPostUri)
    const proposalsManualResponse = await fetch(
      `${network.notes?.url}/xrpc/org.opencommunitynotes.getProposals?uris=${encodedUri}`,
      {
        headers: {
          Authorization: `Bearer ${users.alice.agent.session?.accessJwt}`,
        },
      },
    )

    assert.ok(proposalsManualResponse.ok, 'Should be able to get proposals')
    const proposalsManualData = await proposalsManualResponse.json()

    const proposalManual = proposalsManualData.proposals[0]
    const manualRatingVal = proposalManual.viewer?.rating?.val

    assert.strictEqual(
      manualRatingVal,
      -1,
      `Manual rating exists - proposals[0].viewer.rating.val must be "-1". Got: ${manualRatingVal}`,
    )

    // MANUAL RATING DELETION: Delete manual rating
    const deleteManualResponse = await fetch(
      `${network.notes?.url}/xrpc/org.opencommunitynotes.rateProposal`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${users.alice.agent.session?.accessJwt}`,
        },
        body: JSON.stringify({
          uri: proposalUri,
          delete: true,
        }),
      },
    )

    assert.ok(deleteManualResponse.ok, 'Manual rating deletion should succeed')
    const deleteManualData = await deleteManualResponse.json()

    const manualDeleteSuccess = deleteManualData.success
    const manualDeleteDeleted = deleteManualData.deleted
    assert.ok(
      manualDeleteSuccess && manualDeleteDeleted,
      `Manual rating deletion succeeded - Both success and deleted must be true. Success: ${manualDeleteSuccess}, Deleted: ${manualDeleteDeleted}`,
    )

    // VERIFICATION AFTER MANUAL DELETION: Verify manual rating is gone
    const proposalsFinalResponse = await fetch(
      `${network.notes?.url}/xrpc/org.opencommunitynotes.getProposals?uris=${encodedUri}`,
      {
        headers: {
          Authorization: `Bearer ${users.alice.agent.session?.accessJwt}`,
        },
      },
    )

    assert.ok(
      proposalsFinalResponse.ok,
      'Should be able to get proposals after manual deletion',
    )
    const proposalsFinalData = await proposalsFinalResponse.json()

    const proposalFinal = proposalsFinalData.proposals[0]
    const finalRatingVal = proposalFinal.viewer?.rating?.val

    assert.ok(
      !proposalFinal.viewer?.rating || finalRatingVal === null,
      `Manual rating deleted - proposals[0].viewer.rating.val must be "null". Got: ${finalRatingVal}`,
    )
  })

  test('🚫 Testing error handling', async () => {
    // NON-EXISTENT RATING DELETION: Try to delete non-existent rating
    const deleteNonexistentResponse = await fetch(
      `${network.notes?.url}/xrpc/org.opencommunitynotes.rateProposal`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${users.alice.agent.session?.accessJwt}`,
        },
        body: JSON.stringify({
          uri: proposalUri,
          delete: true,
        }),
      },
    )

    const errorData = await deleteNonexistentResponse
      .json()
      .catch(() => ({ error: 'unknown' }))
    assert.strictEqual(
      errorData.error,
      'ProposalNotFound',
      `Non-existent rating deletion returns error - Error must be "ProposalNotFound". Got: ${errorData.error}`,
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
