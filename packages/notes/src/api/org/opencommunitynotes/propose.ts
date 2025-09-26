import { AtUri } from '@atproto/api'
import { InvalidRequestError } from '@atproto/xrpc-server'
import { AppContext } from '../../../context'
import {
  findExistingProposalByUser,
  putRecord,
  syncToPds,
} from '../../../db/record-utils'
import { Server } from '../../../lexicon'
import {
  HandlerError,
  HandlerSuccess,
} from '../../../lexicon/types/org/opencommunitynotes/propose'
import { appLogger as log } from '../../../logger'
import { withErrorHandling } from '../../../middleware/error-handling'
import {
  generateAid,
  generatePseudonymFromAid,
  getOrCreatePdsAgent,
  normalizeAtUri,
} from '../../../utils'
import { resHeaders } from '../../util'
import { vote } from './vote'

// Helper function to validate AT Protocol target URIs
async function validateTargetUri(
  targetUri: string,
  ctx: AppContext,
): Promise<{ valid: boolean; error?: string }> {
  // Only validate AT Protocol URIs
  if (!targetUri.startsWith('at://')) {
    log.info({ targetUri }, 'Non-AT Protocol URI, skipping validation')
    return { valid: true }
  }

  try {
    // Parse the AT Protocol URI
    const atUri = new AtUri(targetUri)
    const isDevelopment = ctx.pdsUrl.includes('localhost') || 
                         process.env.NODE_ENV === 'development'

    // Try PDS validation first (PDS is always configured)
    try {
      const { agent } = await getOrCreatePdsAgent(ctx)
      await agent.com.atproto.repo.getRecord({
        repo: atUri.host,
        collection: atUri.collection,
        rkey: atUri.rkey,
      })

      log.info(
        {
          targetUri,
          repo: atUri.host,
          collection: atUri.collection,
          rkey: atUri.rkey,
          method: 'pds_validation',
        },
        'Target URI validation successful via PDS',
      )

      return { valid: true }
    } catch (pdsError) {
      log.debug(
        {
          targetUri,
          error: pdsError instanceof Error ? pdsError.message : 'Unknown error',
          method: 'pds_validation',
        },
        'PDS validation failed, checking fallback options',
      )

      // Environment-specific fallback behavior
      if (isDevelopment) {
        // In development, allow format validation for external URLs
        // This enables testing with live Bluesky content
        log.info(
          {
            targetUri,
            repo: atUri.host,
            collection: atUri.collection,
            rkey: atUri.rkey,
            method: 'format_validation_dev',
          },
          'Development environment: allowing external URI after format validation',
        )
        return { valid: true }
      } else {
        // In production, be strict - require the record to be accessible via configured PDS
        return {
          valid: false,
          error: `Target URI not accessible via configured PDS: ${targetUri}`,
        }
      }
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error'

    log.error(
      {
        targetUri,
        error: errorMessage,
      },
      'Target URI validation failed with parsing error',
    )

    return {
      valid: false,
      error: `Invalid target URI format: ${targetUri}`,
    }
  }
}

export default function (server: Server, ctx: AppContext) {
  server.org.opencommunitynotes.propose({
    // Authentication is required for this endpoint
    handler: withErrorHandling(
      async ({ input, req }) => {
        log.info(
          {
            typ: input.body.typ,
            uri: input.body.uri,
            val: input.body.val,
            hasNote: !!input.body.note,
            hasReasons: !!input.body.reasons?.length,
          },
          'Community Notes: createProposal request received',
        )

        // Verify authentication
        const authHeader = req.headers?.authorization
        if (!authHeader) {
          log.error({ uri: input.body.uri }, 'Missing Authorization header')
          return {
            status: 401,
            error: 'AuthenticationRequired',
            message: 'Authorization header is required',
          } as HandlerError
        }

        const authResult = await ctx.auth.verifyBearerToken(authHeader)
        if (!authResult.success) {
          log.error(
            { error: authResult.error, uri: input.body.uri },
            'Authentication failed',
          )
          return {
            status: 401,
            error: 'AuthenticationRequired',
            message: authResult.error || 'Invalid or expired token',
          } as HandlerError
        }

        const creatorDid = authResult.did!

        // Validate repository account configuration
        if (!ctx.repoAccount?.did || !ctx.aidSalt) {
          log.error('Repository account DID and AID salt must be configured')
          return {
            status: 500,
            message: 'Service configuration error',
          } as HandlerError
        }

        const creatorAid = generateAid(creatorDid, ctx.aidSalt)

        // Normalize the target URI to resolve handles to DIDs for consistency
        let normalizedTargetUri: string
        try {
          normalizedTargetUri = await normalizeAtUri(input.body.uri, ctx)
        } catch (error) {
          log.error(
            {
              targetUri: input.body.uri,
              error: error instanceof Error ? error.message : 'Unknown error',
              creatorDid,
            },
            'Failed to normalize target URI for createProposal',
          )
          throw new InvalidRequestError(
            error instanceof Error
              ? error.message
              : 'Failed to normalize target URI',
            'InvalidTarget',
          )
        }

        log.info(
          {
            creatorDid,
            creatorAid,
            targetUri: input.body.uri,
            normalizedTargetUri:
              normalizedTargetUri !== input.body.uri
                ? normalizedTargetUri
                : undefined,
          },
          'Community Notes: createProposal request authenticated',
        )

        // Validate target URI (only for AT Protocol URIs) - use normalized URI
        const validationResult = await validateTargetUri(
          normalizedTargetUri,
          ctx,
        )
        if (!validationResult.valid) {
          log.warn(
            {
              targetUri: input.body.uri,
              error: validationResult.error,
              creatorDid,
            },
            'Target URI validation failed',
          )
          return {
            status: 400,
            error: 'InvalidTarget',
            message: validationResult.error || 'Target URI is not accessible',
          } as HandlerError
        }

        // Check if user has sufficient writing impact score
        const hasPermission = await ctx.auth.checkRatingImpactScore(
          creatorDid,
          'create_note',
        )
        if (!hasPermission) {
          log.warn(
            {
              creatorDid,
              creatorAid,
              targetUri: input.body.uri,
            },
            'Insufficient writing impact score',
          )
          return {
            status: 403,
            error: 'InsufficientPermissions',
            message: 'User does not have sufficient writing impact score',
          } as HandlerError
        }

        // FUTURE: Validate target URI exists and is accessible via PDS

        // Check for duplicate notes by this user for this target with same label - use normalized URI
        const existingNote = await findExistingProposalByUser(
          ctx.db!,
          creatorAid,
          normalizedTargetUri,
          input.body.val,
          input.body.cid,
        )
        if (existingNote) {
          log.warn(
            {
              creatorDid,
              creatorAid,
              targetUri: input.body.uri,
              label: input.body.val,
              existingNoteUri: existingNote.uri,
            },
            'User already has a proposal with this label for this subject',
          )
          return {
            status: 409,
            error: 'DuplicateProposal',
            message: `You have already created a "${input.body.val}" proposal for this subject`,
          } as HandlerError
        }

        // Validate input
        if (!input.body.typ || input.body.typ !== 'label') {
          return {
            status: 400,
            error: 'InvalidTarget',
            message: 'Only label proposals are currently supported',
          } as HandlerError
        }

        if (!input.body.note || input.body.note.trim().length === 0) {
          return {
            status: 400,
            error: 'InvalidTarget',
            message: 'Note text is required and cannot be empty',
          } as HandlerError
        }

        if (input.body.note.length > 500) {
          return {
            status: 400,
            error: 'InvalidTarget',
            message: 'Note text cannot exceed 500 characters',
          } as HandlerError
        }

        // // Create the AT Protocol record - use normalized URI
        // const proposalRecord = await createProposalRecord(
        //   ctx,
        //   {
        //     ...input.body,
        //     uri: normalizedTargetUri,
        //   },
        //   creatorAid,
        // )

        // Store proposal in local database

        // Create AT Protocol record via PDS using service account authentication
        const now = new Date().toISOString()
        const rkey = `proposal_${Date.now()}_${Math.random()
          .toString(36)
          .substring(2, 8)}`

        const proposalRecord = {
          $type: 'social.pmsky.proposal',
          typ: input.body.typ,
          src: ctx.repoAccount.did, // Repository account DID (validated above)
          uri: normalizedTargetUri,
          ...(input.body.cid && { cid: input.body.cid }), // Only include cid if provided
          val: input.body.val,
          note: input.body.note,
          reasons: input.body.reasons || [],
          aid: creatorAid,
          cts: now,
        }

        const putResult = await putRecord(ctx, {
          collection: 'social.pmsky.proposal',
          rkey,
          record: proposalRecord,
        })

        if (!putResult.success || !putResult.uri) {
          throw new Error('Failed to create proposal record')
        }

        // Create auto-rating (author rates their own proposal as helpful)
        const autoRatingResult = await vote(ctx, {
          raterAid: creatorAid,
          proposalUri: putResult.uri,
          val: 1, // Helpful
          reasons: [
            'cites_high_quality_sources',
            'is_clear',
            'addresses_claim',
            'provides_important_context',
            'is_unbiased',
          ],
        })

        // Background sync operations (non-blocking)
        syncToPds(ctx).catch((error) =>
          log.error(
            { error },
            'Background PDS sync failed after proposal creation',
          ),
        )

        await ctx.notesService.syncPendingLabels()

        log.info(
          {
            creatorDid,
            creatorAid,
            targetUri: input.body.uri,
            proposalUri: putResult.uri,
            proposalCid: putResult.cid,
            autoRatingSuccess: autoRatingResult.success,
          },
          'Community Notes: Note and auto-rating created successfully',
        )

        // Note: Proposal initialization is now handled by the separate scoring service
        // The scoring service will detect new proposals and create initial status events

        // Format response
        const response = formatCreateProposalResponse(
          {
            uri: putResult.uri,
            cid: putResult.cid,
            record: proposalRecord,
          },
          creatorAid,
        )

        return {
          encoding: 'application/json',
          body: response,
          headers: resHeaders({}),
        } as HandlerSuccess
      },
      { endpoint: 'org.opencommunitynotes.propose' },
    ),
  })
}

// Helper function to format the response
function formatCreateProposalResponse(recordData: any, creatorAid: string) {
  const proposal = recordData.record

  return {
    uri: recordData.uri,
    cid: recordData.cid,
    proposal: {
      uri: recordData.uri,
      cid: recordData.cid,
      author: {
        aid: creatorAid,
        pseudonym: generatePseudonymFromAid(creatorAid),
      },
      typ: proposal.typ,
      targetUri: proposal.uri,
      targetCid: proposal.cid,
      val: proposal.val,
      note: proposal.note,
      reasons: proposal.reasons,
      cts: proposal.cts,
      status: 'needs_more_ratings' as const,
    },
  }
}
