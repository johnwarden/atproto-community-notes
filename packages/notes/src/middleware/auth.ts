import { NextFunction, Request, Response } from 'express'
import { AuthService } from '../auth'
import { httpLogger as log } from '../logger'

export interface AuthenticatedRequest extends Request {
  auth?: {
    did: string
  }
}

export function createAuthMiddleware(authService: AuthService) {
  return {
    /**
     * Middleware that requires authentication
     */
    required: async (
      req: AuthenticatedRequest,
      res: Response,
      next: NextFunction,
    ) => {
      const authHeader = req.headers.authorization

      if (!authHeader) {
        log.warn({ url: req.url }, 'Missing Authorization header')
        return res.status(401).json({
          error: 'AuthenticationRequired',
          message: 'Authorization header is required',
        })
      }

      const authResult = await authService.verifyBearerToken(authHeader)

      if (!authResult.success) {
        log.warn(
          { url: req.url, error: authResult.error },
          'Authentication failed',
        )
        return res.status(401).json({
          error: 'AuthenticationFailed',
          message: authResult.error || 'Invalid or expired token',
        })
      }

      // Add auth info to request
      req.auth = {
        did: authResult.did!,
      }

      log.debug(
        { did: authResult.did, url: req.url },
        'Request authenticated successfully',
      )

      next()
    },

    /**
     * Middleware that optionally extracts auth info if present
     */
    optional: async (
      req: AuthenticatedRequest,
      res: Response,
      next: NextFunction,
    ) => {
      const authHeader = req.headers.authorization

      if (!authHeader) {
        // No auth header provided, continue without auth
        next()
        return
      }

      const authResult = await authService.verifyBearerToken(authHeader)

      if (authResult.success) {
        req.auth = {
          did: authResult.did!,
        }

        log.debug(
          { did: authResult.did, url: req.url },
          'Optional authentication succeeded',
        )
      } else {
        log.debug(
          { url: req.url, error: authResult.error },
          'Optional authentication failed, continuing without auth',
        )
      }

      next()
    },
  }
}
