# Database Refactoring Plan - 2025-09-03

This document outlines the database refactoring plan to improve performance, reliability, and maintainability of the Community Notes system.

## Overview

The refactoring addresses several key issues:
- **Performance**: `getProposals` currently does separate queries for proposals and scores
- **Reliability**: PDS sync failures currently break user operations
- **Maintainability**: Auto-rating logic is scattered in TypeScript instead of database triggers
- **Consistency**: Missing automatic label sync after vote/score operations

## Current Architecture Analysis

### Database Schema
- **`record` table**: Generic AT Protocol record storage (JSON-in-SQLite) for proposals and votes
- **`scoreEvent` table**: Immutable audit trail of algorithm decisions  
- **`score` table**: Current state derived from scoreEvent via triggers
- **`pendingLabels` table**: Labels awaiting sync to external labeler

### Current Issues
1. **getProposals performance**: Separate queries in `community-notes.ts` lines 52-74
2. **Manual auto-rating**: TypeScript code in `createProposal.ts` lines 337-349
3. **Fragile PDS sync**: Immediate sync fails entire operation on network errors
4. **Missing label sync**: No automatic `syncLabels` call after vote/score operations

## Design Decision: Keep Raw Records Approach

**Recommendation: Keep the raw AT Protocol records approach**

### Pros of Current Approach
- Matches Bluesky PDS patterns exactly
- Future-proof for schema evolution
- Supports any AT Protocol record type generically
- Enables offline operation with eventual PDS sync
- Preserves complete AT Protocol semantics

### Cons of Alternative (Proper Tables)
- Would duplicate data (both structured + JSON)
- Schema migration complexity
- Potential inconsistency between formats
- More storage overhead

## Detailed Refactoring Plan

### 1. Database Schema Changes

#### Add `syncedToPds` Column
```sql
-- Add to record table in initial migration
ALTER TABLE record ADD COLUMN syncedToPds INTEGER DEFAULT 0; -- SQLite boolean as 0/1
CREATE INDEX record_sync_status_idx ON record (syncedToPds, collection);
```

#### Add Auto-Rating Trigger
```sql
-- Trigger to create auto-rating when proposal is inserted
CREATE TRIGGER create_auto_rating_on_proposal
AFTER INSERT ON record
WHEN NEW.collection = 'social.pmsky.proposal'
BEGIN
  INSERT INTO record (uri, cid, did, collection, rkey, record, indexedAt, syncedToPds)
  VALUES (
    'at://' || NEW.did || '/social.pmsky.vote/vote_' || json_extract(NEW.record, '$.aid') || '_' || substr(NEW.uri, -13),
    'auto-generated-cid', -- Will be recalculated during sync
    NEW.did,
    'social.pmsky.vote',
    'vote_' || json_extract(NEW.record, '$.aid') || '_' || substr(NEW.uri, -13),
    json_object(
      '$type', 'social.pmsky.vote',
      'src', NEW.did,
      'uri', NEW.uri,
      'val', 1,
      'reasons', json_array('cites_high_quality_sources', 'is_clear', 'addresses_claim', 'provides_important_context', 'is_unbiased'),
      'aid', json_extract(NEW.record, '$.aid'),
      'cts', datetime('now')
    ),
    datetime('now'),
    0 -- Not synced to PDS yet
  );
END;
```

### 2. Optimize getProposals with JOIN

Replace separate queries in `ProposalsHydrator.getProposals()`:

```typescript
// Replace lines 52-74 in community-notes.ts
const proposalsWithScores = await db.db
  .selectFrom('record')
  .leftJoin('score', 'score.proposalUri', 'record.uri')
  .select([
    'record.uri',
    'record.cid', 
    'record.record',
    'record.indexedAt',
    'score.status',
    'score.score'
  ])
  .where('record.collection', '=', 'social.pmsky.proposal')
  .where(sql`json_extract(record.record, '$.uri')`, '=', uri)
  .orderBy('record.indexedAt', 'desc')
  .limit(limit || 50)
  .execute()

// Remove the separate scoreInfoMap logic (lines 60-74)
```

### 3. Refactor PDS Sync Strategy

#### New `syncToPds` Function
```typescript
export async function syncToPds(ctx: AppContext): Promise<void> {
  // Find unsynced records
  const unsyncedRecords = await ctx.db.db
    .selectFrom('record')
    .selectAll()
    .where('syncedToPds', '=', 0)
    .limit(50) // Batch size to avoid overwhelming PDS
    .execute()

  for (const record of unsyncedRecords) {
    try {
      const { agent, serviceRepoId } = await createAuthenticatedPdsAgent(ctx)
      
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
          cid: correctCid.toString()
        })
        .where('uri', '=', record.uri)
        .execute()

      log.info({ uri: record.uri }, 'Record synced to PDS')
    } catch (error) {
      log.error({ uri: record.uri, error }, 'Failed to sync record to PDS')
      // Continue with other records - don't fail the batch
    }
  }
}
```

#### Update putRecord to Never Sync Immediately
```typescript
export async function putRecord(
  ctx: AppContext,
  params: {
    collection: string
    rkey: string
    record?: any // undefined = delete
  },
): Promise<{ success: boolean; uri?: string; cid?: string }> {
  // Remove syncToPds parameter - always store locally only
  // Set syncedToPds = 0 for all new records
  
  // ... existing logic but always set syncedToPds: 0 for new records
  // Remove all PDS sync code from this function
}
```

### 4. Add syncLabels Calls

#### In rateProposal endpoint
```typescript
// After successful vote operation in rateProposal.ts
const voteResult = await vote(ctx, params)
if (voteResult.success) {
  // Sync records to PDS (non-blocking)
  syncToPds(ctx).catch(error => 
    log.error({ error }, 'Background PDS sync failed')
  )
  
  // Sync labels (non-blocking)  
  ctx.notesService?.syncPendingLabels().catch(error =>
    log.error({ error }, 'Background label sync failed')
  )
}
```

#### In score endpoint
```typescript
// After scoreEvent insertion in NotesService.score()
await ctx.db.db.insertInto('scoreEvent').values(scoreEventData).execute()

// Sync labels immediately (since scoreEvent triggers create pendingLabels)
await this.syncPendingLabels()
```

### 5. Remove Manual Auto-Rating Code

Delete lines 337-349 in `createProposal.ts`:
```typescript
// Remove this entire block:
// const autoRatingResult = await vote(ctx, {
//   raterAid: creatorAid,
//   proposalUri: putResult.uri,
//   val: 1, // Helpful
//   reasons: [
//     'cites_high_quality_sources',
//     'is_clear',
//     'addresses_claim',
//     'provides_important_context',
//     'is_unbiased',
//   ],
// })
```

### 6. Migration Strategy

Since we haven't launched yet, modify the initial migration file `20250822T120000000Z-init.ts`:

1. **Add `syncedToPds` column** to record table creation
2. **Add auto-rating trigger** after record table creation
3. **Add optimized index** for sync status queries

```sql
-- Add to record table creation
.addColumn('syncedToPds', 'integer', (col) => col.defaultTo(0).notNull())

-- Add index after record table creation
await db.schema
  .createIndex('record_sync_status_idx')
  .on('record')
  .columns(['syncedToPds', 'collection'])
  .execute()
```

### 7. Configuration Changes

Update sync flags in API files:
```typescript
// In createProposal.ts - remove this line:
const syncProposalsToPds = false

// In rateProposal.ts - remove this line:
const syncVotesToPds = false

// All putRecord calls should remove syncToPds parameter
```

### 8. Testing Strategy

#### Integration Tests
Current integration test coverage in `notes-api.test.ts` should be sufficient for basic functionality.

#### Failure Test for PDS Sync
Add a test in `notes-api.test.ts` to verify system works when PDS is unavailable:

```typescript
describe('PDS Failure Resilience', () => {
  it('should continue working when PDS is down', async () => {
    // Create a proposal (should succeed even if PDS sync fails)
    const proposal = await agent.org.opencommunitynotes.createProposal({
      uri: 'at://did:plc:test/app.bsky.feed.post/test',
      val: 'needs-context',
      note: 'This needs context',
      typ: 'community-note',
    })
    
    expect(proposal.success).toBe(true)
    
    // Temporarily shut down PDS
    await testNetwork.pds.close()
    
    // Rate the proposal (should succeed locally)
    const rating = await agent.org.opencommunitynotes.rateProposal({
      uri: proposal.data.uri,
      val: 1,
      reasons: ['is_clear'],
    })
    
    expect(rating.success).toBe(true)
    
    // Verify data is stored locally even though PDS sync failed
    const proposals = await agent.org.opencommunitynotes.getProposals({
      uris: ['at://did:plc:test/app.bsky.feed.post/test'],
    })
    
    expect(proposals.data.proposals).toHaveLength(1)
    
    // Restart PDS
    await testNetwork.pds.start()
    
    // Background sync should eventually succeed
    // (This would require adding a manual sync trigger for testing)
  })
})
```

## Implementation Order

1. **Database Schema**: Update initial migration with new column, trigger, and indexes
2. **PDS Sync Refactor**: Update `putRecord` and add `syncToPds` function
3. **getProposals Optimization**: Replace separate queries with JOIN
4. **Remove Manual Auto-Rating**: Delete TypeScript auto-rating code
5. **Add syncLabels Calls**: Update API endpoints to call label sync
6. **Testing**: Add PDS failure test
7. **Configuration**: Remove sync flags from API files

## Benefits

- **Performance**: Single JOIN query instead of separate queries for proposals/scores
- **Reliability**: User operations succeed even when PDS is unavailable
- **Maintainability**: Auto-rating logic centralized in database trigger
- **Consistency**: Automatic label sync after all relevant operations
- **Scalability**: Background sync with batching prevents PDS overload

## Risks and Mitigations

- **Risk**: Database triggers are harder to debug
  - **Mitigation**: Comprehensive logging and integration tests
- **Risk**: Background sync might lag behind user operations
  - **Mitigation**: Acceptable for MVP, can add real-time sync later if needed
- **Risk**: Failed PDS syncs might accumulate
  - **Mitigation**: Implement retry logic with exponential backoff (future enhancement)
