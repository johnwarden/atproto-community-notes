import { sql } from 'kysely'
import { AppContext } from '../context'
import { appLogger as log } from '../logger'
import { generatePseudonymFromAid } from '../utils'
import { ProposalView } from '../views/types'

export interface GetHydratedProposalsParams {
  targetUri: string
  viewerAid: string
  status?: string
  label?: string
  limit?: number
}

/**
 * Get hydrated proposals with ratings in a single optimized query
 * Combines proposal data, scores, and viewer ratings with proper filtering and ordering
 */
export async function getHydratedProposals(
  ctx: AppContext,
  params: GetHydratedProposalsParams,
): Promise<ProposalView[]> {
  const { targetUri, viewerAid, status, label, limit = 50 } = params

  if (!ctx.db) {
    const error = new Error('Database not available')
    log.error(
      { targetUri, viewerAid },
      'Database not available for getHydratedProposals',
    )
    throw error
  }

  try {
    log.debug(
      {
        targetUri,
        viewerAid,
        status,
        label,
        limit,
      },
      'Starting getHydratedProposals query',
    )

    // Build the single optimized query with all JOINs and filters
    let query = ctx.db.db
      .selectFrom('record')
      .leftJoin('score', 'score.proposalUri', 'record.uri')
      .leftJoin('record as user_vote', (join) =>
        join
          .on('user_vote.collection', '=', 'social.pmsky.vote')
          .on(
            sql`json_extract(user_vote.record, '$.uri')`,
            '=',
            sql.ref('record.uri'),
          )
          .on(sql`json_extract(user_vote.record, '$.aid')`, '=', viewerAid),
      )
      .select([
        // Proposal fields
        'record.uri',
        'record.cid',
        'record.record',
        'record.indexedAt',
        // Score fields
        'score.status',
        'score.score',
        // User rating fields
        'user_vote.record as userRatingRecord',
        'user_vote.indexedAt as userRatingCreatedAt',
      ])
      .where('record.collection', '=', 'social.pmsky.proposal')
      .where(sql`json_extract(record.record, '$.uri')`, '=', targetUri)

    // Apply status filter if provided
    if (status) {
      if (status === 'needs_more_ratings') {
        // For needs_more_ratings, include proposals with no score record OR status = 'needs_more_ratings'
        query = query.where(
          sql`(score.status IS NULL OR score.status = ${status})`,
        )
      } else {
        // For other statuses, require exact match
        query = query.where('score.status', '=', status as any)
      }
    }

    // Apply label filter if provided
    if (label) {
      query = query.where(sql`json_extract(record.record, '$.val')`, '=', label)
    }

    // Apply ordering: unrated proposals first, then by score descending
    query = query
      .orderBy(sql`CASE WHEN user_vote.uri IS NULL THEN 0 ELSE 1 END`)
      .orderBy(sql`COALESCE(score.score, 0)`, 'desc')
      .orderBy('record.indexedAt', 'desc') // Tie-breaker for consistent ordering
      .limit(limit)

    const results = await query.execute()

    log.debug(
      {
        targetUri,
        viewerAid,
        resultCount: results.length,
        hasStatus: !!status,
        hasLabel: !!label,
      },
      'getHydratedProposals query completed',
    )

    // Transform results to ProposalView format
    const proposals: ProposalView[] = results
      .map((row) => {
        try {
          const proposalRecord = JSON.parse(row.record)

          // Build the base proposal
          const proposal: ProposalView = {
            uri: row.uri,
            cid: row.cid,
            author: {
              aid: proposalRecord.aid,
              pseudonym: generatePseudonymFromAid(proposalRecord.aid),
            },
            typ: proposalRecord.typ,
            targetUri: proposalRecord.uri,
            val: proposalRecord.val,
            reasons: proposalRecord.reasons || [],
            note: proposalRecord.note,
            cts: proposalRecord.cts,
            status:
              (row.status as
                | 'needs_more_ratings'
                | 'rated_helpful'
                | 'rated_not_helpful') || 'needs_more_ratings',
            score: row.score || undefined,
          }

          // Add viewer rating if present
          if (row.userRatingRecord) {
            try {
              const userRatingRecord = JSON.parse(row.userRatingRecord)
              proposal.viewer = {
                rating: {
                  val: userRatingRecord.val,
                  reasons: userRatingRecord.reasons || [],
                  uri: `at://${userRatingRecord.src}/social.pmsky.vote/${userRatingRecord.aid}_${Date.now()}`, // Reconstruct URI
                  createdAt: userRatingRecord.cts,
                  updatedAt: row.userRatingCreatedAt || undefined,
                },
              }
            } catch (ratingParseError) {
              log.warn(
                {
                  proposalUri: row.uri,
                  viewerAid,
                  error:
                    ratingParseError instanceof Error
                      ? ratingParseError.message
                      : 'Unknown error',
                },
                'Failed to parse user rating record, skipping rating data',
              )
              // Continue without rating data rather than failing the whole proposal
            }
          }

          return proposal
        } catch (recordParseError) {
          log.error(
            {
              proposalUri: row.uri,
              viewerAid,
              error:
                recordParseError instanceof Error
                  ? recordParseError.message
                  : 'Unknown error',
            },
            'Failed to parse proposal record, skipping proposal',
          )
          // Return null to filter out later
          return null
        }
      })
      .filter((proposal): proposal is ProposalView => proposal !== null)

    log.info(
      {
        targetUri,
        viewerAid,
        requestedCount: limit,
        returnedCount: proposals.length,
        filteredCount: results.length - proposals.length,
        status,
        label,
      },
      'getHydratedProposals completed successfully',
    )

    return proposals
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error'
    log.error(
      {
        targetUri,
        viewerAid,
        status,
        label,
        limit,
        error: errorMessage,
        errorStack: error instanceof Error ? error.stack : undefined,
      },
      'Failed to get hydrated proposals',
    )

    // Re-throw with additional context
    throw new Error(
      `Failed to get hydrated proposals for ${targetUri}: ${errorMessage}`,
    )
  }
}
