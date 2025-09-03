import { Kysely, sql } from 'kysely'

/**
 * Fresh migration for Notes Database (notes.db)
 *
 * This database contains all Community Notes data:
 * - Proposals (community notes)
 * - Votes/ratings on proposals
 * - Score events from algorithm runs
 * - Current scores (maintained by triggers)
 * - Pending labels (for external labeler sync)
 *
 * Key features:
 * - Includes targetUri and targetCid for proper label targeting
 * - Uses pendingLabels table for reliable external labeler communication
 * - Preserves complete label history including negative labels
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  // ========================================
  // NOTES TABLES
  // ========================================

  // Generic record table (following PDS patterns) - stores proposals and votes
  await db.schema
    .createTable('record')
    .addColumn('uri', 'text', (col) => col.primaryKey())
    .addColumn('cid', 'text', (col) => col.notNull())
    .addColumn('did', 'text', (col) => col.notNull())
    .addColumn('collection', 'text', (col) => col.notNull())
    .addColumn('rkey', 'text', (col) => col.notNull())
    .addColumn('record', 'text', (col) => col.notNull()) // JSON as TEXT in SQLite
    .addColumn('indexedAt', 'text', (col) => col.notNull())
    .addColumn('syncedToPds', 'integer', (col) => col.defaultTo(0).notNull()) // SQLite boolean as 0/1
    .execute()

  // Indexes for common queries (converted to SQLite JSON1 syntax)
  await db.schema
    .createIndex('record_collection_idx')
    .on('record')
    .column('collection')
    .execute()

  await db.schema
    .createIndex('record_indexed_at_idx')
    .on('record')
    .column('indexedAt')
    .execute()

  // Index for target URI queries (JSON path) - for getProposals
  await sql`CREATE INDEX record_target_uri_idx ON record (json_extract(record, '$.uri'))`.execute(db)

  // Index for AID queries (JSON path) - for user-specific queries
  await sql`CREATE INDEX record_aid_idx ON record (json_extract(record, '$.aid'))`.execute(db)

  // Unique constraint for duplicate proposal prevention - prevents same user from creating multiple proposals with same label for same target
  await sql`CREATE UNIQUE INDEX record_aid_target_uri_label_unique ON record (collection, json_extract(record, '$.aid'), json_extract(record, '$.uri'), json_extract(record, '$.val')) WHERE collection = 'social.pmsky.proposal'`.execute(db)

  // Index for target URI + CID queries (for version-specific duplicate checking)
  await sql`CREATE INDEX record_target_uri_cid_idx ON record (json_extract(record, '$.uri'), json_extract(record, '$.cid'))`.execute(db)

  // Index for efficient vote queries - optimizes finding votes by note URI + voter AID
  await sql`CREATE INDEX record_vote_queries_idx ON record (collection, json_extract(record, '$.uri'), json_extract(record, '$.aid')) WHERE collection = 'social.pmsky.vote'`.execute(db)

  // Index for PDS sync status queries
  await db.schema
    .createIndex('record_sync_status_idx')
    .on('record')
    .columns(['syncedToPds', 'collection'])
    .execute()

  // ========================================
  // SCORING TABLES
  // ========================================

  // Create scoreEvent table - core algorithm output
  await db.schema
    .createTable('scoreEvent')
    .addColumn('scoreEventId', 'integer', (col) =>
      col.primaryKey().autoIncrement().notNull(),
    )
    .addColumn('proposalUri', 'text', (col) => col.notNull())
    .addColumn('targetUri', 'text', (col) => col.notNull()) // The post URI that gets labeled
    .addColumn('targetCid', 'text') // Optional CID of the target post
    .addColumn('status', 'text', (col) => col.notNull()) // Status: 'needs_more_ratings', 'rated_helpful', 'rated_not_helpful'
    .addColumn('score', 'real', (col) => col.notNull()) // Required numerical score
    .addColumn('labelValue', 'text', (col) => col.notNull()) // Label value: 'needs-context', 'harassment', etc.
    .addColumn('scoreEventTime', 'integer', (col) =>
      col.notNull().defaultTo(sql`(unixepoch('subsec')*1000)`),
    )
    .execute()

  // Create score table (maintained by trigger)
  await db.schema
    .createTable('score')
    .addColumn('proposalUri', 'text', (col) => col.primaryKey().notNull())
    .addColumn('targetUri', 'text', (col) => col.notNull()) // The post URI that gets labeled
    .addColumn('targetCid', 'text') // Optional CID of the target post
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('score', 'real', (col) => col.notNull())
    .addColumn('labelValue', 'text', (col) => col.notNull())
    .addColumn('latestScoreEventId', 'integer', (col) => col.notNull())
    .addColumn('scoreEventTime', 'integer', (col) => col.notNull())
    .execute()

  // Create pendingLabels table for external labeler sync
  await db.schema
    .createTable('pendingLabels')
    .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement().notNull())
    .addColumn('scoreEventId', 'integer', (col) => col.notNull().references('scoreEvent.scoreEventId'))
    .addColumn('targetUri', 'text', (col) => col.notNull())
    .addColumn('targetCid', 'text')
    .addColumn('labelValue', 'text', (col) => col.notNull())
    .addColumn('negative', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('createdAt', 'text', (col) => col.notNull())
    .execute()

  // Add unique constraint for pendingLabels
  await db.schema
    .createIndex('pendingLabels_unique_idx')
    .on('pendingLabels')
    .columns(['scoreEventId', 'labelValue', 'negative'])
    .unique()
    .execute()

  // Create indexes for score tables
  await db.schema
    .createIndex('scoreEvent_proposalUri_idx')
    .on('scoreEvent')
    .column('proposalUri')
    .execute()

  await db.schema
    .createIndex('scoreEvent_targetUri_idx')
    .on('scoreEvent')
    .column('targetUri')
    .execute()

  await db.schema
    .createIndex('scoreEvent_score_idx')
    .on('scoreEvent')
    .column('score')
    .execute()

  await db.schema
    .createIndex('score_score_idx')
    .on('score')
    .column('score')
    .execute()

  // Create indexes for pendingLabels
  await db.schema
    .createIndex('pendingLabels_createdAt_idx')
    .on('pendingLabels')
    .column('createdAt')
    .execute()

  // ========================================
  // FEED PERFORMANCE INDEXES
  // ========================================

  // Composite index for "New" feed - optimizes queries by collection + indexedAt
  // Optimizes queries: WHERE collection = 'social.pmsky.proposal' AND indexedAt < ? ORDER BY indexedAt DESC
  await db.schema
    .createIndex('record_collection_indexed_at_idx')
    .on('record')
    .columns(['collection', 'indexedAt'])
    .execute()

  // Composite index for "Needs Your Help" and "Rated Helpful" feeds
  // Optimizes queries: WHERE status = ? AND scoreEventTime < ? ORDER BY scoreEventTime DESC
  await db.schema
    .createIndex('score_status_time_idx')
    .on('score')
    .columns(['status', 'scoreEventTime'])
    .execute()

  // Index for targetUri queries (used by feeds to return post URIs)
  await db.schema
    .createIndex('score_targetUri_idx')
    .on('score')
    .column('targetUri')
    .execute()

  // ========================================
  // TRIGGERS
  // ========================================

  // Create trigger to maintain score table from scoreEvent inserts
  await sql`
    CREATE TRIGGER afterInsertOnScoreEvent
    AFTER INSERT ON scoreEvent
    BEGIN
      INSERT INTO score(proposalUri, targetUri, targetCid, status, score, labelValue, latestScoreEventId, scoreEventTime)
      VALUES (
        NEW.proposalUri,
        NEW.targetUri,
        NEW.targetCid,
        NEW.status,
        NEW.score,
        NEW.labelValue,
        NEW.scoreEventId,
        NEW.scoreEventTime
      )
      ON CONFLICT(proposalUri) DO UPDATE SET
        targetUri = NEW.targetUri,
        targetCid = NEW.targetCid,
        status = NEW.status,
        score = NEW.score,
        labelValue = NEW.labelValue,
        latestScoreEventId = NEW.scoreEventId,
        scoreEventTime = NEW.scoreEventTime;
    END
  `.execute(db)

  // Create pending label creation triggers for external labeler sync
  // These triggers create pending labels that will be processed by NotesService
  try {
    // Smart trigger: Create pending labels only on status changes
    await sql`
      CREATE TRIGGER create_pending_labels_on_score
      AFTER INSERT ON scoreEvent
      BEGIN
        -- Case 1: First time seeing proposal + needs_more_ratings
        -- Creates proposed-label:[labelValue]
        INSERT INTO pendingLabels (scoreEventId, targetUri, targetCid, labelValue, negative, createdAt)
        SELECT NEW.scoreEventId, NEW.targetUri, NEW.targetCid,
               'proposed-label:' || NEW.labelValue, 0, datetime('now')
        WHERE NEW.status = 'needs_more_ratings'
          AND NOT EXISTS (SELECT 1 FROM score WHERE proposalUri = NEW.proposalUri);

        -- Case 2: Status changes TO rated_helpful (from anything else or nothing)
        -- Creates positive label: [labelValue]
        INSERT INTO pendingLabels (scoreEventId, targetUri, targetCid, labelValue, negative, createdAt)
        SELECT NEW.scoreEventId, NEW.targetUri, NEW.targetCid, NEW.labelValue, 0, datetime('now')
        WHERE NEW.status = 'rated_helpful'
          AND (NOT EXISTS (SELECT 1 FROM score WHERE proposalUri = NEW.proposalUri)
               OR EXISTS (SELECT 1 FROM score WHERE proposalUri = NEW.proposalUri AND status != 'rated_helpful'));

        -- Case 3: Status changes FROM rated_helpful to something else
        -- Creates negative label: [labelValue]
        INSERT INTO pendingLabels (scoreEventId, targetUri, targetCid, labelValue, negative, createdAt)
        SELECT NEW.scoreEventId, NEW.targetUri, NEW.targetCid, NEW.labelValue, 1, datetime('now')
        WHERE NEW.status != 'rated_helpful'
          AND EXISTS (SELECT 1 FROM score WHERE proposalUri = NEW.proposalUri AND status = 'rated_helpful');
      END
    `.execute(db)
  } catch (error) {
    console.error('❌ Error creating pending label triggers:', error)
    throw error
  }


}

export async function down(db: Kysely<unknown>): Promise<void> {
  // Drop triggers first
  await sql`DROP TRIGGER IF EXISTS create_pending_labels_on_score`.execute(db)
  await sql`DROP TRIGGER IF EXISTS afterInsertOnScoreEvent`.execute(db)

  // Drop scoring indexes
  await db.schema.dropIndex('score_targetUri_idx').ifExists().execute()
  await db.schema.dropIndex('score_status_time_idx').ifExists().execute()
  await db.schema.dropIndex('pendingLabels_createdAt_idx').ifExists().execute()
  await db.schema.dropIndex('score_score_idx').ifExists().execute()
  await db.schema.dropIndex('scoreEvent_score_idx').ifExists().execute()
  await db.schema.dropIndex('scoreEvent_targetUri_idx').ifExists().execute()
  await db.schema.dropIndex('scoreEvent_proposalUri_idx').ifExists().execute()
  await db.schema.dropIndex('pendingLabels_unique_idx').ifExists().execute()

  // Drop notes indexes
  await db.schema.dropIndex('record_sync_status_idx').ifExists().execute()
  await db.schema.dropIndex('record_collection_indexed_at_idx').ifExists().execute()
  await sql`DROP INDEX IF EXISTS record_vote_queries_idx`.execute(db)
  await sql`DROP INDEX IF EXISTS record_target_uri_cid_idx`.execute(db)
  await sql`DROP INDEX IF EXISTS record_aid_target_uri_label_unique`.execute(db)
  await sql`DROP INDEX IF EXISTS record_aid_idx`.execute(db)
  await sql`DROP INDEX IF EXISTS record_target_uri_idx`.execute(db)
  await db.schema.dropIndex('record_indexed_at_idx').ifExists().execute()
  await db.schema.dropIndex('record_collection_idx').ifExists().execute()

  // Drop tables in reverse dependency order
  await db.schema.dropTable('pendingLabels').ifExists().execute()
  await db.schema.dropTable('score').ifExists().execute()
  await db.schema.dropTable('scoreEvent').ifExists().execute()
  await db.schema.dropTable('record').ifExists().execute()
}
