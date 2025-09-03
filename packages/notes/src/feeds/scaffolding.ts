import { InvalidRequestError } from '@atproto/xrpc-server'
import { httpLogger as log } from '../logger'
import { FeedContext, FeedSkeleton } from './types'

/**
 * Helper function to check if a URI is a valid AT Protocol URI
 */
function isAtProtocolUri(uri: string): boolean {
  return typeof uri === 'string' && uri.startsWith('at://')
}

/**
 * Feed scaffolding helper that provides common functionality for all feeds
 */
export class FeedScaffolding {
  /**
   * Validate common feed parameters
   */
  static validateParams(
    limit: number,
    cursor?: string,
  ): { limit: number; offsetTime: number } {
    // Validate limit
    if (limit < 1 || limit > 100) {
      throw new InvalidRequestError('Limit must be between 1 and 100')
    }

    // Parse cursor for pagination (timestamp in milliseconds)
    let offsetTime: number
    try {
      offsetTime = cursor ? parseInt(cursor) : Date.now()
      if (isNaN(offsetTime) || offsetTime < 0) {
        offsetTime = Date.now()
      }
    } catch {
      offsetTime = Date.now()
    }

    return { limit, offsetTime }
  }

  /**
   * Process feed results - filter AT Protocol URIs and handle pagination
   */
  static processFeedResults(
    results: Array<{
      targetUri: unknown
      indexedAt?: string
      scoreEventTime?: number
    }>,
    limit: number,
    timeField: 'indexedAt' | 'scoreEventTime' = 'indexedAt',
  ): FeedSkeleton {
    // Filter to only AT Protocol URIs and prepare feed items
    const allValidItems = results.filter((row) =>
      isAtProtocolUri(row.targetUri as string),
    )
    const feed = allValidItems.slice(0, limit).map((row) => ({
      post: row.targetUri as string,
    }))

    // Generate cursor for next page
    let nextCursor: string | undefined
    if (allValidItems.length > limit) {
      const lastItem = allValidItems[limit - 1]
      if (timeField === 'indexedAt' && lastItem.indexedAt) {
        nextCursor = new Date(lastItem.indexedAt).getTime().toString()
      } else if (timeField === 'scoreEventTime' && lastItem.scoreEventTime) {
        nextCursor = lastItem.scoreEventTime.toString()
      }
    }

    return { feed, cursor: nextCursor }
  }

  /**
   * Handle feed errors with consistent logging
   */
  static handleFeedError(error: any, feedType: string): never {
    log.error({ error, feedType }, `Failed to generate ${feedType} feed`)
    throw new InvalidRequestError('Failed to generate feed')
  }

  /**
   * Log feed generation metrics
   */
  static logFeedMetrics(
    feedType: string,
    feedCount: number,
    queryTime: number,
    userDid?: string,
    hasCursor?: boolean,
  ): void {
    log.info(
      {
        feedType,
        feedCount,
        queryTime,
        userDid: userDid || 'anonymous',
        hasCursor: !!hasCursor,
      },
      'Feed generated successfully',
    )
  }
}
