import * as os from 'node:os'
import * as path from 'node:path'
import * as plc from '@did-plc/lib'
import { AtpAgent } from '@atproto/api'
import { Secp256k1Keypair, randomStr } from '@atproto/crypto'
import type { NotesTestConfig } from './dev-env/test-interfaces'
import { NotesService } from './index'

export interface DidAndKey {
  did: string
  key: Secp256k1Keypair
}

export interface ServiceAccountWithToken {
  did: string // Service DID (used for both identity and repository)
  key: Secp256k1Keypair
  password: string // Password for credential-based authentication
}

// This implements the NotesTestService interface defined in dev-env
// but we don't import it to avoid circular dependency
export class TestNotes {
  public internalUrl: string

  constructor(
    public url: string,
    public port: number,
    public internalPort: number,
    public server: NotesService,
    public serviceAccount: ServiceAccountWithToken,
    public dbPath: string,
    public feedGeneratorDid: string,
    public labelerDid: string,
    public labelerUrl: string,
  ) {
    this.internalUrl = `http://localhost:${internalPort}`
  }

  static async create(config: {
    port: number
    internalPort: number
    plcUrl: string
    pdsUrl: string
    labelerDid: string
    labelerUrl: string
  }): Promise<TestNotes> {
    const port = config.port
    const url = `http://localhost:${port}`
    const internalPort = config.internalPort

    const dbPath = path.join(
      os.tmpdir(),
      `community-notes-${randomStr(8, 'base32')}.db`,
    )

    // Create service accounts
    let serviceAccount: ServiceAccountWithToken | undefined

    if (config.plcUrl && config.pdsUrl) {
      // Create repository account (for both feed records and notes records)
      const repoKeypair = await Secp256k1Keypair.create({ exportable: true })
      const repoTokens = await createServiceAccount(
        config.pdsUrl,
        'notes-repo.test',
      )

      serviceAccount = {
        did: repoTokens.did,
        key: repoKeypair,
        password: 'service-password-123', // Use password instead of JWT tokens
      }
    } else {
      throw new Error(
        'plcUrl and pdsUrl are required to create service accounts',
      )
    }

    // Create separate feed generator document DID with BskyFeedGenerator service
    const feedGeneratorDid: string = await createFeedGeneratorDid(
      config.plcUrl,
      port,
    )

    const server = await NotesService.create({
      port,
      internalPort,
      dbPath: dbPath,
      repoAccount: serviceAccount,
      feedGeneratorDid: feedGeneratorDid,
      pdsUrl: config.pdsUrl,
      labeler: {
        did: config.labelerDid,
        url: config.labelerUrl,
      },
    })

    await server.start()

    return new TestNotes(
      url,
      port,
      internalPort,
      server,
      serviceAccount!,
      dbPath,
      feedGeneratorDid,
      config.labelerDid,
      config.labelerUrl,
    )
  }

  async close(): Promise<void> {
    await this.server.close()
  }
}

export async function createServiceAccount(
  pdsUrl: string,
  handle: string,
): Promise<{
  did: string
  accessJwt: string
  refreshJwt: string
}> {
  try {
    // Create account on PDS - let PDS create the DID
    const agent = new AtpAgent({ service: pdsUrl })
    const { data } = await agent.com.atproto.server.createAccount({
      handle,
      email: `${handle.split('.')[0]}@notes.test`,
      password: 'service-password-123',
      // Don't specify DID - let PDS create one
    })

    return {
      did: data.did,
      accessJwt: data.accessJwt,
      refreshJwt: data.refreshJwt,
    }
  } catch (error) {
    console.error(`❌ Failed to create service account:`, error)
    throw error
  }
}

export async function createFeedGeneratorDid(
  plcUrl: string,
  port: number,
): Promise<string> {
  try {
    const keypair = await Secp256k1Keypair.create({ exportable: true })
    const plcClient = new plc.Client(plcUrl)

    const op = await plc.signOperation(
      {
        type: 'plc_operation',
        verificationMethods: {
          atproto: keypair.did(),
        },
        rotationKeys: [keypair.did()],
        alsoKnownAs: [],
        services: {
          bsky_fg: {
            type: 'BskyFeedGenerator',
            endpoint: `http://localhost:${port}`,
          },
        },
        prev: null,
      },
      keypair,
    )

    const did = await plc.didForCreateOp(op)
    await plcClient.sendOperation(did, op)

    return did
  } catch (error) {
    console.error(`❌ Failed to create feed generator DID:`, error)
    throw error
  }
}

// Export factory function for dev-env
export const createTestNotes = (config: NotesTestConfig) =>
  TestNotes.create(config)

export default TestNotes
