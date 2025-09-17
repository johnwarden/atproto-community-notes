import assert from 'node:assert'
import { describe, test } from 'node:test'
import { TestNetworkWrapper } from '../src/dev-env/test-network-wrapper'
import {
  TestUsers,
  createTestNetwork,
  createTestUsers,
  setProposalScore,
} from './test-utils'

describe('Score API', () => {
  let network: TestNetworkWrapper
  let users: TestUsers
  let testPostUri: string
  let proposalUri: string
  let testPostUri2: string
  let proposalUri2: string

  test('setup', async () => {
    // Setup test environment with all required services (notes, bsky, scoring for labeler integration)
    network = await createTestNetwork()

    // Create test users (Alice only for this test)
    users = await createTestUsers(network)
  })

  test('📝 Test 1: Create Test Post and Community Note', async () => {
    // Create test post
    const postResponse = await fetch(
      `${network.pds.url}/xrpc/com.atproto.repo.createRecord`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${users.alice.agent.session?.accessJwt}`,
        },
        body: JSON.stringify({
          repo: 'alice.test',
          collection: 'app.bsky.feed.post',
          record: {
            text: 'This is a test post for end-to-end labeler testing',
            createdAt: new Date().toISOString(),
          },
        }),
      },
    )

    assert.ok(postResponse.ok, 'Should be able to create test post')
    const postData = await postResponse.json()
    testPostUri = postData.uri
    // Create community note
    const noteResponse = await fetch(
      `${network.notes?.url}/xrpc/org.opencommunitynotes.createProposal`,
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
          note: 'This post needs additional context for end-to-end testing',
          reasons: ['disputed_claim'],
        }),
      },
    )

    assert.ok(noteResponse.ok, 'Should be able to create community note')
    const noteData = await noteResponse.json()
    proposalUri = noteData.uri
  })

  test('🧮 Test 2: Mock Algorithm - Rated Helpful Flow', async () => {
    // First simulate algorithm detecting new proposal
    const initialScoreSuccess = await setProposalScore(
      network,
      proposalUri,
      'needs_more_ratings',
      0.0,
    )

    assert.ok(
      initialScoreSuccess,
      `Initial score set - Score setting must succeed. Got: ${initialScoreSuccess}`,
    )

    // Then simulate final algorithm scoring
    const finalScoreSuccess = await setProposalScore(
      network,
      proposalUri,
      'rated_helpful',
      0.85,
    )

    assert.ok(
      finalScoreSuccess,
      `Score set via API (rated_helpful: 0.85) - Score setting must succeed. Got: ${finalScoreSuccess}`,
    )
  })

  test('🔍 Test 3: Verify Status via API', async () => {
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

    assert.ok(
      proposalsData.proposals && proposalsData.proposals.length > 0,
      'Should have proposals',
    )
    const proposal = proposalsData.proposals[0]

    assert.strictEqual(
      proposal.status,
      'rated_helpful',
      'Proposal status should be rated_helpful',
    )
  })

  // TODO: Re-enable once TestLabeler implements queryLabels API
  // test('🏷️ Test 4: Verify Labels via Query API', async () => {
  //   // Query labels with wildcard pattern
  //   const response = await fetch(
  //     `${network.labeler?.url}/xrpc/com.atproto.label.queryLabels?uriPatterns=at%3A%2F%2F*`,
  //     {
  //       headers: {
  //         Authorization: `Bearer ${users.alice.agent.session?.accessJwt}`,
  //       },
  //     },
  //   )

  //   assert.ok(response.ok, 'queryLabels endpoint should work')
  //   const data = await response.json()

  //   assert.ok(
  //     data.labels && Array.isArray(data.labels),
  //     'queryLabels should return labels array',
  //   )
  //   const hasNeedsContext = data.labels.some(
  //     (label: any) => label.val === 'annotation',
  //   )

  //   assert.ok(
  //     data.labels.length > 0 && hasNeedsContext,
  //     'queryLabels should return labels including annotation',
  //   )
  // })

  // TODO: Re-enable once TestLabeler implements queryLabels API
  // test('🏷️ Test 5: Verify Labels via queryLabels API', async () => {
  //   // Query labels for the specific test post
  //   const encodedUri = encodeURIComponent(testPostUri)
  //   const response = await fetch(
  //     `${network.labeler?.url}/xrpc/com.atproto.label.queryLabels?uriPatterns=${encodedUri}`,
  //     {
  //       headers: {
  //         Authorization: `Bearer ${users.alice.agent.session?.accessJwt}`,
  //       },
  //     },
  //   )

  //   assert.ok(response.ok, 'queryLabels for specific URI should work')
  //   const data = await response.json()

  //   const helpfulLabels =
  //     data.labels?.filter(
  //       (label: any) => label.val === 'annotation' && label.neg !== true,
  //     ) || []

  //   assert.ok(
  //     helpfulLabels.length > 0,
  //     'queryLabels should return labels for helpful post',
  //     )
  // })

  test('🧮 Test 6: Mock Algorithm - Rated Not Helpful Flow', async () => {
    // Create another test post and proposal for negative label testing
    const postResponse2 = await fetch(
      `${network.pds.url}/xrpc/com.atproto.repo.createRecord`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${users.alice.agent.session?.accessJwt}`,
        },
        body: JSON.stringify({
          repo: 'alice.test',
          collection: 'app.bsky.feed.post',
          record: {
            text: 'Second test post for negative label testing',
            createdAt: new Date().toISOString(),
          },
        }),
      },
    )

    assert.ok(postResponse2.ok, 'Should be able to create second test post')
    const postData2 = await postResponse2.json()
    testPostUri2 = postData2.uri

    const noteResponse2 = await fetch(
      `${network.notes?.url}/xrpc/org.opencommunitynotes.createProposal`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${users.alice.agent.session?.accessJwt}`,
        },
        body: JSON.stringify({
          typ: 'label',
          uri: testPostUri2,
          val: 'annotation',
          note: 'Second test note for negative label testing',
          reasons: ['disputed_claim'],
        }),
      },
    )

    assert.ok(
      noteResponse2.ok,
      'Should be able to create second community note',
    )
    const noteData2 = await noteResponse2.json()
    proposalUri2 = noteData2.uri

    // Test the negative label transition sequence
    // First set as needs_more_ratings
    const needsMoreSuccess = await setProposalScore(
      network,
      proposalUri2,
      'needs_more_ratings',
      0.0,
    )
    assert.ok(
      needsMoreSuccess,
      'needs_more_ratings score should be set successfully',
    )

    // Then set as rated_helpful first (to test the negative label transition)
    const helpfulSuccess = await setProposalScore(
      network,
      proposalUri2,
      'rated_helpful',
      0.6,
    )
    assert.ok(helpfulSuccess, 'rated_helpful score should be set successfully')

    // Finally change to rated_not_helpful to create negative label
    const notHelpfulSuccess = await setProposalScore(
      network,
      proposalUri2,
      'rated_not_helpful',
      -0.3,
    )
    assert.ok(
      notHelpfulSuccess,
      'rated_not_helpful score should be set successfully',
    )
  })

  test('🔍 Test 7: Verify Negative Label Status via API', async () => {
    const encodedUri2 = encodeURIComponent(testPostUri2)
    const proposalsResponse2 = await fetch(
      `${network.notes?.url}/xrpc/org.opencommunitynotes.getProposals?uris=${encodedUri2}`,
      {
        headers: {
          Authorization: `Bearer ${users.alice.agent.session?.accessJwt}`,
        },
      },
    )

    assert.ok(
      proposalsResponse2.ok,
      'Should be able to get proposals for second post',
    )
    const proposalsData2 = await proposalsResponse2.json()

    assert.ok(
      proposalsData2.proposals && proposalsData2.proposals.length > 0,
      'Should have proposals for second post',
    )
    const proposal2 = proposalsData2.proposals[0]

    assert.strictEqual(
      proposal2.status,
      'rated_not_helpful',
      'Second proposal status should be rated_not_helpful',
    )
  })

  // TODO: Re-enable once TestLabeler implements queryLabels API
  // test('🔍 Test 8: Verify Negative Labels via queryLabels API', async () => {
  //   // Query labels for the second test post (should have negative label)
  //   const encodedUri2 = encodeURIComponent(testPostUri2)
  //   const response = await fetch(
  //     `${network.labeler?.url}/xrpc/com.atproto.label.queryLabels?uriPatterns=${encodedUri2}`,
  //     {
  //       headers: {
  //         Authorization: `Bearer ${users.alice.agent.session?.accessJwt}`,
  //       },
  //     },
  //   )

  //   assert.ok(response.ok, 'queryLabels for negative labels should work')
  //   const data = await response.json()

  //   const negativeLabels =
  //     data.labels?.filter(
  //       (label: any) => label.val === 'annotation' && label.neg === true,
  //     ) || []

  //   assert.ok(
  //     negativeLabels.length > 0,
  //     'queryLabels should return negative labels for not-helpful post',
  //   )
  // })

  test('🔍 Test 9: Status Filtering via API', async () => {
    // Test status filter: rated_helpful
    const encodedUri = encodeURIComponent(testPostUri)
    const helpfulResponse = await fetch(
      `${network.notes?.url}/xrpc/org.opencommunitynotes.getProposals?uris=${encodedUri}&status=rated_helpful`,
      {
        headers: {
          Authorization: `Bearer ${users.alice.agent.session?.accessJwt}`,
        },
      },
    )

    assert.ok(
      helpfulResponse.ok,
      'Status filter: rated_helpful request should succeed',
    )
    const helpfulData = await helpfulResponse.json()
    const helpfulCount = helpfulData.proposals?.length || 0
    assert.ok(
      helpfulCount > 0,
      'Status filter: rated_helpful should return > 0 results',
    )

    // Test status filter: rated_not_helpful
    if (testPostUri2) {
      const encodedUri2 = encodeURIComponent(testPostUri2)
      const notHelpfulResponse = await fetch(
        `${network.notes?.url}/xrpc/org.opencommunitynotes.getProposals?uris=${encodedUri2}&status=rated_not_helpful`,
        {
          headers: {
            Authorization: `Bearer ${users.alice.agent.session?.accessJwt}`,
          },
        },
      )

      assert.ok(
        notHelpfulResponse.ok,
        'Status filter: rated_not_helpful request should succeed',
      )
      const notHelpfulData = await notHelpfulResponse.json()
      const notHelpfulCount = notHelpfulData.proposals?.length || 0
      assert.ok(
        notHelpfulCount > 0,
        'Status filter: rated_not_helpful should return > 0 results',
      )
    }

    // Test status filter: needs_more_ratings (should return empty for our test posts)
    const needsMoreResponse = await fetch(
      `${network.notes?.url}/xrpc/org.opencommunitynotes.getProposals?uris=${encodedUri}&status=needs_more_ratings`,
      {
        headers: {
          Authorization: `Bearer ${users.alice.agent.session?.accessJwt}`,
        },
      },
    )

    assert.ok(
      needsMoreResponse.ok,
      'Status filter: needs_more_ratings request should succeed',
    )
    const needsMoreData = await needsMoreResponse.json()
    const needsMoreCount = needsMoreData.proposals?.length || 0
    assert.strictEqual(
      needsMoreCount,
      0,
      'Status filter: needs_more_ratings should return 0 results for rated posts',
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
