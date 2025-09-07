import express from 'express'
import { TestNetwork } from '@atproto/dev-env'
import { TestNotes } from '../test-notes'
import { TestLabeler } from './test-labeler'

/**
 * Wrapper around the base TestNetwork introspection server that adds
 * notes and labeler endpoints plus mockSetupComplete tracking
 */
export class IntrospectWrapper {
  private static setupComplete = false
  public port: number
  private server: any

  constructor(port: number, server: any) {
    this.port = port
    this.server = server
  }

  mockSetupComplete() {
    IntrospectWrapper.setupComplete = true
  }

  static async create(
    network: TestNetwork,
    notes?: TestNotes,
    labeler?: TestLabeler,
  ): Promise<IntrospectWrapper> {
    const port = network.introspect?.port || 2581

    const app = express()
    app.get('/', (_req, res) => {
      res.status(200).send({
        plc: {
          url: network.plc.url,
        },
        pds: {
          url: network.pds.url,
          did: network.pds.ctx.cfg.service.did,
          ...(network.pds.ctx.cfg.db.accountDbLoc && {
            dataDirectory: network.pds.ctx.cfg.db.accountDbLoc.replace(
              '/account.sqlite',
              '',
            ),
            accountDb: network.pds.ctx.cfg.db.accountDbLoc,
            sequencerDb: network.pds.ctx.cfg.db.sequencerDbLoc,
            didCacheDb: network.pds.ctx.cfg.db.didCacheDbLoc,
          }),
          ...(network.pds.ctx.cfg.actorStore?.directory && {
            actorStoreDir: network.pds.ctx.cfg.actorStore.directory,
          }),
        },
        bsky: {
          url: network.bsky.url,
          did: network.bsky.ctx.cfg.serverDid || network.bsky.serverDid,
          ...(network.bsky.db?.opts && {
            dbUrl: network.bsky.db.opts.url,
            dbSchema: network.bsky.db.opts.schema,
          }),
        },
        ozone: {
          url: network.ozone.url,
          did: network.ozone.ctx.cfg.service.did,
        },
        ...(notes && {
          notes: {
            url: notes.url,
            internalUrl: notes.internalUrl,
            feedgenDocumentDid: notes.feedgenDocumentDid,
            labelerDid: notes.labelerDid,
            repoDid: notes.repoAccount.did,
            dbPath: notes.dbPath,
          },
        }),
        ...(labeler && {
          labeler: {
            url: labeler.url,
          },
        }),
        db: {
          url: network.ozone.ctx.cfg.db.postgresUrl,
        },
        mockSetup: {
          complete: IntrospectWrapper.setupComplete,
        },
      })
    })

    const server = app.listen(port)
    await new Promise((resolve) => {
      server.once('listening', resolve)
    })

    return new IntrospectWrapper(port, server)
  }

  async close() {
    if (this.server) {
      this.server.close()
    }
  }
}
