import assert from 'node:assert'
import { describe, test } from 'node:test'
import { TestNetworkWrapper } from '../src/dev-env/test-network-wrapper'
import { createTestNetwork } from './test-utils'

describe('getConfig', () => {
  let network: TestNetworkWrapper

  test('setup', async () => {
    // Setup test environment with notes service only
    network = await createTestNetwork()
  })

  test('🔧 getConfig Endpoint Test', async () => {
    // Call the getConfig endpoint
    const response = await fetch(
      `${network.notes?.url}/xrpc/org.opencommunitynotes.getConfig`,
    )

    assert.ok(
      response.ok,
      `getConfig endpoint responds - Response must not be "error". Status: ${response.status}`,
    )

    const configResponse = await response.json()

    // Parse response
    const version = configResponse.version
    const labelerDid = configResponse.labelerDid
    const feedGeneratorDid = configResponse.feedGeneratorDid

    assert.ok(
      version && version !== 'null' && version.length > 0,
      `Response has version field - Version must be non-null and non-empty. Got: ${version}`,
    )

    assert.ok(
      labelerDid && labelerDid !== 'null' && labelerDid.length > 0,
      `Response has labelerDid field - LabelerDid must be non-null and non-empty. Got: ${labelerDid}`,
    )

    assert.ok(
      feedGeneratorDid &&
        feedGeneratorDid !== 'null' &&
        feedGeneratorDid.length > 0,
      `Response has feedGeneratorDid field - FeedGeneratorDid must be non-null and non-empty. Got: ${feedGeneratorDid}`,
    )

    assert.ok(
      labelerDid.startsWith('did:'),
      `labelerDid is valid DID format - Must start with "did:". Got: ${labelerDid}`,
    )

    assert.ok(
      feedGeneratorDid.startsWith('did:'),
      `feedGeneratorDid is valid DID format - Must start with "did:". Got: ${feedGeneratorDid}`,
    )

    const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/
    assert.ok(
      iso8601Regex.test(version),
      `version is ISO 8601 timestamp - Must match ISO 8601 pattern. Got: ${version}`,
    )
  })

  test('🔓 Authentication Test', async () => {
    // Test that endpoint doesn't require authentication
    const unauthResponse = await fetch(
      `${network.notes?.url}/xrpc/org.opencommunitynotes.getConfig`,
    )

    assert.ok(unauthResponse.ok, 'Endpoint should work without authentication')
    const unauthData = await unauthResponse.json()

    const unauthVersion = unauthData.version
    const unauthLabelerDid = unauthData.labelerDid
    const unauthFeedGeneratorDid = unauthData.feedGeneratorDid

    assert.ok(
      unauthVersion && unauthVersion !== 'null' && unauthVersion.length > 0,
      `Endpoint works without authentication - Version must be non-null and non-empty. Got: ${unauthVersion}`,
    )

    // Test DID consistency (version will change but DIDs should be consistent)
    // Make another call to compare
    const secondResponse = await fetch(
      `${network.notes?.url}/xrpc/org.opencommunitynotes.getConfig`,
    )
    const secondData = await secondResponse.json()

    const labelerDidConsistent = unauthLabelerDid === secondData.labelerDid
    const feedGeneratorDidConsistent =
      unauthFeedGeneratorDid === secondData.feedGeneratorDid

    assert.ok(
      labelerDidConsistent && feedGeneratorDidConsistent,
      `DIDs are consistent between calls - Both labelerDid and feedGeneratorDid must match. LabelerDid: ${labelerDidConsistent}, FeedGeneratorDid: ${feedGeneratorDidConsistent}`,
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
