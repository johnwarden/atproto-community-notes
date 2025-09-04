import { AppContext } from '../../../context'
import {
  getVoteRecord,
  proposalExistsInDb,
  putRecord,
  syncToPds,
} from '../../../db/record-utils'
import { Server } from '../../../lexicon'
import {
  HandlerError,
  HandlerSuccess,
} from '../../../lexicon/types/org/opencommunitynotes/rateProposal'
import { httpLogger as log } from '../../../logger'
import { withErrorHandling } from '../../../middleware/error-handling'
import { generateAid, generateVoteRkey } from '../../../utils'

export default function (server: Server, ctx: AppContext) {
  server.org.opencommunitynotes.rateProposal({
    // Authentication is required for this endpoint
    handler: withErrorHandling(
      async ({ input, req }) => {
        log.info(
          {
            proposalUri: input.body.uri,
            val: input.body.val,
            reasons: input.body.reasons,
            delete: input.body.delete,
            hasVal: input.body.val !== undefined,
            hasReasons: !!input.body.reasons?.length,
          },
          'rateNote request received',
        )

        // Verify authentication
        const authHeader = req.headers?.authorization
        if (!authHeader) {
          log.warn({ uri: input.body.uri }, 'Missing Authorization header')
          return {
            status: 401,
            error: 'AuthenticationRequired',
            message: 'Authorization header is required',
          } as HandlerError
        }

        const authResult = await ctx.auth.verifyBearerToken(authHeader)
        if (!authResult.success) {
          log.warn(
            { error: authResult.error, uri: input.body.uri },
            'Authentication failed',
          )
          return {
            status: 401,
            error: 'AuthenticationRequired',
            message: authResult.error || 'Invalid or expired token',
          } as HandlerError
        }

        const raterDid = authResult.did!

        const servicePrivateKey = ctx.repoAccount.key
        const raterAid = generateAid(raterDid, servicePrivateKey)

        log.info(
          {
            raterDid,
            raterAid,
            proposalUri: input.body.uri,
          },
          'rateNote request authenticated',
        )

        // Check if user has sufficient rating impact score
        const hasPermission = await ctx.auth.checkRatingImpactScore(
          raterDid,
          'rate_note',
        )
        if (!hasPermission) {
          log.warn(
            {
              raterDid,
              raterAid,
              proposalUri: input.body.uri,
            },
            'Insufficient rating impact score',
          )
          return {
            status: 403,
            error: 'InsufficientPermissions',
            message: 'User does not have sufficient rating impact score',
          } as HandlerError
        }

        // Validate that the note exists in database
        const existsInDb = await proposalExistsInDb(ctx.db!, input.body.uri)

        if (!existsInDb) {
          log.warn(
            {
              proposalUri: input.body.uri,
              raterDid,
              raterAid,
              checkedDb: !!ctx.db,
              foundInDb: existsInDb,
            },
            'Note not found for rating',
          )
          return {
            status: 404,
            error: 'ProposalNotFound',
            message: 'The specified note does not exist',
          } as HandlerError
        }

        // Validate rating input for create/update (unless deleting)
        if (!input.body.delete && input.body.val === undefined) {
          return {
            status: 400,
            error: 'InvalidRating',
            message: 'Rating value is required when not deleting',
          } as HandlerError
        }

        if (
          !input.body.delete &&
          (input.body.val! < -1 || input.body.val! > 1)
        ) {
          return {
            status: 400,
            error: 'InvalidRating',
            message: 'Rating value must be between -1 and 1',
          } as HandlerError
        }

        // Use unified vote function for all operations
        const result = await vote(ctx, {
          raterAid,
          proposalUri: input.body.uri,
          val: input.body.delete ? undefined : input.body.val,
          reasons: input.body.reasons || [],
        })

        if (!result.success) {
          return {
            status: 404,
            error: 'ProposalNotFound',
            message: 'No rating found to delete for this proposal',
          } as HandlerError
        }

        // Background sync operations (non-blocking)
        syncToPds(ctx).catch((error) =>
          log.error({ error }, 'Background PDS sync failed after vote'),
        )

        await ctx.notesService.syncPendingLabels()

        if (input.body.delete) {
          return {
            encoding: 'application/json',
            body: {
              success: true,
              deleted: true,
            },
          } as HandlerSuccess
        } else {
          // For create/update, we need to fetch the created record to return details
          // This is what the client expects based on the existing API
          const serviceDid = ctx.repoAccount!.did
          const voteRecord = await getVoteRecord(
            ctx.db,
            serviceDid,
            raterAid,
            input.body.uri,
          )

          if (!voteRecord) {
            throw new Error('Vote record not found after creation')
          }

          const recordData = JSON.parse(voteRecord.record)
          return {
            encoding: 'application/json',
            body: {
              success: true,
              rating: {
                uri: voteRecord.uri,
                cid: voteRecord.cid,
                targetUri: recordData.uri,
                val: recordData.val,
                reasons: recordData.reasons,
                cts: recordData.cts,
                updatedAt: voteRecord.indexedAt,
              },
            },
          } as HandlerSuccess
        }
      },
      { endpoint: 'org.opencommunitynotes.rateProposal' },
    ),
  })
}

/**
 * Insert/delete vote record and sync to PDS (if enabled)
 */
export async function vote(
  ctx: AppContext,
  params: {
    raterAid: string
    proposalUri: string
    val?: number // undefined = delete
    reasons?: string[]
  },
): Promise<{ success: boolean }> {
  const { raterAid, proposalUri, val, reasons = [] } = params

  const rkey = generateVoteRkey(raterAid, proposalUri)

  // Create/update operation - build vote record
  const now = new Date().toISOString()
  const voteRecord = {
    $type: 'social.pmsky.vote',
    src: ctx.repoAccount.did,
    uri: proposalUri,
    val,
    reasons,
    aid: raterAid,
    cts: now,
  }

  const result = await putRecord(ctx, {
    collection: 'social.pmsky.vote',
    rkey,
    record: val === undefined ? undefined : voteRecord,
  })

  if (!result.success) {
    log.info(
      {
        raterAid,
        proposalUri,
        val,
        operation: val === undefined ? 'delete' : 'create_or_update',
      },
      'Vote operation failed - no record found to delete',
    )
    return { success: false }
  }

  log.info(
    {
      raterAid,
      proposalUri,
      val,
      operation: val === undefined ? 'delete' : 'create_or_update',
    },
    'Vote operation completed successfully',
  )

  return { success: true }
}
