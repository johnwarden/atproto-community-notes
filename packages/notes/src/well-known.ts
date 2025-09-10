import express from 'express'
import { AppContext } from './context'
import { asyncHandler } from './middleware/error-handling'

export default function wellKnown(app: express.Application, ctx: AppContext) {
  // getFeedSkeleton endpoint - use direct Express route
  app.get(
    '/.well-known/did.json',
    asyncHandler(async (_req, res) => {
      // if (!ctx.repoAccount.did.endsWith(ctx.feedgenDocumentDid)) {
      //   return res.sendStatus(404)
      // }
      res.json({
        '@context': ['https://www.w3.org/ns/did/v1'],
        id: ctx.feedgenDocumentDid,
        service: [
          {
            id: '#bsky_fg',
            type: 'BskyFeedGenerator',
            serviceEndpoint: `http://localhost:${ctx.config.port}`,
            // serviceEndpoint: `https://${ctx.hostname}`,
          },
        ],
      })
    }),
  )
}
