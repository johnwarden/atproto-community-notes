import { AppContext } from '../../../context'
import { Server } from '../../../lexicon'
import { httpLogger as log } from '../../../logger'

export default function (server: Server, ctx: AppContext) {
  server.org.opencommunitynotes.getConfig({
    handler: async () => {
      try {
        // Validate that required configuration is available
        if (!ctx.repoAccount?.did) {
          log.error('Repository account DID not configured')
          return {
            status: 500,
            message: 'Service configuration error: missing repository DID',
          }
        }

        if (!ctx.config.labeler.did) {
          log.error('Labeler DID not configured')
          return {
            status: 500,
            message: 'Service configuration error: missing labeler DID',
          }
        }

        const config = {
          version: new Date().toISOString(),
          labelerDid: ctx.config.labeler.did,
          feedGeneratorDid: ctx.repoAccount.did,
        }

        log.info(
          {
            labelerDid: config.labelerDid,
            feedGeneratorDid: config.feedGeneratorDid,
            version: config.version,
          },
          'Community Notes: getConfig request served',
        )

        return {
          encoding: 'application/json' as const,
          body: config,
        }
      } catch (error) {
        log.error({ error }, 'Failed to get Community Notes configuration')
        return {
          status: 500,
          message: 'Internal server error',
        }
      }
    },
  })
}
