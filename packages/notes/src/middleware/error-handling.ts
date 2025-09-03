import { NextFunction, Request, Response } from 'express'
import { InvalidRequestError, XRPCError } from '@atproto/xrpc-server'
import { httpLogger as log } from '../logger'

/**
 * Centralized error handling middleware for Express routes
 */
export function errorHandlingMiddleware(
  error: any,
  req: Request,
  res: Response,
  next: NextFunction,
) {
  // If response already sent, delegate to default Express error handler
  if (res.headersSent) {
    return next(error)
  }

  // Log the error with full context
  log.error(
    {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: req.body,
      params: req.params,
      query: req.query,
    },
    'Express route error',
  )

  // Send appropriate error response
  if (error instanceof XRPCError) {
    return res.status(error.type || 500).json({
      error: error.customErrorName || 'InternalServerError',
      message: error.message || 'Internal server error',
    })
  }

  // Default to 500 for unknown errors
  res.status(500).json({
    error: 'InternalServerError',
    message: 'Internal server error',
  })
}

/**
 * Wrapper for XRPC handlers that provides centralized error handling
 */
export function withErrorHandling<TInput = any, TOutput = any>(
  handlerFn: (params: { input: TInput; req: any }) => Promise<TOutput>,
  context?: { endpoint?: string; [key: string]: any },
) {
  return async (params: { input: TInput; req: any }): Promise<TOutput> => {
    try {
      return await handlerFn(params)
    } catch (error) {
      // Re-throw XRPC errors so they can be handled by the XRPC server
      if (error instanceof XRPCError || error instanceof InvalidRequestError) {
        throw error
      }

      // Log the error with full context
      const errorContext = {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        endpoint: context?.endpoint || 'unknown',
        method: params.req?.method,
        url: params.req?.url,
        headers: params.req?.headers,
        inputBody: params.input,
        ...context,
      }

      log.error(errorContext, 'XRPC handler error')

      // Return standardized error response for XRPC handlers
      return {
        status: 500,
        error: 'InternalServerError',
        message: 'Internal server error',
      } as any
    }
  }
}

/**
 * Async wrapper for Express route handlers
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }
}

/**
 * Helper to extract relevant request context for logging
 */
export function getRequestContext(
  req: any,
  additionalContext?: Record<string, any>,
) {
  return {
    method: req?.method,
    url: req?.url,
    headers: req?.headers,
    body: req?.body,
    params: req?.params,
    query: req?.query,
    ...additionalContext,
  }
}
