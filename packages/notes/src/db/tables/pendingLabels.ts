export interface PendingLabelsRow {
  id?: number // Auto-increment primary key
  scoreEventId: number
  targetUri: string
  targetCid?: string
  labelValue: string
  negative: number // SQLite boolean as integer (0/1)
  createdAt: string // ISO datetime string
}

export type PartialDB = {
  pendingLabels: PendingLabelsRow
}
