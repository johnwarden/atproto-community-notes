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
    // Start from record table and LEFT JOIN score table to include unscored proposals
    const results = await ctx.notesDb.db
      .selectFrom('record as r')
      .leftJoin('score as s', 's.proposalUri', 'r.uri')
      .select([
        sql`json_extract(r.record, '$.uri')`.as('targetUri'),
        'r.indexedAt',
      ])
      .where('r.collection', '=', 'social.pmsky.proposal')
      .where(
        // Include proposals with no score OR status = 'needs_more_ratings'
        sql`(s.status IS NULL OR s.status = 'needs_more_ratings')`,
      )
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

      // Step 1: Get all posts with notes needing ratings (including unscored proposals)
      const postsWithScores = await ctx.notesDb.db
        .selectFrom('record as r')
        .leftJoin('score as s', 's.proposalUri', 'r.uri')
        .select([
          sql`json_extract(r.record, '$.uri')`.as('targetUri'),
          'r.uri as proposalUri',
          sql`COALESCE(s.scoreEventTime, strftime('%s', r.indexedAt) * 1000)`.as(
            'scoreEventTime',
          ),
          sql`COALESCE(s.score, 0.0)`.as('score'),
        ])
        .where('r.collection', '=', 'social.pmsky.proposal')
        .where(
          // Include proposals with no score OR status = 'needs_more_ratings'
          sql`(s.status IS NULL OR s.status = 'needs_more_ratings')`,
        )
        .where(
          sql`COALESCE(s.scoreEventTime, strftime('%s', r.indexedAt) * 1000)`,
          '<',
          offsetTime,
        )
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
      const postsWithUnratedNotes = new Map<
        string,
        { scoreEventTime: number; score: number }
      >()

      for (const score of postsWithScores) {
        if (!ratedProposalUris.has(score.proposalUri as string)) {
          const existing = postsWithUnratedNotes.get(score.targetUri as string)
          if (!existing || (score.score as number) > existing.score) {
            postsWithUnratedNotes.set(score.targetUri as string, {
              scoreEventTime: score.scoreEventTime as number,
              score: score.score as number,
            })
          }
        }
      }

      // Step 4: Convert to feed format and sort by score descending
      const results = Array.from(postsWithUnratedNotes.entries())
        .map(([targetUri, { scoreEventTime, score }]) => ({
          targetUri,
          scoreEventTime,
          score,
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
      // Anonymous users see all posts with notes needing ratings (including unscored), sorted by highest score
      const results = await ctx.notesDb.db
        .selectFrom('record as r')
        .leftJoin('score as s', 's.proposalUri', 'r.uri')
        .select([
          sql`json_extract(r.record, '$.uri')`.as('targetUri'),
          sql<number>`MAX(COALESCE(s.scoreEventTime, strftime('%s', r.indexedAt) * 1000))`.as(
            'scoreEventTime',
          ),
          sql<number>`MAX(COALESCE(s.score, 0.0))`.as('score'),
        ])
        .where('r.collection', '=', 'social.pmsky.proposal')
        .where(
          // Include proposals with no score OR status = 'needs_more_ratings'
          sql`(s.status IS NULL OR s.status = 'needs_more_ratings')`,
        )
        .where(
          sql`COALESCE(s.scoreEventTime, strftime('%s', r.indexedAt) * 1000)`,
          '<',
          offsetTime,
        )
        .groupBy(sql`json_extract(r.record, '$.uri')`)
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
