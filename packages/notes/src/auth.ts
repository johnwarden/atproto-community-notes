import { appLogger as log } from './logger'
import { IdResolver } from '@atproto/identity'

export interface AuthResult {
  success: boolean
  did?: string
  error?: string
}

interface AtProtoJwtPayload {
  iss?: string // Issuer (PDS URL) - present in dev-env tokens
  sub?: string // Subject (user DID)
  aud?: string // Audience (may contain service DID in production)
  exp?: number // Expiration time
  iat?: number // Issued at time
  scope?: string // Token scope (e.g., "com.atproto.access")
}

/**
 * Decode JWT payload without signature verification.
 * This is safe for our use case since we validate tokens via PDS getSession endpoint.
 */
function unsafeDecodeJwt(token: string): AtProtoJwtPayload {
  try {
    // Split JWT into header.payload.signature
    const parts = token.split('.')

    if (parts.length !== 3) {
      throw new Error('Invalid JWT format - must have 3 parts')
    }

    // Decode the payload (second part)
    const payload = parts[1]

    // Add padding if needed for base64url decoding
    const paddedPayload = payload + '='.repeat((4 - (payload.length % 4)) % 4)

    // Convert base64url to base64
    const base64 = paddedPayload.replace(/-/g, '+').replace(/_/g, '/')

    // Decode base64 to JSON
    const jsonPayload = Buffer.from(base64, 'base64').toString('utf8')

    return JSON.parse(jsonPayload)
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error'
    throw new Error(`Failed to decode JWT: ${errorMessage}`)
  }
}

export class AuthService {
  private pdsUrl: string
  private idResolver: IdResolver

  constructor(pdsUrl?: string) {
    // Use provided PDS URL or default to localhost:2583 for dev-env compatibility
    this.pdsUrl = pdsUrl || 'http://localhost:2583'
    
    // Configure IdResolver with production PLC URL since DID resolution
    // only happens for production tokens (dev tokens have iss field)
    this.idResolver = new IdResolver({ plcUrl: 'https://plc.directory' })
  }

  /**
   * Verify a bearer token using delegated authentication.
   * Calls the user's PDS getSession endpoint to validate the token.
   */
  async verifyBearerToken(authHeader: string): Promise<AuthResult> {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return {
        success: false,
        error: 'Missing or invalid Authorization header',
      }
    }

    const token = authHeader.slice(7) // Remove 'Bearer ' prefix

    try {
      // Extract the user's DID from the token and resolve their PDS URL
      const payload = unsafeDecodeJwt(token)
      const userDid = payload.sub
      
      if (!userDid || typeof userDid !== 'string' || !userDid.startsWith('did:')) {
        return {
          success: false,
          error: 'Invalid or missing user DID in token',
        }
      }

      // For now, use a simple approach: extract PDS URL from token or resolve from DID
      let pdsUrl: string | null = null
      
      // Strategy 1: Check if token has issuer claim (dev-env style)
      if (payload.iss && typeof payload.iss === 'string') {
        try {
          new URL(payload.iss)
          pdsUrl = payload.iss
          log.debug({ pdsUrl, userDid, strategy: 'iss_claim' }, 'Using PDS URL from token issuer')
        } catch {
          // Invalid URL in iss claim, will try other methods
          log.warn({ iss: payload.iss, userDid }, 'Invalid URL in iss claim, trying fallback')
        }
      } else {
        log.warn({ tokenPayload: payload }, 'DEV: No iss claim found in token - this should not happen in dev environment')
      }
      
      // Strategy 2: For tokens without issuer, determine PDS based on environment
      if (!pdsUrl) {
        // Check if we're in dev environment
        const isDevEnvironment = this.pdsUrl.includes('localhost') || 
                                 this.pdsUrl.includes('127.0.0.1') ||
                                 process.env.NODE_ENV === 'development'
        
        if (isDevEnvironment) {
          // In dev environment, users are on the same PDS as the service
          pdsUrl = this.pdsUrl
          log.debug({ pdsUrl, userDid, strategy: 'dev_same_pds' }, 'Using service PDS for dev environment user')
        } else {
          // In production, resolve the user's DID to find their PDS
          const resolvedPdsUrl = await this.resolvePdsFromDid(userDid)
          if (resolvedPdsUrl) {
            pdsUrl = resolvedPdsUrl
            log.debug({ pdsUrl, userDid, strategy: 'did_resolution' }, 'Resolved PDS URL from user DID')
          } else {
            return {
              success: false,
              error: `Cannot resolve PDS URL for user DID: ${userDid}`,
            }
          }
        }
      }

      // Call the user's PDS getSession endpoint to verify the token
      const sessionResponse = await this.callPdsGetSession(pdsUrl, token)

      if (sessionResponse.success && sessionResponse.did) {
        log.debug(
          { did: sessionResponse.did, pdsUrl, userDid },
          'Successfully verified token with user PDS',
        )

        return {
          success: true,
          did: sessionResponse.did,
        }
      } else {
        log.error(
          { error: sessionResponse.error, pdsUrl },
          'Token verification failed with PDS',
        )

        return {
          success: false,
          error: sessionResponse.error || 'Token verification failed',
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      log.error({ error: errorMessage }, 'Error during token verification')

      return {
        success: false,
        error: 'Internal authentication error',
      }
    }
  }

  /**
   * Resolve PDS URL from a user's DID using AT Protocol IdResolver
   */
  private async resolvePdsFromDid(did: string): Promise<string | null> {
    try {
      const didDoc = await this.idResolver.did.resolve(did)
      if (!didDoc) {
        log.warn({ did }, 'Could not resolve DID document')
        return null
      }

      // Look for the AtprotoPersonalDataServer service in the DID document
      const services = didDoc.service || []
      const pdsService = services.find(
        (service: any) =>
          service.type === 'AtprotoPersonalDataServer' ||
          service.id === '#atproto_pds',
      )

      if (pdsService && pdsService.serviceEndpoint && typeof pdsService.serviceEndpoint === 'string') {
        const pdsUrl = pdsService.serviceEndpoint
        log.debug(
          { did, pdsUrl, service: pdsService },
          'Resolved PDS URL from DID document',
        )
        return pdsUrl
      } else {
        log.warn(
          { did, services: services.map((s: any) => ({ id: s.id, type: s.type })) },
          'No AtprotoPersonalDataServer service found in DID document',
        )
        return null
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      log.warn(
        { did, error: errorMessage },
        'Failed to resolve DID document',
      )
      return null
    }
  }

  /**
   * Call the PDS getSession endpoint to verify the token
   */
  private async callPdsGetSession(
    pdsUrl: string,
    token: string,
  ): Promise<AuthResult> {
    try {
      const response = await fetch(
        `${pdsUrl}/xrpc/com.atproto.server.getSession`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        },
      )

      if (response.ok) {
        const data = (await response.json()) as { did?: string }

        if (data.did) {
          return {
            success: true,
            did: data.did,
          }
        } else {
          return {
            success: false,
            error: 'No DID in session response',
          }
        }
      } else {
        const errorText = await response.text()
        return {
          success: false,
          error: `PDS returned ${response.status}: ${errorText}`,
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      return {
        success: false,
        error: `Failed to contact PDS: ${errorMessage}`,
      }
    }
  }

  /**
   * Check if a user has sufficient "rating impact score" to perform actions.
   * This is a placeholder implementation.
   */
  async checkRatingImpactScore(
    did: string,
    action: 'create_note' | 'rate_note',
  ): Promise<boolean> {
    // Placeholder implementation - in production this would check the user's
    // rating impact score against required thresholds

    log.debug(
      { did, action },
      'Checking rating impact score (placeholder - always returns true)',
    )

    // For now, allow all authenticated users
    return true
  }
}
