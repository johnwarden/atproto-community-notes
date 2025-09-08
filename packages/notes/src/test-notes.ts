import * as os from 'node:os'
import * as path from 'node:path'
import * as plc from '@did-plc/lib'
import { AtpAgent } from '@atproto/api'
import { Secp256k1Keypair, randomStr } from '@atproto/crypto'
import { RepoAccount } from './config'
import { NotesService } from './index'

export interface DidAndKey {
  did: string
  key: Secp256k1Keypair
}

// This implements the NotesTestService interface defined in dev-env
// but we don't import it to avoid circular dependency
export class TestNotes {
  public url: string
  public internalUrl: string
  constructor(
    // public internalUrl: string,
    public port: number,
    public internalApiPort: number,
    public internalApiHost: string,
    public server: NotesService,
    public repoAccount: RepoAccount,
    public dbPath: string,
    public feedgenDocumentDid: string,
    public labelerDid: string,
    public labelerUrl: string,
  ) {
    this.internalUrl = `http://[${internalApiHost}]:${internalApiPort}`
    this.url = `http://localhost:${port}`
  }

  static async create(config: {
    port: number
    internalApiPort: number
    internalApiHost: string
    plcUrl: string
    pdsUrl: string
    labelerDid: string
    labelerUrl: string
  }): Promise<TestNotes> {
    const port = config.port
    const internalApiPort = config.internalApiPort
    const internalApiHost = config.internalApiHost

    const dbPath = path.join(
      os.tmpdir(),
      `community-notes-${randomStr(8, 'base32')}.db`,
    )

    // Create service accounts
    let repoAccount: RepoAccount | undefined

    if (config.plcUrl && config.pdsUrl) {
      // Create repository account (for both feed records and notes records)
      const repoKeypair = await Secp256k1Keypair.create({ exportable: true })
      const repoTokens = await createRepoAccount(
        config.pdsUrl,
        'notes-repo.test',
      )

      repoAccount = {
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
    const feedgenDocumentDid: string = await createFeedGeneratorDid(
      config.plcUrl,
      port,
    )

    const server = await NotesService.create({
      port,
      internalApiPort,
      internalApiHost,
      dbPath: dbPath,
      repoAccount: repoAccount,
      feedgenDocumentDid: feedgenDocumentDid,
      pdsUrl: config.pdsUrl,
      labeler: {
        did: config.labelerDid,
        url: config.labelerUrl,
      },
    })

    await server.start()

    return new TestNotes(
      port,
      internalApiPort,
      internalApiHost,
      server,
      repoAccount,
      dbPath,
      feedgenDocumentDid,
      config.labelerDid,
      config.labelerUrl,
    )
  }

  async close(): Promise<void> {
    await this.server.close()
  }
}

export async function createRepoAccount(
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

export default TestNotes
