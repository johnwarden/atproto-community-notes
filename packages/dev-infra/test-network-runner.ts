#!/usr/bin/env node

/**
 * Test Network Runner
 *
 * Spins up a test network with standard mock users and scored proposals for testing external services.
 * Creates test users (alice, bob, carol) and sample community notes proposals with scores.
 * Useful for testing Python scoring services that need to hit the /score endpoint.
 *
 * Usage: npm run test-network or node dist/tests/test-network-runner.js
 */

import getPort from 'get-port'
import { TestNetworkWrapper } from '../notes/src/dev-env/test-network-wrapper'
import {
  TestUsers,
  createTestScoredProposals,
  createTestUsers,
} from '../notes/tests/test-utils'

let network: TestNetworkWrapper | null = null
let users: TestUsers | null = null
let isShuttingDown = false

async function startTestNetwork(): Promise<void> {
  console.log('🚀 Starting test network...')

  try {
    // Create test network with introspection server
    console.log('📡 Creating test network...')
    network = await TestNetworkWrapper.create({
      dbPostgresSchema: 'test_network_runner',
      labeler: { port: await getPort() },
      notes: { port: await getPort(), internalApiPort: await getPort() },
      introspect: { port: await getPort() },
    })

    // Create test users
    console.log('👥 Creating test users (alice, bob, carol)...')
    users = await createTestUsers(network)

    // Create test posts and scored proposals
    console.log('📝 Creating test posts and scored proposals...')
    const testData = await createTestScoredProposals(network, users)

    console.log('✅ Test network started successfully!')
    console.log('')
    console.log('📋 Service Information:')
    console.log(`   PDS URL:              ${network.pds.url}`)
    console.log(`   Bsky URL:             ${network.bsky.url}`)
    console.log(`   Ozone URL:            ${network.ozone.url}`)
    console.log(`   PLC URL:              ${network.plc.url}`)
    console.log(`   Notes Service URL:    ${network.notes?.url || 'N/A'}`)
    console.log(
      `   Notes Internal URL:   ${network.notes?.internalUrl || 'N/A'}`,
    )
    console.log(`   Labeler URL:          ${network.labeler?.url || 'N/A'}`)
    console.log(
      `   Labeler DID:          ${network.labeler?.labelerDid || 'N/A'}`,
    )
    console.log(
      `   Introspection URL:    ${network.introspectWrapper ? `http://localhost:${network.introspectWrapper.port}` : 'N/A'}`,
    )
    console.log('')
    console.log('👥 Test Users Created:')
    console.log(`   Alice: ${users.alice.did} (${users.alice.handle})`)
    console.log(`   Bob:   ${users.bob.did} (${users.bob.handle})`)
    console.log(`   Carol: ${users.carol.did} (${users.carol.handle})`)
    console.log('')
    console.log('📝 Test Data Created:')
    console.log(`   Alice's post:     ${testData.alicePostUri}`)
    console.log(`   Bob's post:       ${testData.bobPostUri}`)
    console.log(`   Alice's proposal: ${testData.aliceProposalUri}`)
    console.log(`   Bob on Alice:     ${testData.bobOnAliceUri}`)
    console.log(`   Alice on Bob:     ${testData.aliceOnBobUri}`)
    console.log('')
    console.log('🎯 Key endpoints for testing:')
    console.log(
      `   Score endpoint:       POST ${network.notes?.internalUrl}/score`,
    )
    console.log(`   Health check:         GET ${network.notes?.url}/_ping`)
    console.log('')
    console.log('💡 Example score endpoint usage:')
    console.log('   curl -X POST \\')
    console.log(`     ${network.notes?.internalUrl}/score \\`)
    console.log('     -H "Content-Type: application/json" \\')
    console.log(
      `     -d '{"proposalUri": "${testData.aliceProposalUri}", "status": "rated_helpful", "score": 0.8}'`,
    )
    console.log('')
    console.log('🛑 Press Ctrl+C to shutdown cleanly')

    // Keep the process alive
    await new Promise(() => {}) // This will run indefinitely until interrupted
  } catch (error) {
    console.error('❌ Failed to start test network:', error)
    process.exit(1)
  }
}

async function shutdown(): Promise<void> {
  if (isShuttingDown) {
    console.log('⚠️  Shutdown already in progress...')
    return
  }

  isShuttingDown = true
  console.log('')
  console.log('🛑 Shutting down test network...')

  try {
    if (network) {
      await network.close()
      console.log('✅ Test network shutdown complete')
    }
  } catch (error) {
    console.error('❌ Error during shutdown:', error)
    process.exit(1)
  }

  process.exit(0)
}

// Handle graceful shutdown on various signals
process.on('SIGINT', shutdown) // Ctrl+C
process.on('SIGTERM', shutdown) // Termination signal
process.on('SIGHUP', shutdown) // Hang up signal

// Handle uncaught exceptions
process.on('uncaughtException', async (error) => {
  console.error('❌ Uncaught exception:', error)
  await shutdown()
})

process.on('unhandledRejection', async (reason, promise) => {
  console.error('❌ Unhandled rejection at:', promise, 'reason:', reason)
  await shutdown()
})

// Start the test network
startTestNetwork().catch(async (error) => {
  console.error('❌ Failed to start test network:', error)
  await shutdown()
})
