import { sql } from 'kysely'
import { Database } from '../db'
import {
  findRecordsByTargetUri,
  findVotesByProposalsAndVoter,
} from '../db/record-utils'
import { httpLogger as log } from '../logger'
import { generateAid, generatePseudonymFromAid } from '../utils'
import { HydrationMap } from './util'

export type Proposal = {
  uri: string
  cid: string
  author: {
    aid: string
    pseudonym: string
  }
  typ: string
  targetUri: string
  targetCid?: string
  val: string
  reasons?: string[]
  note: string
  cts: string
  status: 'needs_more_ratings' | 'rated_helpful' | 'rated_not_helpful'
  score?: number
}

export type ProposalRating = {
  uri?: string
  val: number // Changed to number for +1, 0, -1
  reasons?: string[]
  createdAt: string
  updatedAt?: string
}

export type Proposals = HydrationMap<Proposal>
export type ProposalRatings = HydrationMap<ProposalRating>

export class ProposalsHydrator {
  constructor(private db: Database) {}

  async getProposals(
    uri: string,
    scoresDb: any, // ScoresDatabase type to avoid circular imports
    limit?: number,
  ): Promise<Proposals> {
    // First try to get real proposals from database
    let realProposals: Proposal[] = []

    if (this.db) {
      try {
        // Single JOIN query to get proposals with their scores
        const proposalsWithScores = await this.db.db
          .selectFrom('record')
          .leftJoin('score', 'score.proposalUri', 'record.uri')
          .selectAll('record')
          .select(['score.status', 'score.score'])
          .where('record.collection', '=', 'social.pmsky.proposal')
          .where(sql`json_extract(record.record, '$.uri')`, '=', uri)
          .orderBy('record.indexedAt', 'desc')
          .limit(limit || 50)
          .execute()

        realProposals = proposalsWithScores.map((row) => {
          // The row contains all record fields plus score.status and score.score
          return this.dbRecordToProposal(
            row, // Pass the full row which has all record fields
            row.status || undefined,
            row.score || undefined,
          )
        })
      } catch (error) {
        log.warn({ error }, 'Failed to query database for proposals')
        // Continue to fallback
      }
    }

    // Return real proposals from database (no mock data fallback)
    return realProposals.reduce((acc, proposal) => {
      return acc.set(proposal.uri, proposal)
    }, new HydrationMap<Proposal>())
  }

  /**
   * Convert a database record to Proposal format
   */
  private dbRecordToProposal(
    dbRecord: any,
    status?: string,
    score?: number,
  ): Proposal {
    const record = JSON.parse(dbRecord.record) // The JSON record data

    return {
      uri: dbRecord.uri, // AT Protocol URI of the proposal record
      cid: dbRecord.cid, // AT Protocol CID of the proposal record
      author: {
        aid: record.aid,
        pseudonym: generatePseudonymFromAid(record.aid),
      },
      typ: record.typ,
      targetUri: record.uri, // URI of content being annotated (from record.uri field)
      targetCid: record.cid, // Optional CID of content being annotated
      val: record.val,
      reasons: record.reasons || [],
      note: record.note,
      cts: record.cts,
      status:
        (status as
          | 'needs_more_ratings'
          | 'rated_helpful'
          | 'rated_not_helpful') || 'needs_more_ratings',
      score: score,
    }
  }

  /**
   * Get ratings by rater's anonymous ID (AID)
   * First tries database, then falls back to mock data
   */
  async getProposalRatingsByAid(
    proposalUris: string[],
    raterAid: string,
  ): Promise<ProposalRatings> {
    if (!proposalUris.length || !raterAid) {
      return new HydrationMap<ProposalRating>()
    }

    // First try to get real votes from database
    let dbRatings: any[] = []
    // Look for vote records (includes both auto-ratings and manual ratings)
    dbRatings = await findVotesByProposalsAndVoter(
      this.db,
      proposalUris,
      raterAid,
    )
    log.debug(
      {
        proposalUris,
        raterAid,
        dbRatingsCount: dbRatings.length,
        dbRatings: dbRatings.map((r) => ({
          uri: r.uri,
          collection: r.collection,
          record: JSON.parse(r.record),
        })),
      },
      'Found vote records for rating hydration',
    )

    // Convert database records to ProposalRating format
    const result = new HydrationMap<ProposalRating>()

    for (const dbRecord of dbRatings) {
      const voteRecord = JSON.parse(dbRecord.record)
      const proposalRating: ProposalRating = {
        uri: dbRecord.uri,
        val: voteRecord.val,
        reasons: voteRecord.reasons || [],
        createdAt: voteRecord.cts,
        updatedAt: dbRecord.indexedAt,
      }
      result.set(voteRecord.uri, proposalRating) // voteRecord.uri is the proposal URI being voted on
    }

    return result
  }

  /**
   * Get ratings by rater's DID (converts to AID internally)
   * This is used when we have the user's DID from authentication
   */
  async getProposalRatingsByActor(
    proposalUris: string[],
    raterDid: string,
    servicePrivateKey: any,
  ): Promise<ProposalRatings> {
    if (!proposalUris.length || !raterDid) {
      return new HydrationMap<ProposalRating>()
    }

    // Use verifiable AID generation if service parameters are provided
    const raterAid = generateAid(raterDid, servicePrivateKey)
    return this.getProposalRatingsByAid(proposalUris, raterAid)
  }
}
