import path from 'node:path'
import getPort from 'get-port'
import { Kysely, PostgresDialect, sql } from 'kysely'
import { Pool } from 'pg'
import { AtpAgent } from '@atproto/api'
import { TestNetworkWrapper } from '../src/dev-env/test-network-wrapper'
export interface TestUser {
  did: string
  handle: string
  email: string
  password: string
  agent: AtpAgent
}

export async function debug(message: string, data?: any): Promise<void> {
  process.stderr.write(`DEBUG: ${message}\n`)
  if (data) {
    process.stderr.write(`       ${JSON.stringify(data, null, 2)}\n`)
  }
}

export interface TestUsers {
  alice: TestUser
  bob: TestUser
  carol: TestUser
}

/**
 * Create test users for Notes integration tests
 * Similar to basicSeed but focused on Notes-specific needs
 */
export async function createTestUsers(
  network: TestNetworkWrapper,
): Promise<TestUsers> {
  const users = {
    alice: {
      email: 'alice@test.com',
      handle: 'alice.test',
      password: 'alice-pass',
    },
    bob: {
      email: 'bob@test.com',
      handle: 'bob.test',
      password: 'bob-pass',
    },
    carol: {
      email: 'carol@test.com',
      handle: 'carol.test',
      password: 'carol-pass',
    },
  }

  const testUsers: TestUsers = {} as TestUsers

  // Create accounts and agents
  for (const [name, userData] of Object.entries(users)) {
    const agent = network.pds.getClient()

    const { data: account } =
      await agent.com.atproto.server.createAccount(userData)

    await agent.login({
      identifier: userData.handle,
      password: userData.password,
    })

    testUsers[name as keyof TestUsers] = {
      did: account.did,
      handle: userData.handle,
      email: userData.email,
      password: userData.password,
      agent,
    }
  }

  // Process all events to ensure PDS and other services are synchronized
  await network.network.processAll()

  return testUsers
}

/**
 * Create a test post for a user
 */
export async function createTestPost(
  user: TestUser,
  text: string = 'Test post for community notes',
): Promise<string> {
  const { data: post } = await user.agent.com.atproto.repo.createRecord({
    repo: user.did,
    collection: 'app.bsky.feed.post',
    record: {
      text,
      createdAt: new Date().toISOString(),
    },
  })
  return post.uri
}

/**
 * Create a community note proposal
 */
export async function createCommunityNote(
  network: TestNetworkWrapper,
  user: TestUser,
  uri: string,
  note: string,
  val: string = 'needs-context',
  reasons: string[] = ['factual_error'],
): Promise<{ uri: string; response: Response }> {
  const response = await fetch(
    `${network.notes?.url}/xrpc/org.opencommunitynotes.createProposal`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${user.agent.session?.accessJwt}`,
      },
      body: JSON.stringify({
        typ: 'label',
        uri,
        val,
        note,
        reasons,
      }),
    },
  )

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(
      `Failed to create community note: ${response.status} ${errorText}`,
    )
  }

  const data = await response.json()
  return { uri: data.uri, response }
}

/**
 * Create a rating for a community note
 */
export async function createRating(
  network: TestNetworkWrapper,
  user: TestUser,
  proposalUri: string,
  rating: 'helpful' | 'not-helpful' | 'somewhat-helpful',
): Promise<{ uri: string; response: Response }> {
  const response = await fetch(
    `${network.notes?.url}/xrpc/org.opencommunitynotes.rateProposal`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${user.agent.session?.accessJwt}`,
      },
      body: JSON.stringify({
        uri: proposalUri,
        val: rating === 'helpful' ? 1 : rating === 'not-helpful' ? -1 : 0,
        reasons:
          rating === 'helpful'
            ? ['cites_high_quality_sources']
            : ['factual_error'],
      }),
    },
  )

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to create rating: ${response.status} ${errorText}`)
  }

  const data = await response.json()
  return { uri: data.rating?.uri || '', response }
}

/**
 * Delete a rating for a community note
 */
export async function deleteRating(
  network: TestNetworkWrapper,
  user: TestUser,
  proposalUri: string,
): Promise<boolean> {
  const response = await fetch(
    `${network.notes?.url}/xrpc/org.opencommunitynotes.rateProposal`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${user.agent.session?.accessJwt}`,
      },
      body: JSON.stringify({
        uri: proposalUri,
        delete: true,
      }),
    },
  )

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Failed to delete rating: ${response.status} ${errorText}`)
  }

  const data = await response.json()
  return data.success === true
}

/**
 * Set proposal score via notes service internal API (using TestNetworkWrapper)
 * Based on the shell test utility function set_proposal_score
 */
export async function setProposalScore(
  network: TestNetworkWrapper,
  proposalUri: string,
  status: 'needs_more_ratings' | 'rated_helpful' | 'rated_not_helpful',
  score: number,
): Promise<boolean> {
  try {
    const response = await fetch(`${network.notes?.internalUrl}/score`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        proposalUri,
        status,
        score,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      process.stderr.write(
        `Failed to set proposal score (HTTP ${response.status}): ${errorText}\n`,
      )
      return false
    }

    const result = await response.json()
    if (result.success !== true) {
      process.stderr.write(
        `Failed to set proposal score: ${JSON.stringify(result)}\n`,
      )
      return false
    }

    return true
  } catch (error) {
    process.stderr.write(`Error setting proposal score:  ${error}\n`)
    return false
  }
}

/**
 * Get proposals for a subject (matching shell test utility get_proposals_for_subject)
 */
export async function getProposals(
  network: TestNetworkWrapper,
  user: TestUser,
  uri: string,
  status?: string,
  label?: string,
): Promise<any> {
  const encodedUri = encodeURIComponent(uri)
  const statusParam = status ? `&status=${status}` : ''
  const labelParam = label ? `&label=${label}` : ''

  const response = await fetch(
    `${network.notes?.url}/xrpc/org.opencommunitynotes.getProposals?uris=${encodedUri}${statusParam}${labelParam}`,
    {
      headers: {
        Authorization: `Bearer ${user.agent.session?.accessJwt}`,
      },
    },
  )

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(
      `Failed to get proposals for subject: ${response.status} ${errorText}`,
    )
  }

  return response.json()
}

/**
 * Create a proposal with scoring (combines proposal creation and scoring)
 * Based on the shell test utility function create_scored_proposal
 */
export async function createScoredProposal(
  network: TestNetworkWrapper,
  user: TestUser,
  targetUri: string,
  labelValue: string = 'needs-context',
  score: number = 0.0,
  status:
    | 'needs_more_ratings'
    | 'rated_helpful'
    | 'rated_not_helpful' = 'needs_more_ratings',
  noteText: string = 'Test proposal with scoring',
): Promise<string> {
  // Create proposal
  const { uri: proposalUri } = await createCommunityNote(
    network,
    user,
    targetUri,
    noteText,
    labelValue,
    ['disputed_claim'],
  )

  // Set score using the error-checking function
  const scoreSuccess = await setProposalScore(
    network,
    proposalUri,
    status,
    score,
  )
  if (!scoreSuccess) {
    throw new Error('Failed to set score for created proposal')
  }

  return proposalUri
}

/**
 * Test that a response is an authentication error
 */
export async function expectAuthenticationRequired(
  response: Response,
): Promise<void> {
  if (response.ok) {
    throw new Error('Expected authentication error but request succeeded')
  }

  const error = await response.json()
  if (error.error !== 'AuthenticationRequired') {
    throw new Error(`Expected AuthenticationRequired but got: ${error.error}`)
  }
}

/**
 * Test that a response is a validation error
 */
export async function expectValidationError(response: Response): Promise<void> {
  if (response.ok) {
    throw new Error('Expected validation error but request succeeded')
  }

  if (response.status < 400) {
    throw new Error(`Expected 4xx error but got: ${response.status}`)
  }
}

/**
 * Reset Bsky database schema by dropping and recreating it
 * Notes service uses SQLite, so only Bsky needs schema reset
 */
export async function _resetBskySchema(
  dbPostgresUrl: string,
  bskySchema: string,
): Promise<void> {
  // Create a temporary database connection for schema operations
  const pool = new Pool({ connectionString: dbPostgresUrl })
  const db = new Kysely({ dialect: new PostgresDialect({ pool }) })

  try {
    // Reset Bsky database schema
    await sql`DROP SCHEMA IF EXISTS ${sql.id(bskySchema)} CASCADE`.execute(db)
    await sql`CREATE SCHEMA ${sql.id(bskySchema)}`.execute(db)
  } finally {
    // Clean up the temporary connection
    try {
      await db.destroy()
    } catch (error) {
      process.stderr.write(`db.destroy(): $error\n`)
    }
  }
}

/**
 * Create TestNetwork with clean database schema reset
 * This is the recommended way to create TestNetwork for integration tests
 */
/**
 * Get the caller file name from the stack trace
 */
function getCallerFileName(): string | null {
  const originalStackTrace = Error.prepareStackTrace
  Error.prepareStackTrace = (_, stack) => stack
  const stack = new Error().stack as any
  Error.prepareStackTrace = originalStackTrace

  // Look for the first stack frame that's not this file and not Node.js internals
  for (let i = 1; i < stack.length; i++) {
    const fileName = stack[i].getFileName()
    if (
      fileName &&
      !fileName.includes('node:') &&
      !fileName.includes('internal/') &&
      fileName !== __filename
    ) {
      return fileName
    }
  }
  return null
}
/**
 * Auto-detect schema name for cleanup operations
 */
export function getAutoDetectedSchemaName(): string {
  const callerFile = getCallerFileName()
  if (callerFile) {
    const basename = path.basename(callerFile, path.extname(callerFile))
    return (
      'test_' +
      basename
        .replace(/[-.]/g, '_') // Replace hyphens and dots with underscores
        .replace(/([a-z])([A-Z])/g, '$1_$2') // Convert camelCase to snake_case
        .toLowerCase()
    )
  }
  return 'test_unknown'
}

/**
 * Reset Bsky schema with auto-detected schema name
 * This is the recommended cleanup function for tests
 */
export async function resetBskySchema(): Promise<void> {
  const dbPostgresUrl = process.env.DB_POSTGRES_URL!
  const schemaName = getAutoDetectedSchemaName()

  try {
    await _resetBskySchema(dbPostgresUrl, schemaName)
  } catch (error: any) {
    process.stderr.write(`⚠️ Schema reset error: ${error.message}\n`)
    throw error // Re-throw to ensure test failures are visible
  }
}

export async function createTestNetwork(
  resetBskySchema: boolean = false,
): Promise<TestNetworkWrapper> {
  const schemaName = getAutoDetectedSchemaName()

  if (resetBskySchema) {
    const dbPostgresUrl = process.env.DB_POSTGRES_URL!

    // Reset Bsky schema BEFORE creating TestNetwork for clean setup
    try {
      await _resetBskySchema(dbPostgresUrl, schemaName)
    } catch (error: any) {
      process.stderr.write(`🚨 SCHEMA RESET FAILED: ${error.message}\n`)
      process.stderr.write(`🚨 Stack trace: ${error.stack}\n`)
      throw new Error(`Database schema reset failed: ${error.message}`)
    }
  }

  // Create TestNetworkWrapper with clean schemas and notes/labeler services
  try {
    const network = await TestNetworkWrapper.create({
      dbPostgresSchema: schemaName,
      labeler: { port: await getPort() },
      notes: { port: await getPort(), internalApiPort: await getPort(), internalApiHost: "::1" },
    })

    return network
  } catch (error: any) {
    process.stderr.write(`🚨 TESTNETWORK CREATION FAILED: ${error.message}\n`)
    process.stderr.write(`🚨 Stack trace: ${error.stack}\n`)
    throw new Error(`TestNetwork creation failed: ${error.message}`)
  }
}

/**
 * Create test data with scored proposals for feed testing
 * Returns URIs for posts and proposals that can be used in tests
 */
export async function createTestScoredProposals(
  network: TestNetworkWrapper,
  users: TestUsers,
): Promise<{
  alicePostUri: string
  bobPostUri: string
  aliceProposalUri: string
  bobOnAliceUri: string
  aliceOnBobUri: string
}> {
  // Create Alice's test post
  const alicePostUri = await createTestPost(
    users.alice,
    'Alice test post for comprehensive proposal testing',
  )
  if (!alicePostUri) {
    throw new Error('Failed to create Alice post')
  }

  // Create Bob's test post
  const bobPostUri = await createTestPost(
    users.bob,
    'Bob test post for comprehensive proposal testing',
  )
  if (!bobPostUri) {
    throw new Error('Failed to create Bob post')
  }

  // Create Alice's proposal on her own post
  const { uri: aliceProposalUri } = await createCommunityNote(
    network,
    users.alice,
    alicePostUri,
    "Alice's note on her own post",
    'needs-context',
    ['disputed_claim'],
  )
  if (!aliceProposalUri) {
    throw new Error('Failed to create Alice proposal')
  }

  // Create Bob's proposal on Alice's post
  const { uri: bobOnAliceUri } = await createCommunityNote(
    network,
    users.bob,
    alicePostUri,
    "Bob's note on Alice's post",
    'misleading',
    ['factual_error'],
  )
  if (!bobOnAliceUri) {
    throw new Error('Failed to create Bob proposal on Alice post')
  }

  // Create Alice's proposal on Bob's post
  const { uri: aliceOnBobUri } = await createCommunityNote(
    network,
    users.alice,
    bobPostUri,
    "Alice's note on Bob's post",
    'needs-context',
    ['disputed_claim'],
  )
  if (!aliceOnBobUri) {
    throw new Error('Failed to create Alice proposal on Bob post')
  }

  // Set Alice proposal score to 0.8 (rated_helpful)
  const aliceScoreSuccess = await setProposalScore(
    network,
    aliceProposalUri,
    'rated_helpful',
    0.8,
  )
  if (!aliceScoreSuccess) {
    throw new Error('Failed to set Alice proposal score')
  }

  // Set Bob proposal score to 0.3 (needs_more_ratings)
  const bobScoreSuccess = await setProposalScore(
    network,
    bobOnAliceUri,
    'needs_more_ratings',
    0.3,
  )
  if (!bobScoreSuccess) {
    throw new Error('Failed to set Bob proposal score')
  }

  // Set Alice on Bob proposal score to 0.9 (rated_helpful)
  const aliceOnBobScoreSuccess = await setProposalScore(
    network,
    aliceOnBobUri,
    'rated_helpful',
    0.9,
  )
  if (!aliceOnBobScoreSuccess) {
    throw new Error('Failed to set Alice on Bob proposal score')
  }

  return {
    alicePostUri,
    bobPostUri,
    aliceProposalUri,
    bobOnAliceUri,
    aliceOnBobUri,
  }
}
