import assert from 'node:assert'
import { describe, test } from 'node:test'
import { TestNetworkWrapper } from '../src/dev-env/test-network-wrapper'
import {
  TestUsers,
  createTestNetwork,
  createTestScoredProposals,
  createTestUsers,
  resetBskySchema,
} from './test-utils'

describe('Feed Hydration', () => {
  let network: TestNetworkWrapper
  let users: TestUsers
  let labelerDid: string | undefined

  test('setup', async () => {
    // Create TestNetwork with clean schema reset
    network = await createTestNetwork(true)

    // Create test users
    users = await createTestUsers(network)

    labelerDid = 'did:example:labeler'

    await createTestScoredProposals(network, users)

    // Force Bsky service to process all pending indexing
    try {
      await network.network.processAll()
    } catch (error) {
      process.stderr.write(
        `⚠️ Error processing Bsky indexing: ${error.message}\n`,
      )
    }
  })

  test('🔍 Test 1: Feed Generator Discovery', async () => {
    // Test feed generator discovery
    const response = await fetch(
      `${network.notes?.url}/xrpc/app.bsky.feed.describeFeedGenerator`,
    )

    assert.ok(response.ok, 'Feed generator discovery should work')
    const data = await response.json()

    const feedgenRepoDid = data.did
    assert.ok(
      feedgenRepoDid && feedgenRepoDid !== 'null',
      `Feed generator discovery works - DID must be non-empty and not "null". Got: ${feedgenRepoDid}`,
    )

    // Extract first feed URI for validation
    const firstFeedUri = data.feeds?.[0]?.uri
    assert.ok(
      firstFeedUri && firstFeedUri !== 'null',
      `First feed should have valid URI. Got: ${firstFeedUri}`,
    )

    // CONFIGURATION RETRIEVAL TEST
    const configResponse = await fetch(
      `${network.notes?.url}/xrpc/org.opencommunitynotes.getConfig`,
    )
    assert.ok(configResponse.ok, 'Configuration retrieval should work')
    const config = await configResponse.json()

    const configLabelerDid = config.labelerDid
    assert.ok(
      configLabelerDid && configLabelerDid !== 'null',
      `Configuration retrieved - labelerDid must be non-empty and not "null". Got: ${configLabelerDid}`,
    )
  })

  test('📋 Test 2: Direct Feed Skeleton', async () => {
    // Get feed configuration
    const configResponse = await fetch(
      `${network.notes?.url}/xrpc/org.opencommunitynotes.getConfig`,
    )
    assert.ok(configResponse.ok, 'Should be able to get config')

    // Get first feed URI from describeFeedGenerator
    const describeResponse = await fetch(
      `${network.notes?.url}/xrpc/app.bsky.feed.describeFeedGenerator`,
    )
    assert.ok(describeResponse.ok, 'Should be able to describe feed generator')
    const describeData = await describeResponse.json()
    const firstFeedUri = describeData.feeds?.[0]?.uri

    // URL-encode the feed URI (: → %3A, / → %2F)
    const encodedFeedUri = encodeURIComponent(firstFeedUri)
    const directResponse = await fetch(
      `${network.notes?.url}/xrpc/app.bsky.feed.getFeedSkeleton?feed=${encodedFeedUri}`,
    )

    assert.ok(directResponse.ok, 'Direct feed skeleton should work')
    const directData = await directResponse.json()

    const feedCount = directData.feed ? directData.feed.length : 0
    assert.ok(
      feedCount > 0,
      `Direct feed skeleton works - Feed items count must be > 0. Got: ${feedCount}`,
    )
  })

  test('📝 Test 3: Feed Generator Records in PDS', async () => {
    // Test that feed generator records exist in PDS (API surface test)
    const serviceRepoId = network.notes?.serviceAccount.did

    const recordsResponse = await fetch(
      `${network.pds.url}/xrpc/com.atproto.repo.listRecords?repo=${serviceRepoId}&collection=app.bsky.feed.generator`,
    )

    assert.ok(recordsResponse.ok, 'PDS records request should succeed')

    const recordsData = await recordsResponse.json()
    const recordsCount = recordsData.records?.length || 0

    assert.ok(
      recordsCount > 0,
      `Feed generator records exist - Records count must be > 0. Got: ${recordsCount}`,
    )
  })

  test('🆔 Test 4: DID Document Verification', async () => {
    // Test DID document resolution and BskyFeedGenerator service verification
    const feedgenDocumentDid = network.notes?.feedGeneratorDid

    // Test DID document resolution
    const didResponse = await fetch(`${network.plc.url}/${feedgenDocumentDid}`)
    assert.ok(didResponse.ok, 'DID document should be resolvable')

    const didDoc = await didResponse.json()
    assert.ok(
      didDoc.id === feedgenDocumentDid,
      'DID document should have correct ID',
    )

    // Check for BskyFeedGenerator service in DID document
    let hasFgService = false
    if (didDoc.service && Array.isArray(didDoc.service)) {
      hasFgService = didDoc.service.some(
        (service: any) => service.type === 'BskyFeedGenerator',
      )
    }

    assert.ok(
      hasFgService,
      'BskyFeedGenerator service in DID document - Single-DID architecture: feed discovery via records',
    )
  })

  test('🌊 Test 5: Bsky Feed Hydration', async () => {
    // Construct feed URI: at://{REPO_DID}/app.bsky.feed.generator/new
    const serviceRepoId = network.notes?.serviceAccount.did
    const bskyFeedUri = `at://${serviceRepoId}/app.bsky.feed.generator/new`
    // URL-encode the URI (: → %3A, / → %2F)
    const encodedBskyUri = encodeURIComponent(bskyFeedUri)

    // Retry loop for Bsky hydration - Maximum 10 attempts, 2-second delay
    const maxAttempts = 10
    let attempt = 1
    let hydrationSuccess = false
    let finalCount = 0
    let lastError: string | undefined

    try {
      await network.network.processAll()
    } catch (error) {
      process.stderr.write(
        `⚠️ Error processing Bsky indexing: ${error.message}\n`,
      )
    }

    while (attempt <= maxAttempts) {
      try {
        const bskyResponse = await fetch(
          `${network.bsky.url}/xrpc/app.bsky.feed.getFeed?feed=${encodedBskyUri}`,
          {
            headers: {
              'atproto-accept-labelers': labelerDid || '',
            },
          },
        )

        if (bskyResponse.ok) {
          const bskyData = await bskyResponse.json()
          finalCount = bskyData.feed ? bskyData.feed.length : 0

          // Success criteria: BSKY_COUNT > 0
          if (finalCount > 0) {
            hydrationSuccess = true
            break
          } else {
            // Zero results, continue retrying
            process.stderr.write(
              `⏳ Zero results, attempt ${attempt}, retrying...\n`,
            )
          }
        } else {
          // Check for fatal vs non-fatal errors
          const errorText = await bskyResponse.text()
          lastError = `Error ${bskyResponse.status}: ${errorText}`

          try {
            const errorData = JSON.parse(errorText)
            
            if (errorData.error === 'InvalidFeedResponse') {
              // FATAL ERROR: InvalidFeedResponse indicates structural problem
              assert.ok(
                false,
                'Bsky hydration (no InvalidFeedResponse) - FATAL: InvalidFeedResponse indicates structural problem',
              )
            } else if (errorData.error === 'InvalidRequest' && errorData.message?.includes('could not find feed')) {
              // EXPECTED ERROR: Feed not yet synced to Bsky, continue retrying
              process.stderr.write(
                `⏳ Feed not yet synced (attempt ${attempt}): ${errorData.message}, retrying...\n`,
              )
            } else {
              // OTHER ERRORS: Log but continue retrying
              process.stderr.write(
                `⏳ Error on attempt ${attempt}: ${errorData.error} - ${errorData.message}, retrying...\n`,
              )
            }
          } catch (parseError) {
            // Non-JSON error response, log and continue retrying
            process.stderr.write(
              `⏳ Non-JSON error on attempt ${attempt}: ${lastError}, retrying...\n`,
            )
          }
        }
      } catch (error: any) {
        lastError = `Fetch failed: ${error.message}`
        process.stderr.write(
          `⏳ Fetch error on attempt ${attempt}: ${error.message}, retrying in 2 seconds...\n`,
        )
      }

      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 2000)) // 2-second delay like shell script
      }
      attempt++
    }

    assert.ok(
      hydrationSuccess,
      `Bsky hydration works - Must succeed within ${maxAttempts} attempts. Feed items: ${finalCount}, Attempts: ${attempt - 1}. Last error: ${lastError}`,
    )

    // Log final response on failure (like shell script)
    if (!hydrationSuccess) {
      process.stderr.write(`Last error: ${lastError}\n`)
    }
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
