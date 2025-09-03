import { envInt, envStr } from '@atproto/common'

export interface ServiceAccount {
  did: string // Service DID (used for both identity and repository)
  key: any // Service signing key (string or keypair object)
  password: string // Password for credential-based authentication
}

export interface NotesServiceConfig {
  port: number
  internalPort: number
  dbPath: string
  repoAccount: ServiceAccount // Repository account for all records
  feedGeneratorDid: string // Feed generator document DID (service host)
  pdsUrl: string // PDS URL for AT Protocol record creation
  labeler: LabelerConfig // Labeler service configuration
}

export const readEnv = (): ServerEnvironment => {
  return {
    // service
    port: envInt('PORT'),
    internalPort: envInt('INTERNAL_PORT'),
    nodeEnv: envStr('NODE_ENV'),
    pdsUrl: envStr('PDS_URL'),

    // database
    dbPath: envStr('DB_PATH'),

    // repository account (for all records: proposals, votes, feed records)
    repoAccountDid: envStr('REPO_DID'),
    repoAccountPrivateKey: envStr('REPO_PRIVATE_KEY'),
    repoAccountPassword: envStr('REPO_PASSWORD'),

    // feed generator document DID (service host)
    feedgenDocumentDid: envStr('FEEDGEN_DOCUMENT_DID'),

    // labeler
    labelerDid: envStr('LABELER_DID'),
    labelerUrl: envStr('LABELER_URL'),
  }
}

export type ServerEnvironment = {
  // service
  port?: number
  internalPort?: number
  nodeEnv?: string
  pdsUrl?: string

  // database
  dbPath?: string

  // repository account (for all records: proposals, votes, feed records)
  repoAccountDid?: string
  repoAccountPrivateKey?: string
  repoAccountPassword?: string

  // feed generator document DID (service host)
  feedgenDocumentDid?: string

  // labeler
  labelerDid?: string
  labelerUrl?: string
}

export interface DatabaseConfig {
  dbPath: string
}

export interface ServiceAccountConfig {
  did: string
  key: string
  password: string
  // Removed userDid - using single DID approach
  // Removed JWT fields - using password authentication
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

  if (!env.internalPort) {
    throw new Error('INTERNAL_PORT environment variable is required')
  }

  if (!env.repoAccountDid) {
    throw new Error('REPO_DID environment variable is required')
  }

  if (!env.repoAccountPassword) {
    throw new Error('REPO_PASSWORD environment variable is required')
  }

  return {
    port: env.port,
    internalPort: env.internalPort,
    dbPath: env.dbPath,
    pdsUrl: env.pdsUrl!,
    labeler: {
      did: env.labelerDid,
      url: env.labelerUrl,
    },
    repoAccount: {
      did: env.repoAccountDid,
      key: env.repoAccountPrivateKey,
      password: env.repoAccountPassword,
    },
    feedGeneratorDid: env.feedgenDocumentDid,
  }
}
