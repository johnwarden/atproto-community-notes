import express from 'express'
import { InvalidRequestError } from '@atproto/xrpc-server'
import { AppContext } from '../context'
import { httpLogger as log } from '../logger'
import { asyncHandler } from '../middleware/error-handling'
import {
  getNeedsYourHelpFeed,
  getNewFeed,
  getRatedHelpfulFeed,
} from './queries'
import { FeedType } from './types'

export default function registerFeedHandlers(
  app: express.Application,
  ctx: AppContext,
) {
  // getFeedSkeleton endpoint - use direct Express route
  app.get('/xrpc/app.bsky.feed.getFeedSkeleton', asyncHandler(async (req, res) => {
      const {
        feed,
        limit = '50',
        cursor,
      } = req.query as { feed?: string; limit?: string; cursor?: string }

      // Validate required parameters
      if (!feed) {
        return res.status(400).json({
          error: 'InvalidRequest',
          message: 'Missing required parameter: feed',
        })
      }

      // Validate database connections
      if (!ctx.db) {
        return res.status(500).json({
          error: 'InternalServerError',
          message: 'Database connections not available',
        })
      }

      if (!ctx.repoAccount?.did) {
        return res.status(500).json({
          error: 'InternalServerError',
          message: 'Repository account not properly configured',
        })
      }

      // Extract feed type from AT-URI
      // Format: at://did:example:123/app.bsky.feed.generator/feed-type
      const feedType = feed.split('/').pop() as FeedType

      if (!['new', 'needs_your_help', 'rated_helpful'].includes(feedType)) {
        return res
          .status(400)
          .json({ error: 'UnknownFeed', message: 'Unknown feed' })
      }

      // Get user DID from auth if available
      let userDid: string | undefined
      const authHeader = req.headers?.authorization
      if (authHeader) {
        try {
          const authResult = await ctx.auth.verifyBearerToken(authHeader)
          if (authResult.success) {
            userDid = authResult.did
          }
        } catch (error) {
          // Continue without user context - feeds work for anonymous users too
          log.debug(
            { error },
            'Failed to verify auth token, continuing anonymously',
          )
        }
      }

      const feedContext = {
        notesDb: ctx.db,
        scoresDb: ctx.db,
        userDid,
        servicePrivateKey: ctx.repoAccount.key,
      }

      const startTime = Date.now()
      let result
      const limitNum = parseInt(limit, 10)

      switch (feedType) {
        case 'new':
          result = await getNewFeed(feedContext, limitNum, cursor)
          break
        case 'needs_your_help':
          result = await getNeedsYourHelpFeed(feedContext, limitNum, cursor)
          break
        case 'rated_helpful':
          result = await getRatedHelpfulFeed(feedContext, limitNum, cursor)
          break
        default:
          return res
            .status(400)
            .json({ error: 'UnknownFeed', message: 'Unknown feed' })
      }

      log.info(
        {
          feedType,
          feedCount: result.feed.length,
          queryTime: Date.now() - startTime,
          userDid: userDid || 'anonymous',
          hasCursor: !!result.cursor,
        },
        'Feed skeleton generated',
      )

      res.json(result)
  }))

  // describeFeedGenerator endpoint - use direct Express route
  app.get('/xrpc/app.bsky.feed.describeFeedGenerator', asyncHandler(async (req, res) => {
      if (!ctx.feedGeneratorDid) {
        return res.status(500).json({
          error: 'InternalServerError',
          message: 'Feed generator not properly configured',
        })
      }

      // Return the repository DID (where feed records are stored)
      // This matches the DID used in feed URIs
      const repoDid = ctx.repoAccount?.did || ctx.feedGeneratorDid
      const did = repoDid
      const feeds = [
        { uri: `at://${repoDid}/app.bsky.feed.generator/new` },
        { uri: `at://${repoDid}/app.bsky.feed.generator/needs_your_help` },
        { uri: `at://${repoDid}/app.bsky.feed.generator/rated_helpful` },
      ]

      log.info({
        feedGeneratorDid: ctx.feedGeneratorDid,
        repoDid,
        feedCount: feeds.length
      }, 'Feed generator described')

      res.json({
        did,
        feeds,
      })
  }))
}
