import { httpLogger as log } from './logger'

export interface AuthResult {
  success: boolean
  did?: string
  error?: string
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
      // Extract the PDS URL from the token (simplified approach)
      // In a real implementation, we'd decode the JWT to get the issuer
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
   * Extract PDS URL from JWT token.
   * This is a simplified implementation - in production we'd properly decode the JWT.
   */
  private async extractPdsFromToken(token: string): Promise<string | null> {
    try {
      // For now, we'll use the configured PDS URL
      // In production, we'd decode the JWT and extract the issuer (iss) claim
      // which should be the PDS URL

      return this.pdsUrl
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error'
      log.error({ error: errorMessage }, 'Failed to extract PDS URL from token')
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
