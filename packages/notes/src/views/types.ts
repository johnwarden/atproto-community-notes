export type ProposalView = {
  uri: string
  cid: string
  author: {
    aid: string
    pseudonym: string
  }
  typ: string
  targetUri: string
  val: string
  reasons?: string[]
  note: string
  cts: string
  status: 'needs_more_ratings' | 'rated_helpful' | 'rated_not_helpful'
  score?: number
  viewer?: {
    rating: {
      val: number
      reasons?: string[]
      uri?: string
      createdAt: string
      updatedAt?: string
    }
  }
}
