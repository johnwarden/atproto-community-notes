import { appLogger as log } from './logger'

export interface AuthResult {
  success: boolean
  did?: string
  error?: string
}

interface AtProtoJwtPayload {
  iss?: string // Issuer (PDS URL)
  sub?: string // Subject (user DID)
  aud?: string // Audience
  exp?: number // Expiration time
  iat?: number // Issued at time
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

  constructor(pdsUrl?: string) {
    // Use provided PDS URL or default to localhost:2583 for dev-env compatibility
    this.pdsUrl = pdsUrl || 'http://localhost:2583'
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
      // Extract the PDS URL from the JWT token's issuer (iss) claim
      const pdsUrl = await this.extractPdsFromToken(token)

      if (!pdsUrl) {
        return {
          success: false,
          error: 'Could not determine PDS URL from token',
        }
      }

      // Call the PDS getSession endpoint to verify the token
      const sessionResponse = await this.callPdsGetSession(pdsUrl, token)

      if (sessionResponse.success && sessionResponse.did) {
        log.debug(
          { did: sessionResponse.did, pdsUrl },
          'Successfully verified token with PDS',
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
   * Extract PDS URL from JWT token by decoding the issuer (iss) claim.
   * Falls back to configured PDS URL if extraction fails.
   */
  private async extractPdsFromToken(token: string): Promise<string | null> {
    try {
      // Decode the JWT token to access its claims
      const payload = unsafeDecodeJwt(token)

      // Extract the issuer (iss) claim which should contain the PDS URL
      const pdsUrl = payload.iss

      if (!pdsUrl || typeof pdsUrl !== 'string') {
        log.warn(
          { tokenPayload: payload },
          'JWT token missing or invalid issuer claim, falling back to configured PDS URL',
        )
        return this.pdsUrl
      }

      // Validate that the issuer looks like a valid URL
      try {
        new URL(pdsUrl)
      } catch (urlError) {
        log.warn(
          { pdsUrl, error: urlError },
          'JWT issuer claim is not a valid URL, falling back to configured PDS URL',
        )
        return this.pdsUrl
      }

      log.debug(
        { extractedPdsUrl: pdsUrl, configuredPdsUrl: this.pdsUrl },
        'Successfully extracted PDS URL from JWT token',
      )

      return pdsUrl
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      log.warn(
        { error: errorMessage },
        'Failed to decode JWT token, falling back to configured PDS URL',
      )

      // Fall back to configured PDS URL for backward compatibility
      return this.pdsUrl
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
