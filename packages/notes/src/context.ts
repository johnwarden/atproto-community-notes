import { AtpAgent } from '@atproto/api'
import { NotesService } from '.'
import { AuthService } from './auth'
import { NotesServiceConfig, RepoAccount } from './config'
import { Database } from './db'

export interface AppContext {
  auth: AuthService
  db: Database
  aidSalt: string // Secret salt for Anonymous ID generation (privacy protection)
  repoAccount: RepoAccount // Repository account for all records (proposals, votes, feed records)
  feedgenDocumentDid: string // Feed generator DID (for backward compatibility)
  pdsUrl: string // PDS URL for AT Protocol record creation
  reqLabelers: () => Record<string, any>
  config: NotesServiceConfig
  notesService: NotesService // NotesService instance to avoid circular imports
  pdsAgent?: {
    agent: AtpAgent
    serviceRepoId: string
    lastRefresh: Date
  }
}
