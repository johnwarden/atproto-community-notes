import assert from 'node:assert'
import { describe, test } from 'node:test'
import { TestNetworkWrapper } from '../src/dev-env/test-network-wrapper'
import {
  TestUsers,
  createTestNetwork,
  createTestScoredProposals,
  createTestUsers,
  getProposals,
  resetBskySchema,
  setProposalScore,
} from './test-utils'

describe('Label Hydration', () => {
  let network: TestNetworkWrapper
  let users: TestUsers
  let testPostUri: string
  let proposalUri: string
  let labelerDid: string | undefined

  // Test data from helper function
  let alicePostUri: string
  let aliceProposalUri: string

  test('setup', async () => {
    // Create TestNetwork with clean schema reset
    network = await createTestNetwork(true)

    // Create test users
    users = await createTestUsers(network)

    // Get labeler DID from network
    labelerDid = network.notes?.labelerDid

    const testData = await createTestScoredProposals(network, users)
    alicePostUri = testData.alicePostUri
    aliceProposalUri = testData.aliceProposalUri

    process.stderr.write(`Alice post: ${testData.alicePostUri}`)
    process.stderr.write(`Alice proposal: ${testData.aliceProposalUri}`)

    // Also create the original test data for backward compatibility
    testPostUri = alicePostUri
    proposalUri = aliceProposalUri

    process.stderr.write(`Post urls: $alicePostUri, $aliceProposalUri\n`)

    assert.ok(
      testPostUri && proposalUri,
      `Test post and scored proposal created - Both URIs must be non-empty. Post: ${testPostUri}, Proposal: ${proposalUri}`,
    )
  })

  test('🏷️  Test 1: Default Labelers (No Header)', async () => {
    // Wait for labels to be available (retry mechanism for timing issues)
    let communityNotesLabels: any[] = []
    let lastError: string | undefined

    // Force Bsky to sync from PDS
    try {
      await network.bsky.sub.processAll()
    } catch (error) {
      process.stderr.write(`⚠️ Error during Bsky sync: ${error.message}`)
    }

    const maxAttempts = 5
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const encodedUri = encodeURIComponent(testPostUri)

        process.stderr.write(`encodedUri: ${encodedUri}, ${testPostUri}\n`)

        const response = await fetch(
          `${network.bsky.url}/xrpc/app.bsky.feed.getPosts?uris=${encodedUri}`,
        )

        if (response.ok) {
          const responseContent = await response.json()

          process.stderr.write(
            `Response from getPosts: ${JSON.stringify(responseContent)}\n`,
          )

          assert.ok(
            !responseContent.error,
            `Default request should not have error, got: ${responseContent.error}`,
          )

          if (responseContent.posts && responseContent.posts.length > 0) {
            const defaultLabels = responseContent.posts[0].labels || []
            communityNotesLabels = defaultLabels.filter(
              (label: any) => label.src === labelerDid,
            )

            const labels = responseContent.posts[0].labels || []
            communityNotesLabels = labels.filter(
              (label: any) => label.src === labelerDid,
            )

            break
          } else {
            process.stderr.write(
              `⚠️ [DEBUG] No posts found in response. Attempt ${attempt}\n`,
            )
          }
        } else {
          const errorText = await response.text()
          lastError = `Request failed: ${response.status} - ${errorText}`
          process.stderr.write(`❌ [DEBUG] ${lastError}\n`)

          try {
            const errorData = JSON.parse(errorText)
            if (errorData.error) {
              throw new Error(
                `Default request failed with error: ${errorData.error}`,
              )
            }
          } catch (parseError) {
            throw new Error(lastError)
          }
        }
      } catch (error: any) {
        lastError = `Fetch failed: ${error.message}`
        throw error // Fail immediately on fetch errors
      }

      if (attempt < maxAttempts) {
        process.stderr.write(`⏳ [DEBUG] Waiting before retry\n`)
        await new Promise((resolve) => setTimeout(resolve, 100)) // Use 0.1s delay like shell script
      }
    }

    assert.ok(
      communityNotesLabels.length === 0,
      `Community Notes labels should NOT be included without atproto-accept-labelers header. Last error: ${lastError}`,
    )
  })

  test('🏷️  Test 2: With atproto-accept-labelers Header', async () => {
    const encodedUri = encodeURIComponent(testPostUri)

    let communityNotesLabels: any[] = []

    try {
      await network.bsky.sub.processAll()
    } catch (error) {
      process.stderr.write(`⚠️ Error during Bsky sync: ${error.message}`)
    }

    // Force Bsky to sync from PDS
    try {
      await network.bsky.sub.processAll()
    } catch (error) {
      process.stderr.write(`⚠️ Error during Bsky sync: ${error.message}`)
    }

    const maxAttempts = 5
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const response = await fetch(
        `${network.bsky.url}/xrpc/app.bsky.feed.getPosts?uris=${encodedUri}`,
        {
          headers: {
            'atproto-accept-labelers': labelerDid || '',
          },
        },
      )

      assert.ok(
        response.ok,
        `Request with atproto-accept-labelers should succeed: ${response.status}`,
      )

      let data: any
      try {
        data = await response.json()
      } catch (error: any) {
        process.stderr.write(`🚨 JSON PARSE FAILED: ${error.message}\n`)
        throw new Error(`Failed to parse response JSON: ${error.message}`)
      }

      assert.ok(
        !data.error,
        `Header request should not have error, got: ${data.error}`,
      )

      assert.ok(
        data.posts && data.posts.length > 0,
        'Response should contain posts',
      )

      const headerLabels = data.posts[0].labels || []
      communityNotesLabels = headerLabels.filter(
        (label: any) => label.src === labelerDid,
      )

      if (communityNotesLabels.length > 0) {
        break
      }

      if (attempt < maxAttempts) {
        process.stderr.write(`⏳ [DEBUG] Waiting before retry\n`)
        await new Promise((resolve) => setTimeout(resolve, 100)) // Use 0.1s delay like shell script
      }
    }

    assert.ok(
      communityNotesLabels.length > 0,
      'Community Notes labels should be included when atproto-accept-labelers header is set',
    )
  })

  test('🏷️  Test 3: Verify Label Content and Structure', async () => {
    const encodedUri = encodeURIComponent(testPostUri)

    let response: Response
    try {
      response = await fetch(
        `${network.bsky.url}/xrpc/app.bsky.feed.getPosts?uris=${encodedUri}`,
        {
          headers: {
            'atproto-accept-labelers': labelerDid || '',
          },
        },
      )
    } catch (error: any) {
      process.stderr.write(`🚨 FETCH FAILED: ${error.message}\n`)
      throw new Error(
        `Failed to fetch posts for label verification: ${error.message}`,
      )
    }

    assert.ok(
      response.ok,
      `Label verification request should succeed: ${response.status}`,
    )

    let data: any
    try {
      data = await response.json()
    } catch (error: any) {
      process.stderr.write(`🚨 JSON PARSE FAILED: ${error.message}\n`)
      throw new Error(`Failed to parse response JSON: ${error.message}`)
    }

    assert.ok(
      data.posts && data.posts.length > 0,
      'Response should contain posts',
    )

    const labels = data.posts[0].labels || []
    const communityLabels = labels.filter(
      (label: any) => label.src === labelerDid,
    )

    if (communityLabels.length === 0) {
      throw new Error(
        'Community Notes labels found: false - No labels detected',
      )
    }

    const labelValues = communityLabels.map((label: any) => label.val).sort()

    // Check for expected label values
    const hasNeedsContext = communityLabels.some(
      (label: any) => label.val === 'needs-context',
    )
    const hasProposedNote = communityLabels.some(
      (label: any) => label.val === 'proposed-label:needs-context',
    )

    if (hasNeedsContext || hasProposedNote) {
      assert.ok(true, 'Post has expected Community Notes labels')
    } else {
      throw new Error(
        `Post has unexpected label values: ${labelValues.join(', ')}. Expected: needs-context or proposed-label:needs-context`,
      )
    }
  })

  test('🏷️  Test 4: Header Parsing Functionality', async () => {
    const encodedUri = encodeURIComponent(testPostUri)

    // Test with example labeler only (should exclude Community Notes)
    let excludeResponse: Response
    try {
      excludeResponse = await fetch(
        `${network.bsky.url}/xrpc/app.bsky.feed.getPosts?uris=${encodedUri}`,
        {
          headers: {
            'atproto-accept-labelers': 'did:example:labeler',
          },
        },
      )
    } catch (error: any) {
      process.stderr.write(`🚨 EXCLUDE FETCH FAILED: ${error.message}\n`)
      throw new Error(`Failed to fetch with example labeler: ${error.message}`)
    }

    assert.ok(
      excludeResponse.ok,
      `Example labeler request should succeed: ${excludeResponse.status}`,
    )
    const excludeData = await excludeResponse.json()
    const excludePostsCount = excludeData.posts?.length || 0

    // Test with Community Notes Labeler DID only
    let includeResponse: Response
    try {
      includeResponse = await fetch(
        `${network.bsky.url}/xrpc/app.bsky.feed.getPosts?uris=${encodedUri}`,
        {
          headers: {
            'atproto-accept-labelers': labelerDid || '',
          },
        },
      )
    } catch (error: any) {
      process.stderr.write(`🚨 INCLUDE FETCH FAILED: ${error.message}\n`)
      throw new Error(
        `Failed to fetch with Community Notes labeler: ${error.message}`,
      )
    }

    assert.ok(
      includeResponse.ok,
      `Community Notes labeler request should succeed: ${includeResponse.status}`,
    )
    const includeData = await includeResponse.json()
    const includePostsCount = includeData.posts?.length || 0

    assert.ok(
      excludePostsCount > 0 && includePostsCount > 0,
      `Header parsing should work - both requests must return posts. Example labeler: ${excludePostsCount}, Community Notes: ${includePostsCount}`,
    )
  })

  test('🗑️ Test 5: Label Deletion on Status Change', async () => {
    // STEP 1: Change the existing proposal status to rated_not_helpful (should remove positive label)
    let deleteScoreSuccess: boolean
    try {
      deleteScoreSuccess = await setProposalScore(
        network,
        proposalUri,
        'rated_not_helpful',
        -0.3,
      )
    } catch (error: any) {
      throw new Error(
        `Failed to set proposal score to rated_not_helpful: ${error.message}`,
      )
    }

    assert.ok(
      deleteScoreSuccess,
      'Set proposal score to rated_not_helpful should succeed',
    )

    assert.ok(
      true, // Score change succeeded, so status change is confirmed
      'Proposal status changed to rated_not_helpful',
    )

    // STEP 2: Verify the proposal status was updated via API
    let updatedProposalsData: any
    try {
      updatedProposalsData = await getProposals(
        network,
        users.alice,
        testPostUri,
      )
    } catch (error: any) {
      process.stderr.write(`🚨 GET PROPOSALS FAILED: ${error.message}\n`)
      process.stderr.write(`🚨 Stack trace: ${error.stack}\n`)
      throw new Error(`Failed to get updated proposals: ${error.message}`)
    }

    // Find the specific proposal we updated by URI
    const updatedProposal = updatedProposalsData.proposals?.find(
      (p: any) => p.uri === proposalUri,
    )

    if (!updatedProposal) {
      process.stderr.write(
        `🚨 [DEBUG] Could not find proposal with URI: ${proposalUri}\n`,
      )
      process.stderr.write(`🚨 [DEBUG] Available proposal URIs:\n`)
      updatedProposalsData.proposals?.forEach((p: any, index: number) => {
        process.stderr.write(`  ${index + 1}. ${p.uri}\n`)
      })
    }

    assert.ok(
      updatedProposal,
      `Proposal with URI ${proposalUri} should exist after status change`,
    )

    assert.strictEqual(
      updatedProposal.status,
      'rated_not_helpful',
      `Proposal status verified as rated_not_helpful should be true. Got: "${updatedProposal.status}"`,
    )

    // Force Bsky to process the label deletion
    try {
      await network.bsky.sub.processAll()
    } catch (error: any) {
      process.stderr.write(`⚠️ Error during Bsky sync: ${error.message}\n`)
    }

    // STEP 3: Verify label deletion (implementing retry logic like shell script)
    const maxAttempts = 3
    let labelDeletionVerified = false
    let attempt = 1

    while (attempt <= maxAttempts) {
      try {
        const labelsCheckResponse = await fetch(
          `${network.bsky.url}/xrpc/app.bsky.feed.getPosts?uris=${encodeURIComponent(testPostUri)}`,
          {
            headers: {
              'atproto-accept-labelers': labelerDid || '',
            },
          },
        )

        assert.ok(
          labelsCheckResponse.ok,
          `Label check request should succeed: ${labelsCheckResponse.status}`,
        )

        const labelsData = await labelsCheckResponse.json()
        const currentLabels = labelsData.posts?.[0]?.labels || []
        const currentCommunityLabels = currentLabels.filter(
          (label: any) => label.src === labelerDid,
        )

        // Debug: Show all current labels
        // currentCommunityLabels.forEach((label: any, index: number) => {
        //   process.stderr.write(
        //     `  ${index + 1}. ${label.val} (src: ${label.src})\n`,
        //   )
        // })

        // Check if positive label (needs-context) is gone
        const hasPositiveLabel = currentCommunityLabels.some(
          (label: any) => label.val === 'needs-context',
        )

        if (!hasPositiveLabel) {
          labelDeletionVerified = true
          break
        }

        if (attempt < maxAttempts) {
          process.stderr.write(
            `⏳ Attempt ${attempt}/${maxAttempts}: Label deletion not yet reflected, retrying...\n`,
          )
          await new Promise((resolve) => setTimeout(resolve, 1000)) // 1s delay like shell script
        }

        attempt++
      } catch (error: any) {
        throw new Error(
          `Failed to check labels after deletion: ${error.message}`,
        )
      }
    }

    assert.ok(
      labelDeletionVerified,
      `Label deletion verified within ${maxAttempts} attempts should be true. Took ${attempt - 1} attempts`,
    )
  })

  test('cleanup', async () => {
    try {
      await network?.close()
    } catch (error: any) {
      process.stderr.write(`⚠️ Cleanup error: ${error.message}\n`)
    }
    await resetBskySchema()
  })
})
