import { Database } from '../db'

export interface FeedContext {
  notesDb: Database
  scoresDb: Database
  userDid?: string
  servicePrivateKey: any
}

export interface FeedPost {
  post: string // AT-URI of the post
}

export interface FeedSkeleton {
  feed: FeedPost[]
  cursor?: string
}

export type FeedType = 'new' | 'needs_your_help' | 'rated_helpful'
