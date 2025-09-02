import { AuthService } from './auth'
import { ServiceAccount } from './config'
import { Database } from './db'
import { ProposalRating, ProposalsHydrator } from './hydration/community-notes'
import { HydrationMap } from './hydration/util'
import { HydrationState, Views } from './views'

export interface AppContext {
  hydrator: Hydrator
  views: Views
  auth: AuthService
  db: Database
  repoAccount: ServiceAccount // Repository account for all records (proposals, votes, feed records)
  feedGeneratorDid?: string // Feed generator DID (for backward compatibility)
  pdsUrl: string // PDS URL for AT Protocol record creation
  syncVotesToPds: boolean // Enable syncing vote records to PDS
  reqLabelers: () => Record<string, any>
  config: any // Configuration object to avoid circular imports
}

export class Hydrator {
  public proposals: ProposalsHydrator

  constructor(db: Database) {
    this.proposals = new ProposalsHydrator(db)
  }

  async hydrateProposals(
    uri: string,
    scoresDb: any, // ScoresDatabase type to avoid circular imports
    serviceDid: string,
    servicePrivateKey: any,
    raterDid?: string,
    limit?: number,
  ): Promise<HydrationState> {
    const proposals = await this.proposals.getProposals(uri, scoresDb, limit)
    const proposalUris = [...proposals.keys()]

    let proposalRatings = new HydrationMap<ProposalRating>()

    if (raterDid) {
      proposalRatings = await this.proposals.getProposalRatingsByActor(
        proposalUris,
        raterDid,
        servicePrivateKey,
      )
    }

    // Apply ordering: unrated proposals first, then by score descending
    const orderedProposals = new HydrationMap<any>()

    // Convert to array for sorting
    const proposalArray = [...proposals.entries()].map(([uri, proposal]) => ({
      uri,
      proposal,
      hasUserRating: proposalRatings.has(uri),
      score: proposal.score || 0,
    }))

    // Sort by: 1) unrated first, 2) score descending
    proposalArray.sort((a, b) => {
      // First priority: unrated proposals come first
      if (a.hasUserRating !== b.hasUserRating) {
        return a.hasUserRating ? 1 : -1 // false (unrated) comes before true (rated)
      }

      // Second priority: higher score comes first
      return b.score - a.score
    })

    // Rebuild the ordered map
    for (const item of proposalArray) {
      orderedProposals.set(item.uri, item.proposal)
    }

    return {
      proposals: orderedProposals,
      proposalRatings: proposalRatings,
    }
  }
}
