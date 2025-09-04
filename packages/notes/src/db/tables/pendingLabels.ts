export interface PendingLabelsRow {
  id?: number // Auto-increment primary key
  scoreEventId?: number // Nullable for proposed labels created before scoring
  targetUri: string
  targetCid?: string
  labelValue: string
  negative: number // SQLite boolean as integer (0/1)
  createdAt: string // ISO datetime string
}

export type PartialDB = {
  pendingLabels: PendingLabelsRow
}
