import { envInt, envStr } from '@atproto/common'

export const enableSyncToPds = false

export interface RepoAccount {
  did: string // Account DID (used for both identity and repository)
  password: string // Password for credential-based authentication
}

export interface NotesServiceConfig {
  port: number
  internalApiPort: number
  internalApiHost: string
  dbPath: string
  aidSalt: string // Secret salt for Anonymous ID generation (privacy protection)
  repoAccount: RepoAccount // Repository account for all records
  feedgenDocumentDid: string // Feed generator document DID (service host)
  pdsUrl: string // PDS URL for AT Protocol record creation
  labeler: LabelerConfig // Labeler service configuration
}

export const readEnv = (): ServerEnvironment => {
  return {
    // service
    port: envInt('PORT'),
    internalApiPort: envInt('INTERNAL_API_PORT'),
    internalApiHost: envStr('INTERNAL_API_HOST') || envStr('FLY_PRIVATE_IPV6'),
    nodeEnv: envStr('NODE_ENV'),
    pdsUrl: envStr('PDS_URL'),

    // database
    dbPath: envStr('DB_PATH'),

    // repository account (for all records: proposals, votes, feed records)
    repoAccountDid: envStr('REPO_DID'),
    repoAccountPassword: envStr('REPO_PASSWORD'),
    
    // AID generation salt (privacy protection)
    aidSalt: envStr('AID_SALT'),

    feedgenDocumentDid: envStr('FEEDGEN_DOCUMENT_DID'),

    // labeler
    labelerDid: envStr('LABELER_DID'),
    labelerUrl: envStr('LABELER_URL'),
  }
}

export type ServerEnvironment = {
  // service
  port?: number
  internalApiPort?: number
  internalApiHost?: string
  nodeEnv?: string
  pdsUrl?: string

  // database
  dbPath?: string

  // repository account (for all records: proposals, votes, feed records)
  repoAccountDid?: string
  repoAccountPassword?: string
  
  // AID generation salt (privacy protection)
  aidSalt?: string

  // feed generator document DID (service host)
  feedgenDocumentDid?: string

  // labeler
  labelerDid?: string
  labelerUrl?: string
}

export interface DatabaseConfig {
  dbPath: string
}

export interface RepoAccountConfig {
  did: string
  password: string
}

export interface LabelerConfig {
  did: string
  url: string
}

export const envToCfg = (env: ServerEnvironment): NotesServiceConfig => {
  // Validate required environment variables (unless skipped for dev-env)
  if (!env.dbPath) {
    throw new Error('DB_PATH environment variable is required')
  }

  if (!env.labelerDid) {
    throw new Error('LABELER_DID environment variable is required')
  }

  if (!env.labelerUrl) {
    throw new Error('LABELER_URL environment variable is required')
  }

  if (!env.pdsUrl) {
    throw new Error('PDS_URL environment variable is required')
  }

  if (!env.feedgenDocumentDid) {
    throw new Error('FEEDGEN_DOCUMENT_DD environment variable is required')
  }

  if (!env.port) {
    throw new Error('PORT environment variable is required')
  }

  if (!env.internalApiPort) {
    throw new Error('INTERNAL_API_PORT environment variable is required')
  }

  if (!env.repoAccountDid) {
    throw new Error('REPO_DID environment variable is required')
  }

  if (!env.repoAccountPassword) {
    throw new Error('REPO_PASSWORD environment variable is required')
  }

  if (!env.aidSalt) {
    throw new Error('AID_SALT environment variable is required')
  }

  if (!env.internalApiHost) {
    throw new Error('INTERNAL_API_HOST environment variable is required')
  }

  return {
    port: env.port,
    internalApiPort: env.internalApiPort,
    internalApiHost: env.internalApiHost,
    dbPath: env.dbPath,
    pdsUrl: env.pdsUrl!,
    aidSalt: env.aidSalt,
    labeler: {
      did: env.labelerDid,
      url: env.labelerUrl,
    },
    repoAccount: {
      did: env.repoAccountDid,
      password: env.repoAccountPassword,
    },
    feedgenDocumentDid: env.feedgenDocumentDid,
  }
}
