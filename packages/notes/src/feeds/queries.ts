import { sql } from 'kysely'
import { generateAid } from '../utils'
import { FeedScaffolding } from './scaffolding'
import { FeedContext, FeedSkeleton } from './types'

/**
 * "New" feed - newest proposed notes that need more ratings, sorted chronologically
 */
export async function getNewFeed(
  ctx: FeedContext,
  limit: number = 50,
  cursor?: string,
): Promise<FeedSkeleton> {
  const { limit: validatedLimit, offsetTime } = FeedScaffolding.validateParams(
    limit,
    cursor,
  )
  const startTime = Date.now()

  try {
    // Join score and record tables to get chronological ordering by proposal creation time
    const results = await ctx.scoresDb.db
      .selectFrom('score as s')
      .innerJoin('record as r', 'r.uri', 's.proposalUri')
      .select(['s.targetUri', 'r.indexedAt'])
      .where('s.status', '=', 'needs_more_ratings')
      .where('r.indexedAt', '<', new Date(offsetTime).toISOString())
      .orderBy('r.indexedAt', 'desc') // Sort by proposal creation time (chronological)
      .limit(validatedLimit + 1) // +1 to check for next page
      .execute()

    const feedResult = FeedScaffolding.processFeedResults(
      results,
      validatedLimit,
      'indexedAt',
    )

    FeedScaffolding.logFeedMetrics(
      'new',
      feedResult.feed.length,
      Date.now() - startTime,
      ctx.userDid,
      !!feedResult.cursor,
    )

    return feedResult
  } catch (error) {
    return FeedScaffolding.handleFeedError(error, 'new')
  }
}

/**
 * "Needs Your Help" feed - posts needing ratings, excluding user's existing ratings
 */
export async function getNeedsYourHelpFeed(
  ctx: FeedContext,
  limit: number = 50,
  cursor?: string,
): Promise<FeedSkeleton> {
  const { limit: validatedLimit, offsetTime } = FeedScaffolding.validateParams(
    limit,
    cursor,
  )
  const startTime = Date.now()

  try {
    // For authenticated users, find posts with at least one unrated note needing ratings
    // For anonymous users, show all posts with notes needing ratings
    if (ctx.userDid) {
      const userAid = generateAid(ctx.userDid, ctx.servicePrivateKey)

      // Step 1: Get all posts with notes needing ratings
      const postsWithScores = await ctx.scoresDb.db
        .selectFrom('score as s')
        .select(['s.targetUri', 's.proposalUri', 's.scoreEventTime', 's.score'])
        .where('s.status', '=', 'needs_more_ratings')
        .where('s.scoreEventTime', '<', offsetTime)
        .execute()

      // Step 2: Get all proposals this user has rated
      const userVotes = await ctx.notesDb.db
        .selectFrom('record as r')
        .select([sql`json_extract(r.record, '$.uri')`.as('proposalUri')])
        .where('r.collection', '=', 'social.pmsky.vote')
        .where(sql`json_extract(r.record, '$.aid')`, '=', userAid)
        .execute()

      const ratedProposalUris = new Set(
        userVotes.map((v) => v.proposalUri as string),
      )

      // Step 3: Filter to posts that have at least one unrated proposal and track highest score
      const postsWithUnratedNotes = new Map<string, { scoreEventTime: number; score: number }>()

      for (const score of postsWithScores) {
        if (!ratedProposalUris.has(score.proposalUri)) {
          const existing = postsWithUnratedNotes.get(score.targetUri)
          if (!existing || score.score > existing.score) {
            postsWithUnratedNotes.set(score.targetUri, {
              scoreEventTime: score.scoreEventTime,
              score: score.score,
            })
          }
        }
      }

      // Step 4: Convert to feed format and sort by score descending
      const results = Array.from(postsWithUnratedNotes.entries())
        .map(([targetUri, { scoreEventTime, score }]) => ({ 
          targetUri, 
          scoreEventTime,
          score 
        }))
        .sort((a, b) => b.score - a.score) // Sort by score descending
        .slice(0, validatedLimit + 1)

      const feedResult = FeedScaffolding.processFeedResults(
        results,
        validatedLimit,
        'scoreEventTime',
      )

      FeedScaffolding.logFeedMetrics(
        'needs_your_help',
        feedResult.feed.length,
        Date.now() - startTime,
        ctx.userDid,
        !!feedResult.cursor,
      )

      return feedResult
    } else {
      // Anonymous users see all posts with notes needing ratings, sorted by highest score
      const results = await ctx.scoresDb.db
        .selectFrom('score as s')
        .select([
          's.targetUri',
          sql<number>`MAX(s.scoreEventTime)`.as('scoreEventTime'),
          sql<number>`MAX(s.score)`.as('score'),
        ])
        .where('s.status', '=', 'needs_more_ratings')
        .where('s.scoreEventTime', '<', offsetTime)
        .groupBy('s.targetUri')
        .orderBy('score', 'desc') // Sort by highest score descending
        .limit(validatedLimit + 1)
        .execute()

      const feedResult = FeedScaffolding.processFeedResults(
        results,
        validatedLimit,
        'scoreEventTime',
      )

      FeedScaffolding.logFeedMetrics(
        'needs_your_help',
        feedResult.feed.length,
        Date.now() - startTime,
        ctx.userDid,
        !!feedResult.cursor,
      )

      return feedResult
    }
  } catch (error) {
    return FeedScaffolding.handleFeedError(error, 'needs_your_help')
  }
}

/**
 * "Rated Helpful" feed - posts with notes rated as helpful
 */
export async function getRatedHelpfulFeed(
  ctx: FeedContext,
  limit: number = 50,
  cursor?: string,
): Promise<FeedSkeleton> {
  const { limit: validatedLimit, offsetTime } = FeedScaffolding.validateParams(
    limit,
    cursor,
  )
  const startTime = Date.now()

  try {
    // Query score table directly
    const results = await ctx.scoresDb.db
      .selectFrom('score as s')
      .select(['s.targetUri', 's.scoreEventTime'])
      .where('s.status', '=', 'rated_helpful')
      .where('s.scoreEventTime', '<', offsetTime)
      .orderBy('s.scoreEventTime', 'desc')
      .limit(validatedLimit + 1)
      .execute()

    const feedResult = FeedScaffolding.processFeedResults(
      results,
      validatedLimit,
      'scoreEventTime',
    )

    FeedScaffolding.logFeedMetrics(
      'rated_helpful',
      feedResult.feed.length,
      Date.now() - startTime,
      ctx.userDid,
      !!feedResult.cursor,
    )

    return feedResult
  } catch (error) {
    return FeedScaffolding.handleFeedError(error, 'rated_helpful')
  }
}
