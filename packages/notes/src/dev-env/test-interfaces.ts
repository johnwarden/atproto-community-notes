/**
 * Interface for Notes test service - defines the contract
 * This matches the interface from your dev-env modifications
 */
export interface NotesTestService {
  url: string
  port: number
  internalPort: number
  internalUrl: string
  serviceAccount: {
    did: string
    key: any
    password: string
  }
  server: any
  dbPath: string
  feedGeneratorDid: string
  labelerDid: string
  labelerUrl: string
  close(): Promise<void>
}

/**
 * Factory function type for creating test services
 */
export interface TestServiceFactories {
  notesFactory?: (config: NotesTestConfig) => Promise<NotesTestService>
  labeler?: { port: number }
}

/**
 * Configuration for Notes test service
 */
export interface NotesTestConfig {
  port: number
  internalPort: number
  plcUrl: string
  pdsUrl: string
  labelerDid: string
  labelerUrl: string
}
