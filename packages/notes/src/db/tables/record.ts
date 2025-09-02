export interface RecordRow {
  uri: string
  cid: string
  did: string
  collection: string
  rkey: string
  record: string // JSON string in SQLite (was object in PostgreSQL)
  indexedAt: string
}

export type PartialDB = {
  record: RecordRow
}
