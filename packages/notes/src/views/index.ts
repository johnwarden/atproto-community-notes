import { mapDefined } from '@atproto/common'
import { ProposalView } from './types'

export type HydrationState = {
  proposals: Map<string, any>
  proposalRatings: Map<string, any>
}

export class Views {
  proposal(hydrationState: HydrationState): ProposalView[] {
    const { proposals, proposalRatings } = hydrationState

    return mapDefined([...proposals.keys()], (proposalUri) => {
      const proposal = proposals.get(proposalUri)
      if (!proposal) return undefined

      const rating = proposalRatings.get(proposalUri)

      return {
        uri: proposal.uri,
        cid: proposal.cid,
        author: {
          aid: proposal.author.aid,
          pseudonym: proposal.author.pseudonym,
        },
        typ: proposal.typ,
        targetUri: proposal.targetUri,
        val: proposal.val,
        reasons: proposal.reasons,
        note: proposal.note,
        cts: proposal.cts,
        status: proposal.status,
        score: proposal.score,
        ...(rating && {
          viewer: {
            rating: {
              val: rating.val,
              reasons: rating.reasons,
              uri: rating.uri,
              createdAt: rating.createdAt,
              updatedAt: rating.updatedAt,
            },
          },
        }),
      }
    })
  }
}
