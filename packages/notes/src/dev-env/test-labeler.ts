import events from 'node:events'
import http from 'node:http'
import express from 'express'
// import { toString } from 'uint8arrays'
import { Secp256k1Keypair } from '@atproto/crypto'
import { AtpAgent } from '@atproto/api'
import { createServiceAccount } from '../test-notes'

/**
 * Test Labeler service - provides mock labeling functionality
 * Based on the TestLabeler from your dev-env modifications
 */
export class TestLabeler {
  private server?: http.Server

  constructor(
    public url: string,
    public port: number,
    private bskyDb: any,
    public labelerDid: string,
  ) {}

  static async create(config: {
    port: number
    bskyDb: any
    pdsUrl: string
  }): Promise<TestLabeler> {
    const port = config.port
    const url = `http://localhost:${port}`

    // Create a proper labeler actor with service account
    const labelerActor = await createLabelerActor(config.pdsUrl)

    const labeler = new TestLabeler(url, port, config.bskyDb, labelerActor.did)
    await labeler.start()
    return labeler
  }

  async start(): Promise<void> {
    const app = express()
    app.use(express.json())

    // Mock GET /label endpoint - creates labels directly in bsky database
    app.get('/label', async (req, res) => {
      console.log(`🏷️ LABELER ENDPOINT CALLED: ${req.url}`)
      console.log(`🏷️ Query params:`, req.query)

      try {
        const { uri, label, neg } = req.query

        if (!uri || !label) {
          console.log(`❌ Missing required parameters: uri=${uri}, label=${label}`)
          return res.status(400).json({
            error: 'Missing required parameters: uri, label',
          })
        }

        console.log(`🏷️ Processing label request: uri=${uri}, label=${label}, neg=${neg}`)

        // Write directly to bsky database (what syncLabels used to do)
        await this.createLabelInBsky(
          uri as string,
          label as string,
          neg === 'true',
        )

        const response = {
          success: true,
          uri,
          label,
          labelerDid: this.labelerDid,
        }
        console.log(`✅ Labeler response:`, response)
        res.json(response)
      } catch (error) {
        console.error(`❌ Labeler error:`, error)
        res.status(500).json({
          error:
            error instanceof Error ? error.message : 'Internal server error',
        })
      }
    })

    // Health check endpoint
    app.get('/_health', (_, res) => {
      res.json({ status: 'ok', service: 'test-labeler' })
    })

    this.server = app.listen(this.port)
    await events.once(this.server, 'listening')
  }

  /**
   * Create label in bsky database (same logic as NotesService.createLabelInBsky)
   */
  private async createLabelInBsky(
    uri: string,
    labelValue: string,
    neg: boolean,
  ): Promise<void> {
    if (!this.bskyDb) {
      throw new Error('⚠️ No bsky database available for label creation')
    }

    console.log(`🏷️ Creating label: uri=${uri}, val=${labelValue}, neg=${neg}, src=${this.labelerDid}`)

    if (neg) {
      // Delete existing label if negative is true
      const result = await this.bskyDb.db
        .deleteFrom('label')
        .where('src', '=', this.labelerDid)
        .where('uri', '=', uri)
        .where('val', '=', labelValue)
        .execute()
      console.log(`🗑️ Deleted ${result.length} labels`)
    } else {
      // Insert label (assuming positive label for simplicity in dev-env)
      const result = await this.bskyDb.db
        .insertInto('label')
        .values({
          src: this.labelerDid,
          uri: uri,
          cid: '', // Empty CID for simplicity in dev-env
          val: labelValue,
          neg: false,
          cts: new Date().toISOString(),
        })
        .onConflict((oc: any) =>
          oc.columns(['src', 'uri', 'cid', 'val']).doNothing(),
        )
        .execute()
      console.log(`✅ Inserted label: ${JSON.stringify(result)}`)

      // Verify the label was inserted by querying it back
      const verification = await this.bskyDb.db
        .selectFrom('label')
        .selectAll()
        .where('src', '=', this.labelerDid)
        .where('uri', '=', uri)
        .where('val', '=', labelValue)
        .execute()
      console.log(`🔍 Verification query found ${verification.length} labels:`, verification)
    }
  }

  async close(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => resolve())
      })
    }
  }
}

export async function createLabelerActor(
  pdsUrl: string,
): Promise<{ did: string; signingKey: string }> {
  const keyPair = await Secp256k1Keypair.create({ exportable: true })

  // First create a regular account (this creates both DID and account)
  const labelerTokens = await createServiceAccount(pdsUrl, 'cnlabeler.test')
  // Now we need to update the DID document to add AtprotoLabeler service
  // For now, let's just return the DID - the labeler service will work without the service in DID doc
  // TODO: Add PLC operation to update DID document with AtprotoLabeler service

  const signingKeyBytes = await keyPair.export()
  const signingKey = Buffer.from(signingKeyBytes).toString('hex')

  return {
    did: labelerTokens.did,
    signingKey: signingKey,
  }
}

