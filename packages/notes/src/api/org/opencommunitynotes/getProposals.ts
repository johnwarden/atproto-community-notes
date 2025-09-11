import { AuthRequiredError, InvalidRequestError } from '@atproto/xrpc-server'
import { AppContext } from '../../../context'
import { getHydratedProposals } from '../../../db/proposals'
import { Server } from '../../../lexicon'
import { httpLogger as log } from '../../../logger'
import { generateAid, normalizeAtUri } from '../../../utils'
import { resHeaders } from '../../util'

export default function (server: Server, ctx: AppContext) {
  server.org.opencommunitynotes.getProposals({
    handler: async ({ params, req }) => {
      const { uris, limit, status, label } = params

      // Validate input
      if (!uris || uris.length === 0) {
        throw new InvalidRequestError('At least one URI is required')
      }

      if (uris.length > 100) {
        throw new InvalidRequestError('Maximum 100 URIs allowed')
      }

      // Check if limit was explicitly provided in the request
      // If not provided, we'll use undefined to allow random count generation
      const explicitLimit = req.url?.includes('limit=') ? limit : undefined

      // Require authentication
      const authHeader = req.headers?.authorization
      if (!authHeader) {
        throw new AuthRequiredError('Authorization header is required')
      }

      const authResult = await ctx.auth.verifyBearerToken(authHeader)
      if (!authResult.success || !authResult.did) {
        throw new AuthRequiredError(authResult.error || 'Invalid token')
      }

      const viewerDid = authResult.did

      // Validate repository account configuration
      if (!ctx.repoAccount?.did || !ctx.aidSalt) {
        throw new AuthRequiredError('Notes service configuration error')
      }

      const viewerAid = generateAid(viewerDid, ctx.aidSalt)

      log.info(
        {
          uriCount: uris.length,
          firstUri: uris[0],
          limit,
          status,
          label,
          viewerDid,
          viewerAid,
        },
        'Community Notes: getProposals request received (authenticated)',
      )

      // Process each URI to get proposals
      const subjects = await Promise.all(
        uris.map(async (uri) => {
          try {
            // Normalize the URI to resolve handles to DIDs for consistent database queries
            let normalizedUri: string
            try {
              normalizedUri = await normalizeAtUri(uri, ctx)
            } catch (error) {
              log.warn(
                {
                  uri,
                  error:
                    error instanceof Error ? error.message : 'Unknown error',
                },
                'Failed to normalize URI in getProposals, using original',
              )
              normalizedUri = uri
            }

            // Get hydrated proposals with single optimized query
            const proposals = await getHydratedProposals(ctx, {
              targetUri: normalizedUri,
              viewerAid,
              status,
              label,
              limit: explicitLimit,
            })

            return proposals
          } catch (error) {
            log.error(
              {
                uri,
                error: error instanceof Error ? error.message : 'Unknown error',
              },
              'Error processing URI in getProposals',
            )

            // Return empty array for this subject on error
            return []
          }
        }),
      )

      // Flatten the array of arrays into a single array of proposals
      const allProposals = subjects.flat()

      // Debug logging for response
      log.info(
        {
          uriCount: uris.length,
          totalProposals: allProposals.length,
          status,
          label,
          viewerDid,
          viewerAid,
        },
        'Community Notes: getProposals response prepared',
      )

      return {
        encoding: 'application/json' as const,
        body: {
          proposals: allProposals,
        },
        headers: resHeaders({}),
      }
    },
  })
}
