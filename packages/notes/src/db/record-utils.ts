import { sql } from 'kysely'
import { CID } from 'multiformats/cid'
import { AtUri } from '@atproto/syntax'
import type { AppContext } from '../context'
import { httpLogger as log } from '../logger'
import { createAuthenticatedPdsAgent, generateVoteRkey } from '../utils'
import type { Database } from './index'

/**
 * Record utility class inspired by Bsky's RecordProcessor
 * Simplified for Community Notes use cases
 */
export class RecordUtils {
  constructor(private db: Database) {}

  /**
   * Insert a record into the generic record table
   * Handles conflicts with do-nothing strategy (like Bsky)
   */
  async insertRecord(
    uri: AtUri,
    cid: CID,
    record: object,
    opts?: {
      did?: string
      collection?: string
      rkey?: string
      timestamp?: string
    },
  ): Promise<void> {
    const timestamp = opts?.timestamp || new Date().toISOString()

    await this.db.db
      .insertInto('record')
      .values({
        uri: uri.toString(),
        cid: cid.toString(),
        did: opts?.did || uri.host,
        collection: opts?.collection || uri.collection,
        rkey: opts?.rkey || uri.rkey,
        record: JSON.stringify(record), // JSON as string in SQLite
        indexedAt: timestamp,
      })
      .onConflict((oc) => oc.column('uri').doNothing()) // Bsky pattern: ignore duplicates
      .execute()
  }

  /**
   * Update a record (Bsky's simple strategy: replace by URI)
   */
  async updateRecord(
    uri: AtUri,
    cid: CID,
    record: object,
    timestamp?: string,
  ): Promise<void> {
    const indexedAt = timestamp || new Date().toISOString()

    await this.db.db
      .updateTable('record')
      .where('uri', '=', uri.toString())
      .set({
        cid: cid.toString(),
        record: JSON.stringify(record),
        indexedAt,
      })
      .execute()
  }

  /**
   * Delete a record by URI
   * Returns true if a record was actually deleted, false if no record was found
   */
  async deleteRecord(uri: AtUri): Promise<boolean> {
    const result = await this.db.db
      .deleteFrom('record')
      .where('uri', '=', uri.toString())
      .execute()
    
    // Check if any rows were affected
    return result.length > 0 && result[0].numDeletedRows > 0
  }

  /**
   * Find records by target URI (for Community Notes)
   * Uses our optimized index for JSON queries
   */
  async findRecordsByTargetUri(
    targetUri: string,
    collection = 'social.pmsky.proposal',
    limit = 50,
  ) {
    return await this.db.db
      .selectFrom('record')
      .selectAll()
      .where('collection', '=', collection)
      .where(sql`json_extract(record, '$.uri')`, '=', targetUri)
      .orderBy('indexedAt', 'desc')
      .limit(limit)
      .execute()
  }

  /**
   * Check for existing record by AID, target URI, and label (duplicate prevention)
   * Uses our unique constraint for performance and integrity
   */
  async findExistingProposalByUser(
    creatorAid: string,
    targetUri: string,
    label: string,
    targetCid?: string,
    collection = 'social.pmsky.proposal',
  ) {
    // Check for existing proposal by user with same label

    let query = this.db.db
      .selectFrom('record')
      .select(['uri'])
      .where('collection', '=', collection)
      .where(sql`json_extract(record, '$.uri')`, '=', targetUri)
      .where(sql`json_extract(record, '$.aid')`, '=', creatorAid)
      .where(sql`json_extract(record, '$.val')`, '=', label)

    if (targetCid) {
      query = query.where(sql`json_extract(record, '$.cid')`, '=', targetCid)
    }

    const result = await query.limit(1).executeTakeFirst()

    // Duplicate check completed

    return result
  }

  /**
   * Get all records for a specific DID
   */
  async getRecordsByDid(did: string) {
    return await this.db.db
      .selectFrom('record')
      .selectAll()
      .where('did', '=', did)
      .orderBy('indexedAt', 'desc')
      .execute()
  }

  /**
   * Get a single record by URI
   */
  async getRecordByUri(uri: string) {
    return await this.db.db
      .selectFrom('record')
      .selectAll()
      .where('uri', '=', uri)
      .executeTakeFirst()
  }

  /**
   * Find existing vote record by voter AID and note URI
   * Returns the vote record if it exists
   */
  async findExistingVoteByUser(
    voterAid: string,
    proposalUri: string,
    collection = 'social.pmsky.vote',
  ) {
    return await this.db.db
      .selectFrom('record')
      .selectAll()
      .where('collection', '=', collection)
      .where(sql`json_extract(record, '$.uri')`, '=', proposalUri)
      .where(sql`json_extract(record, '$.aid')`, '=', voterAid)
      .limit(1)
      .executeTakeFirst()
  }

  /**
   * Get a specific vote record by service DID, voter AID, and proposal URI
   * Used for fetching vote details after creation
   */
  async getVoteRecord(
    serviceDid: string,
    voterAid: string,
    proposalUri: string,
  ) {
    const rkey = generateVoteRkey(voterAid, proposalUri)
    const uri = `at://${serviceDid}/social.pmsky.vote/${rkey}`

    return await this.db.db
      .selectFrom('record')
      .selectAll()
      .where('uri', '=', uri)
      .executeTakeFirst()
  }

  /**
   * Create or update a vote record in the database
   * Uses deterministic rkey to ensure one vote per user per proposal
   */
  async createOrUpdateVoteRecord(
    serviceDid: string,
    voterAid: string,
    proposalUri: string,
    val: number,
    reasons: string[] = [],
    proposalCid?: string,
  ) {
    const now = new Date().toISOString()
    const rkey = generateVoteRkey(voterAid, proposalUri)

    // Create the vote record according to the lexicon schema
    const voteRecord: any = {
      $type: 'social.pmsky.vote',
      src: serviceDid,
      uri: proposalUri,
      val,
      reasons,
      aid: voterAid,
      cts: now,
    }

    // Only include cid if it's defined (CBOR doesn't support undefined values)
    if (proposalCid !== undefined) {
      voteRecord.cid = proposalCid
    }

    // Calculate the CID for the record (matches PDS cidForSafeRecord behavior)
    const common = await import('@atproto/common')
    const ipldRecord = common.jsonToIpld(voteRecord)
    const recordCid = await common.cidForCbor(ipldRecord)

    // Generate the AT Protocol URI (even though we're not saving to PDS)
    const voteUri = `at://${serviceDid}/social.pmsky.vote/${rkey}`

    const dbRecord = {
      uri: voteUri,
      cid: recordCid.toString(),
      did: serviceDid,
      collection: 'social.pmsky.vote',
      rkey,
      record: JSON.stringify(voteRecord),
      indexedAt: now,
    }

    // Use upsert pattern: try insert, then update on conflict
    await this.db.db
      .insertInto('record')
      .values(dbRecord)
      .onConflict((oc) =>
        oc.column('uri').doUpdateSet({
          cid: recordCid.toString(),
          record: JSON.stringify(voteRecord),
          indexedAt: now,
        }),
      )
      .execute()

    return {
      uri: voteUri,
      cid: recordCid.toString(),
      rkey,
      record: JSON.stringify(voteRecord), // Return JSON string to match database storage
      indexedAt: now,
    }
  }

  /**
   * Delete a vote record by voter AID and proposal URI
   */
  async deleteVoteRecord(
    serviceDid: string,
    voterAid: string,
    proposalUri: string,
  ): Promise<boolean> {
    const rkey = generateVoteRkey(voterAid, proposalUri)
    const voteUri = `at://${serviceDid}/social.pmsky.vote/${rkey}`

    const result = await this.db.db
      .deleteFrom('record')
      .where('uri', '=', voteUri)
      .executeTakeFirst()

    return (result.numDeletedRows ?? 0) > 0
  }

  /**
   * Find vote records by proposal URIs and voter AID
   * Used for hydration - gets user's votes on specific proposals
   */
  async findVotesByProposalsAndVoter(
    proposalUris: string[],
    voterAid: string,
    collection = 'social.pmsky.vote',
  ) {
    if (!proposalUris.length || !voterAid) {
      return []
    }

    const results = await this.db.db
      .selectFrom('record')
      .selectAll()
      .where('collection', '=', collection)
      .where(sql`json_extract(record, '$.uri')`, 'in', proposalUris)
      .where(sql`json_extract(record, '$.aid')`, '=', voterAid)
      .execute()

    // Debug logging
    log.info(
      {
        proposalUris,
        voterAid,
        collection,
        resultsCount: results.length,
        results: results.map((r) => ({
          uri: r.uri,
          collection: r.collection,
          recordData: JSON.parse(r.record),
        })),
      },
      'DEBUG findVotesByProposalsAndVoter query results',
    )

    return results
  }

  /**
   * Check if a proposal exists in the database
   * Used for vote validation
   */
  async proposalExistsInDb(
    proposalUri: string,
    collection = 'social.pmsky.proposal',
  ): Promise<boolean> {
    const result = await this.db.db
      .selectFrom('record')
      .select(['uri'])
      .where('collection', '=', collection)
      .where('uri', '=', proposalUri)
      .limit(1)
      .executeTakeFirst()

    return !!result
  }

  /**
   * Validate the CID of a vote record
   * Useful for data integrity checks
   */
  async validateVoteRecordCid(voteRecordUri: string): Promise<{
    valid: boolean
    expectedCid?: string
    actualCid?: string
    error?: string
  }> {
    try {
      const dbRecord = await this.db.db
        .selectFrom('record')
        .selectAll()
        .where('uri', '=', voteRecordUri)
        .where('collection', '=', 'social.pmsky.vote')
        .limit(1)
        .executeTakeFirst()

      if (!dbRecord) {
        return { valid: false, error: 'Vote record not found' }
      }

      const common = await import('@atproto/common')
      const recordData = JSON.parse(dbRecord.record)
      const ipldRecord = common.jsonToIpld(recordData)
      const expectedCid = (await common.cidForCbor(ipldRecord)).toString()
      const actualCid = dbRecord.cid

      return {
        valid: expectedCid === actualCid,
        expectedCid,
        actualCid,
        error: expectedCid !== actualCid ? 'CID mismatch' : undefined,
      }
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Unified record management function that handles both DB storage and optional PDS sync
   * This replaces the separate manageRecord function and consolidates record operations
   */
  async putRecord(
    ctx: AppContext,
    params: {
      collection: string
      rkey: string
      record?: any // undefined = delete
      syncToPds?: boolean
    },
  ): Promise<{ success: boolean; uri?: string; cid?: string }> {
    const { collection, rkey, record, syncToPds = false } = params

    if (!ctx.repoAccount?.did) {
      throw new Error('Repository account DID must be configured')
    }

    const serviceDid = ctx.repoAccount.did

    try {
      if (record === undefined) {
        // Delete operation
        const uri = `at://${serviceDid}/${collection}/${rkey}`

        // Delete from local DB
        const wasDeleted = await this.deleteRecord(new AtUri(uri))

        if (!wasDeleted) {
          // No record was found to delete
          return { success: false }
        }

        // Delete from PDS if sync enabled
        if (syncToPds) {
          const { agent, serviceRepoId } =
            await createAuthenticatedPdsAgent(ctx)
          await agent.com.atproto.repo.deleteRecord({
            repo: serviceRepoId,
            collection,
            rkey,
          })

          log.info(
            { uri, collection, rkey },
            'Record deleted from both DB and PDS',
          )
        } else {
          log.info({ uri, collection, rkey }, 'Record deleted from DB only')
        }

        return { success: true }
      } else {
        // Create/update operation
        const uri = `at://${serviceDid}/${collection}/${rkey}`
        const atUri = new AtUri(uri)

        // Calculate CID for the record (generic for all record types)
        const common = await import('@atproto/common')
        const ipldRecord = common.jsonToIpld(record)
        const cidObj = await common.cidForCbor(ipldRecord)

        // Store in local DB
        await this.insertRecord(atUri, cidObj, record, {
          did: serviceDid,
          collection,
          rkey,
        })

        // Sync to PDS if enabled
        if (syncToPds) {
          const { agent, serviceRepoId } =
            await createAuthenticatedPdsAgent(ctx)


          const { data } = await agent.com.atproto.repo.putRecord({
            repo: serviceRepoId,
            collection,
            rkey,
            record,
          })

          log.info(
            { uri: data.uri, cid: data.cid, collection, rkey },
            'Record stored in both DB and PDS',
          )

          return { success: true, uri: data.uri, cid: data.cid }
        } else {
          log.info(
            { uri, cid: cidObj.toString(), collection, rkey },
            'Record stored in DB only',
          )
          return { success: true, uri, cid: cidObj.toString() }
        }
      }
    } catch (error) {
      log.error(
        {
          collection,
          rkey,
          record: record,
          syncToPds,
          error: error instanceof Error ? error.message : error,
        },
        'Failed to put record',
      )

      throw new Error(
        `Failed to put record: ${error instanceof Error ? error.message : 'Unknown error'}`,
      )
    }
  }

  /**
   * Insert/delete vote record and sync to PDS (if enabled)
   */
  async vote(
    ctx: AppContext,
    params: {
      raterAid: string
      proposalUri: string
      val?: number // undefined = delete
      reasons?: string[]
    },
  ): Promise<{ success: boolean }> {
    const { raterAid, proposalUri, val, reasons = [] } = params

    if (!ctx.repoAccount?.did) {
      throw new Error('Repository account DID must be configured')
    }

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

    const result = await this.putRecord(ctx, {
      collection: 'social.pmsky.vote',
      rkey,
      record: val === undefined ? undefined : voteRecord,
      syncToPds: ctx.syncVotesToPds,
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
        syncToPds: ctx.syncVotesToPds,
      },
      'Vote operation completed successfully',
    )

    return { success: true }
  }
}
