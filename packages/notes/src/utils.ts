import { createHash } from 'node:crypto'
import { base32 } from 'multiformats/bases/base32'
import { CID } from 'multiformats/cid'
import { AtpAgent } from '@atproto/api'
import { cborEncode, verifyCidForBytes } from '@atproto/common'
import { lexToIpld } from '@atproto/lexicon'
import { AtUri } from '@atproto/syntax'
import { InvalidRequestError } from '@atproto/xrpc-server'
import { AppContext } from './context'
import { httpLogger as log } from './logger'

/**
 * Generate a rainbow-table resistant Anonymous ID (AID) from a DID using SHA256
 *
 * Security properties:
 * - Rainbow table resistant: Service private key acts as secret salt
 * - Service-specific: Different services with different keys produce different AIDs
 * - Deterministic: Same inputs always produce same AID
 * - STABLE: AID remains constant as long as service private key is stable
 *
 * @param userDid - User's DID
 * @param serviceDid - Service DID (for service binding)
 * @param servicePrivateKey - Service private key (string or keypair object)
 */
export function generateAid(userDid: string, servicePrivateKey: any): string {
  // Handle both string and keypair object formats
  let keyData: string
  if (typeof servicePrivateKey === 'string') {
    keyData = servicePrivateKey
  } else if (
    servicePrivateKey &&
    typeof servicePrivateKey.bytes === 'function'
  ) {
    // Secp256k1Keypair or similar object with bytes() method
    keyData = Buffer.from(servicePrivateKey.bytes()).toString('hex')
  } else if (servicePrivateKey && servicePrivateKey.privateKeyHex) {
    // Object with privateKeyHex property
    keyData = servicePrivateKey.privateKeyHex
  } else if (servicePrivateKey && servicePrivateKey.privateKey) {
    // Object with privateKey property
    keyData = servicePrivateKey.privateKey.toString('hex')
  } else {
    throw new Error(
      'Invalid servicePrivateKey format - must be string or keypair object',
    )
  }

  // Generate hash with service private key for rainbow table resistance
  const hash = createHash('sha256')
    .update(userDid) // User identity
    .update(keyData) // Secret salt (rainbow table resistance)
    .digest()

  // Take first 120 bits (15 bytes) and base32 encode like PLC DIDs
  const aidBytes = hash.subarray(0, 15)
  return base32.baseEncode(aidBytes)
}
/**
 * Generate a deterministic rkey for a vote record based on voter AID and proposal URI
 * This ensures one unique vote per user per proposal
 */
export function generateVoteRkey(
  voterAid: string,
  proposalUri: string,
): string {
  const hash = createHash('sha256')
    .update(`${voterAid}:${proposalUri}`)
    .digest('hex')
  return `vote_${hash.substring(0, 16)}`
}

/**
 * Generate pseudonym from AID using deterministic algorithm
 */
export function generatePseudonymFromAid(aid: string): string {
  const adjectives = [
    'Helpful',
    'Thoughtful',
    'Careful',
    'Diligent',
    'Observant',
    'Wise',
    'Sharp',
    'Keen',
  ]
  const animals = [
    'Hedgehog',
    'Owl',
    'Fox',
    'Beaver',
    'Eagle',
    'Dolphin',
    'Penguin',
    'Turtle',
  ]

  // Use a simple hash of the aid to consistently generate the same pseudonym
  const hash = aid.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)

  const adjIndex = hash % adjectives.length
  const animalIndex = Math.floor(hash / adjectives.length) % animals.length

  return `${adjectives[adjIndex]} ${animals[animalIndex]}`
}

/**
 * Validate that a CID matches the expected CID for a record
 * Returns true if valid, false if invalid
 */
export async function validateRecordCid(
  record: object,
  expectedCid: string,
): Promise<boolean> {
  try {
    const common = await import('@atproto/common')
    const ipldRecord = common.jsonToIpld(record)
    const cid = await common.cidForCbor(ipldRecord)
    return cid.toString() === expectedCid
  } catch (error) {
    return false
  }
}

/**
 * Validate CID against raw bytes (for deeper validation)
 */
export async function validateCidForBytes(
  cidString: string,
  record: object,
): Promise<boolean> {
  try {
    const ipldRecord = lexToIpld(record)
    const cborBytes = cborEncode(ipldRecord)
    const cid = CID.parse(cidString)
    await verifyCidForBytes(cid, cborBytes)
    return true
  } catch (error) {
    return false
  }
}

/**
 * Create authenticated PDS agent using credential-based authentication
 * Uses DID + password to get fresh tokens automatically
 * Handles session validation and re-authentication when needed
 */
export async function createAuthenticatedPdsAgent(ctx: AppContext): Promise<{
  agent: AtpAgent
  serviceRepoId: string
}> {
  // Use provided service account or fall back to repository account
  const account = ctx.repoAccount
  const serviceDid = account?.did || 'did:plc:community-notes-service'

  if (!ctx.pdsUrl || !account?.password) {
    log.error(
      {
        hasPdsUrl: !!ctx.pdsUrl,
        hasRepoAccount: !!account,
        hasPassword: !!account?.password,
      },
      'PDS URL and service account password must be configured',
    )
    throw new Error('PDS URL and service account password must be configured')
  }

  // Create AtpAgent with automatic session management
  const agent = new AtpAgent({ service: ctx.pdsUrl })

  // Prepare credentials for authentication
  const credentials = {
    identifier: serviceDid,
    password: account.password,
  }

  log.debug(
    {
      serviceDid,
      pdsUrl: ctx.pdsUrl,
    },
    'Creating authenticated PDS agent with credential-based auth',
  )

  try {
    // Use credentials to get fresh tokens (like ozone service)
    if (!agent.hasSession) {
      await agent.login(credentials)
    }

    // Test session validity and re-authenticate if needed
    try {
      await agent.com.atproto.server.getSession()
    } catch (err) {
      if ((err as any).status === 401) {
        log.debug('Session invalid, re-authenticating with credentials')
        await agent.login(credentials)
      } else {
        throw err
      }
    }

    const serviceRepoId = serviceDid

    log.debug(
      {
        serviceRepoId,
        pdsUrl: ctx.pdsUrl,
        sessionActive: agent.hasSession,
      },
      'PDS agent authenticated successfully with credentials',
    )

    return {
      agent,
      serviceRepoId,
    }
  } catch (error) {
    // Enhanced error logging for authentication failures
    const errorDetails: any = {
      serviceDid,
      pdsUrl: ctx.pdsUrl,
      hasPassword: !!account.password,
    }

    if (error instanceof Error) {
      errorDetails.errorMessage = error.message
      errorDetails.errorName = error.name
      errorDetails.errorStack = error.stack

      // Capture additional details from AT Protocol errors
      if ('status' in error) {
        errorDetails.httpStatus = (error as any).status
      }
      if ('error' in error) {
        errorDetails.pdsError = (error as any).error
      }
      if ('response' in error && (error as any).response) {
        const response = (error as any).response
        errorDetails.responseStatus = response.status
        errorDetails.responseHeaders = response.headers
        errorDetails.responseData = response.data
      }

      // Try to capture raw error object
      try {
        errorDetails.rawError = JSON.parse(
          JSON.stringify(error, Object.getOwnPropertyNames(error)),
        )
      } catch {
        errorDetails.rawErrorKeys = Object.getOwnPropertyNames(error)
      }
    } else {
      errorDetails.unknownError = error
    }

    log.error(
      errorDetails,
      'Failed to create authenticated PDS agent - detailed error information',
    )

    throw new Error(
      `Failed to authenticate with PDS: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
    )
  }
}

/**
 * Normalize AT URI by resolving handles to DIDs and converting bsky.app URLs
 * This ensures consistent URI format for database queries and mock data generation
 *
 * Supports:
 * - AT Protocol URIs (at://) - resolves handles to DIDs
 * - bsky.app profile URLs - converts to AT URIs
 * - bsky.app post URLs - converts to AT URIs with proper collection
 * - Other URIs are returned as-is
 *
 * Note: This follows the same pattern as Bsky's Hydrator.resolveUri but with
 * strict error handling to ensure data consistency in the notes service.
 */
export async function normalizeAtUri(
  uriStr: string,
  ctx: AppContext,
): Promise<string> {
  // Handle bsky.app URLs first
  if (uriStr.startsWith('https://bsky.app/profile/')) {
    try {
      const bskyUrl = new URL(uriStr)
      const pathParts = bskyUrl.pathname.split('/').filter(Boolean)

      // Expected format: /profile/{handle-or-did} or /profile/{handle-or-did}/post/{rkey}
      if (pathParts.length < 2 || pathParts[0] !== 'profile') {
        throw new Error(`Invalid bsky.app URL format: ${uriStr}`)
      }

      const handleOrDid = pathParts[1]

      if (pathParts.length === 2) {
        // Profile URL: https://bsky.app/profile/{handle-or-did} -> at://{handle-or-did}
        const atUri = `at://${handleOrDid}`

        log.debug(
          {
            originalUrl: uriStr,
            convertedUri: atUri,
            handleOrDid,
          },
          'Converted bsky.app profile URL to AT URI',
        )

        // Recursively call normalizeAtUri to resolve handles to DIDs
        return await normalizeAtUri(atUri, ctx)
      } else if (pathParts.length === 4 && pathParts[2] === 'post') {
        // Post URL: https://bsky.app/profile/{handle-or-did}/post/{rkey} -> at://{handle-or-did}/app.bsky.feed.post/{rkey}
        const rkey = pathParts[3]
        const atUri = `at://${handleOrDid}/app.bsky.feed.post/${rkey}`

        log.debug(
          {
            originalUrl: uriStr,
            convertedUri: atUri,
            handleOrDid,
            rkey,
          },
          'Converted bsky.app post URL to AT URI',
        )

        // Recursively call normalizeAtUri to resolve handles to DIDs
        return await normalizeAtUri(atUri, ctx)
      } else {
        throw new Error(`Unsupported bsky.app URL format: ${uriStr}`)
      }
    } catch (error) {
      log.error(
        {
          url: uriStr,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to convert bsky.app URL to AT URI',
      )

      throw new Error(
        `Failed to convert bsky.app URL to AT URI: ${uriStr} - ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      )
    }
  }

  // Only process AT Protocol URIs, return other URIs as-is
  if (!uriStr.startsWith('at://')) {
    return uriStr
  }

  try {
    const uri = new AtUri(uriStr)

    // If the host is already a DID, return as-is
    if (uri.host.startsWith('did:')) {
      return uriStr
    }

    // Try to resolve the handle to a DID
    // First, try to create an authenticated PDS agent to resolve the handle
    try {
      const { agent } = await createAuthenticatedPdsAgent(ctx)

      // Use the PDS agent to resolve the handle
      const result = await agent.com.atproto.identity.resolveHandle({
        handle: uri.host,
      })

      if (result.data.did) {
        // Replace the handle with the DID in the URI
        uri.host = result.data.did
        const normalizedUri = uri.toString()

        log.debug(
          {
            originalUri: uriStr,
            normalizedUri,
            resolvedDid: result.data.did,
            handle: uri.host,
          },
          'Successfully normalized AT URI by resolving handle to DID',
        )

        return normalizedUri
      } else {
        // Handle resolution succeeded but didn't return a DID
        throw new Error(
          `Handle resolution for "${uri.host}" succeeded but returned no DID`,
        )
      }
    } catch (error) {
      log.error(
        {
          uri: uriStr,
          handle: uri.host,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        'Failed to resolve handle to DID - this is required for data consistency',
      )

      // Throw an error instead of falling back to the original URI
      throw new Error(
        `Failed to resolve handle "${uri.host}" to DID: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      )
    }
  } catch (error) {
    // If this is a handle resolution error, re-throw it
    if (
      error instanceof Error &&
      error.message.includes('Failed to resolve handle')
    ) {
      throw error
    }

    log.error(
      {
        uri: uriStr,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      'Failed to parse AT URI - invalid URI format',
    )

    // If URI parsing fails, throw an InvalidRequestError for proper error handling
    throw new InvalidRequestError(
      `Invalid AT URI format: ${uriStr} - ${
        error instanceof Error ? error.message : 'Unknown error'
      }`,
      'InvalidTarget',
    )
  }
}
