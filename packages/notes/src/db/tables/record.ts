export interface RecordRow {
  uri: string
  cid: string
  did: string
  collection: string
  rkey: string
  record: string // JSON string in SQLite (was object in PostgreSQL)
  indexedAt: string
  syncedToPds: number // SQLite boolean as 0/1
}

export type PartialDB = {
  record: RecordRow
}
