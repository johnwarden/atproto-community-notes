export interface ScoreEventRow {
  scoreEventId?: number // Auto-increment primary key
  proposalUri: string
  targetUri: string // The post URI that gets labeled
  targetCid?: string // Optional CID of the target post
  status: 'needs_more_ratings' | 'rated_helpful' | 'rated_not_helpful'
  score: number
  labelValue: string
  scoreEventTime: number // Unix timestamp in milliseconds
}

export type PartialDB = {
  scoreEvent: ScoreEventRow
}
