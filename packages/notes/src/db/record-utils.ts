import { sql } from 'kysely'
import { CID } from 'multiformats/cid'
import { AtUri } from '@atproto/syntax'
import { enableSyncToPds } from '../config'
import type { AppContext } from '../context'
import { httpLogger as log } from '../logger'
import { getOrCreatePdsAgent, generateVoteRkey } from '../utils'
import type { Database } from './index'

/**
 * Insert a record into the generic record table
 * Handles conflicts with do-nothing strategy (like Bsky)
 */
export async function insertRecord(
  db: Database,
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

  await db.db
    .insertInto('record')
    .values({
      uri: uri.toString(),
      cid: cid.toString(),
      did: opts?.did || uri.host,
      collection: opts?.collection || uri.collection,
      rkey: opts?.rkey || uri.rkey,
      record: JSON.stringify(record), // JSON as string in SQLite
      indexedAt: timestamp,
      syncedToPds: 0, // New records are not synced to PDS yet
    })
    .onConflict((oc) => oc.column('uri').doNothing()) // Bsky pattern: ignore duplicates
    .execute()
}

// /**
//  * Update a record (Bsky's simple strategy: replace by URI)
//  */
// export async function updateRecord(
//   db: Database,
//   uri: AtUri,
//   cid: CID,
//   record: object,
//   timestamp?: string,
// ): Promise<void> {
//   const indexedAt = timestamp || new Date().toISOString()

//   await db.db
//     .updateTable('record')
//     .where('uri', '=', uri.toString())
//     .set({
//       cid: cid.toString(),
//       record: JSON.stringify(record),
//       indexedAt,
//     })
//     .execute()
// }

/**
 * Delete a record by URI
 * Returns true if a record was actually deleted, false if no record was found
 */
export async function deleteRecord(db: Database, uri: AtUri): Promise<boolean> {
  const result = await db.db
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
export async function findRecordsByTargetUri(
  db: Database,
  targetUri: string,
  collection = 'social.pmsky.proposal',
  limit = 50,
) {
  return await db.db
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
export async function findExistingProposalByUser(
  db: Database,
  creatorAid: string,
  targetUri: string,
  label: string,
  targetCid?: string,
  collection = 'social.pmsky.proposal',
) {
  // Check for existing proposal by user with same label

  let query = db.db
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

// /**
//  * Get all records for a specific DID
//  */
// export async function getRecordsByDid(db: Database, did: string) {
//   return await db.db
//     .selectFrom('record')
//     .selectAll()
//     .where('did', '=', did)
//     .orderBy('indexedAt', 'desc')
//     .execute()
// }

// /**
//  * Get a single record by URI
//  */
// export async function getRecordByUri(db: Database, uri: string) {
//   return await db.db
//     .selectFrom('record')
//     .selectAll()
//     .where('uri', '=', uri)
//     .executeTakeFirst()
// }

// /**
//  * Find existing vote record by voter AID and note URI
//  * Returns the vote record if it exists
//  */
// export async function findExistingVoteByUser(
//   db: Database,
//   voterAid: string,
//   proposalUri: string,
//   collection = 'social.pmsky.vote',
// ) {
//   return await db.db
//     .selectFrom('record')
//     .selectAll()
//     .where('collection', '=', collection)
//     .where(sql`json_extract(record, '$.uri')`, '=', proposalUri)
//     .where(sql`json_extract(record, '$.aid')`, '=', voterAid)
//     .limit(1)
//     .executeTakeFirst()
// }

/**
 * Get a specific vote record by service DID, voter AID, and proposal URI
 * Used for fetching vote details after creation
 */
export async function getVoteRecord(
  db: Database,
  serviceDid: string,
  voterAid: string,
  proposalUri: string,
) {
  const rkey = generateVoteRkey(voterAid, proposalUri)
  const uri = `at://${serviceDid}/social.pmsky.vote/${rkey}`

  return await db.db
    .selectFrom('record')
    .selectAll()
    .where('uri', '=', uri)
    .executeTakeFirst()
}

// /**
//  * Create or update a vote record in the database
//  * Uses deterministic rkey to ensure one vote per user per proposal
//  */
// export async function createOrUpdateVoteRecord(
//   db: Database,
//   serviceDid: string,
//   voterAid: string,
//   proposalUri: string,
//   val: number,
//   reasons: string[] = [],
//   proposalCid?: string,
// ) {
//   const now = new Date().toISOString()
//   const rkey = generateVoteRkey(voterAid, proposalUri)

//   // Create the vote record according to the lexicon schema
//   const voteRecord: any = {
//     $type: 'social.pmsky.vote',
//     src: serviceDid,
//     uri: proposalUri,
//     val,
//     reasons,
//     aid: voterAid,
//     cts: now,
//   }

//   // Only include cid if it's defined (CBOR doesn't support undefined values)
//   if (proposalCid !== undefined) {
//     voteRecord.cid = proposalCid
//   }

//   // Calculate the CID for the record (matches PDS cidForSafeRecord behavior)
//   const common = await import('@atproto/common')
//   const ipldRecord = common.jsonToIpld(voteRecord)
//   const recordCid = await common.cidForCbor(ipldRecord)

//   // Generate the AT Protocol URI (even though we're not saving to PDS)
//   const voteUri = `at://${serviceDid}/social.pmsky.vote/${rkey}`

//   const dbRecord = {
//     uri: voteUri,
//     cid: recordCid.toString(),
//     did: serviceDid,
//     collection: 'social.pmsky.vote',
//     rkey,
//     record: JSON.stringify(voteRecord),
//     indexedAt: now,
//   }

//   // Use upsert pattern: try insert, then update on conflict
//   await db.db
//     .insertInto('record')
//     .values(dbRecord)
//     .onConflict((oc) =>
//       oc.column('uri').doUpdateSet({
//         cid: recordCid.toString(),
//         record: JSON.stringify(voteRecord),
//         indexedAt: now,
//       }),
//     )
//     .execute()

//   return {
//     uri: voteUri,
//     cid: recordCid.toString(),
//     rkey,
//     record: JSON.stringify(voteRecord), // Return JSON string to match database storage
//     indexedAt: now,
//   }
// }

// /**
//  * Delete a vote record by voter AID and proposal URI
//  */
// export async function deleteVoteRecord(
//   db: Database,
//   serviceDid: string,
//   voterAid: string,
//   proposalUri: string,
// ): Promise<boolean> {
//   const rkey = generateVoteRkey(voterAid, proposalUri)
//   const voteUri = `at://${serviceDid}/social.pmsky.vote/${rkey}`

//   const result = await db.db
//     .deleteFrom('record')
//     .where('uri', '=', voteUri)
//     .executeTakeFirst()

//   return (result.numDeletedRows ?? 0) > 0
// }

/**
 * Find vote records by proposal URIs and voter AID
 * Used for hydration - gets user's votes on specific proposals
 */
export async function findVotesByProposalsAndVoter(
  db: Database,
  proposalUris: string[],
  voterAid: string,
  collection = 'social.pmsky.vote',
) {
  if (!proposalUris.length || !voterAid) {
    return []
  }

  const results = await db.db
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
export async function proposalExistsInDb(
  db: Database,
  proposalUri: string,
  collection = 'social.pmsky.proposal',
): Promise<boolean> {
  const result = await db.db
    .selectFrom('record')
    .select(['uri'])
    .where('collection', '=', collection)
    .where('uri', '=', proposalUri)
    .limit(1)
    .executeTakeFirst()

  return !!result
}

// /**
//  * Validate the CID of a vote record
//  * Useful for data integrity checks
//  */
// export async function validateVoteRecordCid(
//   db: Database,
//   voteRecordUri: string,
// ): Promise<{
//   valid: boolean
//   expectedCid?: string
//   actualCid?: string
//   error?: string
// }> {
//   try {
//     const dbRecord = await db.db
//       .selectFrom('record')
//       .selectAll()
//       .where('uri', '=', voteRecordUri)
//       .where('collection', '=', 'social.pmsky.vote')
//       .limit(1)
//       .executeTakeFirst()

//     if (!dbRecord) {
//       return { valid: false, error: 'Vote record not found' }
//     }

//     const common = await import('@atproto/common')
//     const recordData = JSON.parse(dbRecord.record)
//     const ipldRecord = common.jsonToIpld(recordData)
//     const expectedCid = (await common.cidForCbor(ipldRecord)).toString()
//     const actualCid = dbRecord.cid

//     return {
//       valid: expectedCid === actualCid,
//       expectedCid,
//       actualCid,
//       error: expectedCid !== actualCid ? 'CID mismatch' : undefined,
//     }
//   } catch (error) {
//     return {
//       valid: false,
//       error: error instanceof Error ? error.message : 'Unknown error',
//     }
//   }
// }

/**
 * Unified record management function that handles local DB storage only
 * PDS sync is handled separately by the syncToPds function
 */
export async function putRecord(
  ctx: AppContext,
  params: {
    collection: string
    rkey: string
    record?: any // undefined = delete
  },
): Promise<{ success: boolean; uri?: string; cid?: string }> {
  const { collection, rkey, record } = params

  if (!ctx.repoAccount?.did) {
    throw new Error('Repository account DID must be configured')
  }

  const serviceDid = ctx.repoAccount.did

  try {
    if (record === undefined) {
      // Delete operation
      const uri = `at://${serviceDid}/${collection}/${rkey}`

      // Delete from local DB
      const wasDeleted = await deleteRecord(ctx.db, new AtUri(uri))

      if (!wasDeleted) {
        // No record was found to delete
        return { success: false }
      }

      log.info({ uri, collection, rkey }, 'Record deleted from local DB')

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
      await insertRecord(ctx.db, atUri, cidObj, record, {
        did: serviceDid,
        collection,
        rkey,
      })

      log.info(
        { uri, cid: cidObj.toString(), collection, rkey },
        'Record stored in local DB',
      )
      return { success: true, uri, cid: cidObj.toString() }
    }
  } catch (error) {
    log.error(
      {
        collection,
        rkey,
        record: record,
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
 * Sync unsynced records to PDS in background
 * This function handles network failures gracefully and doesn't throw errors
 */
export async function syncToPds(ctx: AppContext): Promise<void> {
  if (!enableSyncToPds) {
    return
  }

  if (!ctx.db) {
    log.warn('Database not available for PDS sync')
    return
  }

  // Find unsynced records
  const unsyncedRecords = await ctx.db.db
    .selectFrom('record')
    .selectAll()
    .where('syncedToPds', '=', 0)
    .limit(50) // Batch size to avoid overwhelming PDS
    .execute()

  if (unsyncedRecords.length === 0) {
    return
  }

  log.info({ count: unsyncedRecords.length }, 'Starting PDS sync batch')

  // Create PDS agent once for the entire batch
  let agent, serviceRepoId
  try {
    const pdsAgent = await getOrCreatePdsAgent(ctx)
    agent = pdsAgent.agent
    serviceRepoId = pdsAgent.serviceRepoId
  } catch (error) {
    log.error({ error }, 'Failed to create PDS agent for sync batch')
    return // Don't throw, just return
  }

  for (const record of unsyncedRecords) {
    try {
      // Recalculate CID for the actual record
      const recordData = JSON.parse(record.record)
      const common = await import('@atproto/common')
      const ipldRecord = common.jsonToIpld(recordData)
      const correctCid = await common.cidForCbor(ipldRecord)

      await agent.com.atproto.repo.putRecord({
        repo: serviceRepoId,
        collection: record.collection,
        rkey: record.rkey,
        record: recordData,
      })

      // Mark as synced and update CID
      await ctx.db.db
        .updateTable('record')
        .set({
          syncedToPds: 1,
          cid: correctCid.toString(),
        })
        .where('uri', '=', record.uri)
        .execute()

      log.info({ uri: record.uri }, 'Record synced to PDS')
    } catch (error) {
      log.error({ uri: record.uri, error }, 'Failed to sync record to PDS')
      // Continue with other records - don't fail the batch
    }
  }

  log.info({ count: unsyncedRecords.length }, 'PDS sync batch completed')
}
