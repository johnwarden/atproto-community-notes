import { AuthService } from './auth'
import { ServiceAccount } from './config'
import { Database } from './db'

export interface AppContext {
  auth: AuthService
  db: Database
  repoAccount: ServiceAccount // Repository account for all records (proposals, votes, feed records)
  feedGeneratorDid?: string // Feed generator DID (for backward compatibility)
  pdsUrl: string // PDS URL for AT Protocol record creation
  reqLabelers: () => Record<string, any>
  config: any // Configuration object to avoid circular imports
  notesService?: any // NotesService instance to avoid circular imports
}
