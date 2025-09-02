export interface ScoreRow {
  proposalUri: string
  targetUri: string // The post URI that gets labeled
  targetCid?: string // Optional CID of the target post
  status: 'needs_more_ratings' | 'rated_helpful' | 'rated_not_helpful'
  score: number
  labelValue: string
  latestScoreEventId: number
  scoreEventTime: number // Unix timestamp in milliseconds
}

export type PartialDB = {
  score: ScoreRow
}
