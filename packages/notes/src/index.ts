import {
  Server as HttpServer,
  createServer as createHttpServer,
} from 'node:http'
import cors from 'cors'
import express from 'express'
import { AtpAgent } from '@atproto/api'
import { subsystemLogger } from '@atproto/common'
import createProposal from './api/org/opencommunitynotes/createProposal'
import getConfig from './api/org/opencommunitynotes/getConfig'
import getProposals from './api/org/opencommunitynotes/getProposals'
import rateProposal from './api/org/opencommunitynotes/rateProposal'
import { AuthService } from './auth'
import { createRouter as createBasicRouter } from './basic-routes'
import { type NotesServiceConfig, type ServiceAccount } from './config'
import { AppContext, Hydrator } from './context'
import { Database } from './db'
import { registerFeedHandlers } from './feeds'
import { createServer } from './lexicon'
import { httpLogger as log, loggerMiddleware } from './logger'
import { createAuthMiddleware } from './middleware/auth'
import { errorHandlingMiddleware } from './middleware/error-handling'
import { createAuthenticatedPdsAgent } from './utils'
import { Views } from './views'

// Create scoring-specific logger
const scoringLog = subsystemLogger('scoring')

export interface PendingLabel {
  id: number
  scoreEventId: number
  targetUri: string
  targetCid?: string
  labelValue: string
  negative: boolean // Convert from SQLite integer to boolean
  createdAt: string // ISO datetime string
}

export class NotesService {
  private server?: HttpServer
  private internalServer?: HttpServer
  private db?: Database

  public repoAccount: ServiceAccount
  public feedGeneratorDid: string
  public pdsUrl: string
  public syncVotesToPds: boolean

  constructor(private config: NotesServiceConfig) {
    this.repoAccount = config.repoAccount

    this.feedGeneratorDid = config.feedGeneratorDid
    this.pdsUrl = config.pdsUrl
    this.syncVotesToPds = config.syncVotesToPds
  }

  static async create(config: NotesServiceConfig): Promise<NotesService> {
    return new NotesService(config)
  }

  async start(): Promise<HttpServer> {
    // Validate required repository account configuration
    if (this.config.port === 0) {
      throw new Error('port == 0')
    }

    if (this.config.internalPort === 0) {
      throw new Error('internalPort == 0')
    }

    this.db = new Database({
      path: this.config.dbPath,
    })
    await this.db.migrateToLatestOrThrow()
    log.info({ path: this.config.dbPath }, 'Database initialized')

    const app = express()

    // Add CORS support
    app.use(
      cors({
        origin: ['http://localhost:19006', 'http://localhost:3000'], // Add frontend origins
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: [
          'Content-Type',
          'Authorization',
          'atproto-accept-labelers',
        ],
      }),
    )

    // Add logging middleware
    app.use(loggerMiddleware)

    // Add JSON parsing middleware for internal endpoints
    app.use(express.json())

    const server = createServer()

    const hydrator = new Hydrator(this.db)
    const views = new Views()
    const auth = new AuthService(this.config.pdsUrl)
    const authMiddleware = createAuthMiddleware(auth)

    const ctx: AppContext = {
      hydrator,
      views,
      auth,
      db: this.db,
      repoAccount: this.repoAccount,
      feedGeneratorDid: this.feedGeneratorDid,
      pdsUrl: this.pdsUrl,
      syncVotesToPds: this.syncVotesToPds,
      reqLabelers: () => ({}), // Mocked for now
      config: this.config,
    }

    // Add basic routes (root, health, robots.txt)
    const basicRouter = createBasicRouter(ctx)
    app.use(basicRouter)

    // Register endpoints
    getConfig(server, ctx)
    getProposals(server, ctx)
    rateProposal(server, ctx)
    createProposal(server, ctx)

    // Register feed endpoints
    registerFeedHandlers(app, ctx)

    app.use(server.xrpc.router)

    // Add global error handling middleware (must be after all routes)
    app.use(errorHandlingMiddleware)

    // Add authentication middleware for testing
    app.use('/auth', authMiddleware.required)
    app.get('/auth/test', (req, res) => {
      res.json({
        message: 'Authentication successful',
        did: (req as any).auth?.did,
      })
    })

    // Ping endpoint
    app.get('/_ping', (_req, res) => {
      res.send('pong')
    })

    this.server = createHttpServer(app)

    // Create internal server for scoring endpoints
    const internalApp = express()
    internalApp.use(express.json())

    // Internal API endpoint for scoring
    internalApp.post('/internal/score', async (req, res) => {
      const startTime = Date.now()

      log.debug('Set score called', { body: req.body })

      try {
        const { proposalUri, status, score } = req.body

        if (!proposalUri || !status || typeof score !== 'number') {
          return res.status(400).json({
            error: 'Missing required fields: proposalUri, status, score',
          })
        }

        await this.score({ proposalUri, status, score })

        const totalTime = Date.now() - startTime
        res.json({
          success: true,
          proposalUri,
          status,
          score,
          processingTime: totalTime,
        })
      } catch (error) {
        const totalTime = Date.now() - startTime
        scoringLog.error(
          {
            error: error instanceof Error ? error.message : error,
            stack: error instanceof Error ? error.stack : undefined,
            body: req.body,
            totalTime,
          },
          'Internal score endpoint error',
        )
        res.status(500).json({
          error:
            error instanceof Error ? error.message : 'Internal server error',
        })
      }
    })

    // Health check for internal API
    internalApp.get('/internal/_health', (_, res) => {
      res.json({ status: 'ok', service: 'notes-service-internal' })
    })

    this.internalServer = createHttpServer(internalApp)

    // Create feed generator records idempotently (only if not disabled)
    log.info(`Create feed generator records`)
    await this.createFeedGeneratorRecords()

    const port = this.config.port
    const internalPort = this.config.internalPort

    this.server.listen(port)

    this.internalServer.listen(internalPort)

    log.info({ port }, 'Main server started')
    log.info({ internalPort }, 'Internal server started')

    return this.server
  }

  /**
   * Create feed generator records idempotently on service startup
   */
  private async createFeedGeneratorRecords(): Promise<void> {
    if (
      !this.repoAccount?.did ||
      !this.repoAccount?.key ||
      !this.config.pdsUrl
    ) {
      throw new Error('Repository account/PDS URL not configured')
    }

    let agent: AtpAgent | undefined
    try {
      log.info('Creating Community Notes feed generator records...')

      const { agent: pdsAgent, serviceRepoId } =
        await createAuthenticatedPdsAgent({
          repoAccount: this.repoAccount,
          pdsUrl: this.config.pdsUrl,
          db: this.db,
        } as AppContext)

      agent = pdsAgent

      const feedGenerators = [
        {
          rkey: 'new',
          displayName: 'CN: New',
          description: 'Posts with the newest community notes',
        },
        {
          rkey: 'needs_your_help',
          displayName: 'CN: Needs Your Help',
          description: 'Posts that need more ratings on their community notes',
        },
        {
          rkey: 'rated_helpful',
          displayName: 'CN: Rated Helpful',
          description: 'Posts with community notes rated as helpful',
        },
      ]

      for (const fg of feedGenerators) {
        try {
          const record = {
            did: this.feedGeneratorDid || this.repoAccount?.did,
            displayName: fg.displayName,
            description: fg.description,
            createdAt: new Date().toISOString(),
          }

          log.debug(
            {
              serviceRepoId,
              rkey: fg.rkey,
              record,
              pdsUrl: this.config.pdsUrl,
              authMethod: 'bearer_token',
            },
            'Create feed generator record in PDS',
          )

          // Try to create the record idempotently
          const { data } = await agent.com.atproto.repo.createRecord({
            repo: serviceRepoId,
            collection: 'app.bsky.feed.generator',
            rkey: fg.rkey,
            record,
          })

          log.info(
            {
              uri: data.uri,
              cid: data.cid,
              rkey: fg.rkey,
              displayName: fg.displayName,
            },
            'Feed generator record created successfully',
          )
        } catch (error: any) {
          if (error?.message?.includes('RecordAlreadyExists')) {
            log.debug({ rkey: fg.rkey }, 'Feed generator record already exists')
          } else {
            log.error(
              {
                rkey: fg.rkey,
                error: error instanceof Error ? error.message : error,
                errorName: error instanceof Error ? error.name : 'unknown',
                errorStack: error instanceof Error ? error.stack : undefined,
                serviceRepoId,
                serviceDid: this.repoAccount?.did,
              },
              'Failed to create feed generator record - detailed error',
            )
            // Re-throw the error to fail the entire setup
            throw error
          }
        }
      }

      log.info('Community Notes feed generator records setup complete')
    } catch (error) {
      log.error({ error }, 'Failed to setup feed generator records')
      // Feed generator records are critical - fail startup if they can't be created
      throw new Error(
        `Failed to setup feed generator records: ${error instanceof Error ? error.message : error}`,
      )
    } finally {
      // Always clean up the agent to prevent hanging
      if (agent) {
        try {
          await agent.logout()
        } catch (error) {
          log.warn({ error }, 'Error during feed generator agent cleanup')
        }
      }
    }
  }

  // ========================================
  // SCORING METHODS
  // ========================================

  /**
   * Set score for a proposal - main API method
   * Looks up targetUri, targetCid, and labelValue from the proposal record
   */
  async score(params: {
    proposalUri: string
    status: 'needs_more_ratings' | 'rated_helpful' | 'rated_not_helpful'
    score: number
  }): Promise<void> {
    const { proposalUri, status, score } = params
    const startTime = Date.now()

    scoringLog.debug(
      {
        proposalUri,
        status,
        score,
        method: 'score',
      },
      'score method called',
    )

    try {
      // 1. Look up proposal data from database
      let targetUri: string
      let targetCid: string | undefined
      let labelValue: string

      if (this.db) {
        try {
          const proposalRecord = await this.db.db
            .selectFrom('record')
            .select(['record'])
            .where('uri', '=', proposalUri)
            .where('collection', '=', 'social.pmsky.proposal')
            .executeTakeFirst()

          if (!proposalRecord) {
            throw new Error(`Proposal not found: ${proposalUri}`)
          }

          const recordData = JSON.parse(proposalRecord.record)
          targetUri = recordData.uri
          targetCid = recordData.cid
          labelValue = recordData.val

          scoringLog.debug(
            {
              proposalUri,
              targetUri,
              targetCid: targetCid || null,
              labelValue,
              operation: 'proposal_data_looked_up',
            },
            'Proposal data looked up from database',
          )
        } catch (error) {
          scoringLog.error(
            {
              proposalUri,
              error: error instanceof Error ? error.message : error,
              operation: 'proposal_lookup_failed',
            },
            'Failed to look up proposal data from database',
          )
          throw error
        }
      } else {
        throw new Error('Database not available for proposal lookup')
      }

      // 2. Insert score event (triggers create pending labels)
      const scoreEventData: any = {
        proposalUri,
        targetUri,
        status,
        score,
        labelValue,
      }

      // Only add optional fields if they have values
      if (targetCid !== undefined) {
        scoreEventData.targetCid = targetCid
      }

      await this.db.db.insertInto('scoreEvent').values(scoreEventData).execute()

      const dbTime = Date.now() - startTime
      scoringLog.info(
        {
          proposalUri,
          targetUri,
          status,
          score,
          labelValue,
          targetCid: targetCid || null,
          dbTime,
          operation: 'score_event_inserted',
        },
        'Score event inserted successfully',
      )

      // 3. Immediately sync all pending labels
      const syncStartTime = Date.now()
      await this.syncPendingLabels()
      const syncTime = Date.now() - syncStartTime

      const totalTime = Date.now() - startTime
      scoringLog.info(
        {
          proposalUri,
          targetUri,
          status,
          score,
          labelValue,
          targetCid: targetCid || null,
          dbTime,
          syncTime,
          totalTime,
          operation: 'score_updated_complete',
        },
        'Score updated and labels synced successfully',
      )
    } catch (error) {
      const totalTime = Date.now() - startTime
      scoringLog.error(
        {
          proposalUri,
          status,
          score,
          totalTime,
          error: error instanceof Error ? error.message : error,
          stack: error instanceof Error ? error.stack : undefined,
          operation: 'score_update_failed',
        },
        'Failed to update score',
      )
      throw error
    }
  }

  /**
   * Sync all pending labels (called synchronously after score)
   */
  private async syncPendingLabels(): Promise<void> {
    const pendingLabels = await this.getPendingLabels()

    if (pendingLabels.length === 0) {
      return
    }

    scoringLog.debug({ count: pendingLabels.length }, 'Syncing pending labels')

    for (const pendingLabel of pendingLabels) {
      await this.syncSingleLabel(pendingLabel)
    }
  }

  /**
   * Get all pending labels that need syncing
   */
  private async getPendingLabels(): Promise<PendingLabel[]> {
    if (!this.db) {
      return []
    }

    const results = await this.db.db
      .selectFrom('pendingLabels')
      .selectAll()
      .orderBy('createdAt', 'asc')
      .execute()

    return results.map((row) => ({
      id: row.id!,
      scoreEventId: row.scoreEventId,
      targetUri: row.targetUri,
      targetCid: row.targetCid,
      labelValue: row.labelValue,
      negative: Boolean(row.negative), // Convert SQLite integer to boolean
      createdAt: row.createdAt,
    }))
  }

  /**
   * Sync a single pending label with delete-on-success pattern
   */
  private async syncSingleLabel(pendingLabel: PendingLabel): Promise<void> {
    let labelerSuccess = false

    try {
      // Sync to external labeler (simple HTTP GET)
      await this.callExternalLabeler(pendingLabel)
      labelerSuccess = true
      scoringLog.debug(
        { labelId: pendingLabel.id },
        '🏷️  Label synced to external labeler',
      )
    } catch (error) {
      scoringLog.error(
        {
          error: error instanceof Error ? error.message : error,
          stack: error instanceof Error ? error.stack : undefined,
          labelId: pendingLabel.id,
          targetUri: pendingLabel.targetUri,
          labelValue: pendingLabel.labelValue,
        },
        '🚨 Failed to sync label to external labeler',
      )
      throw error
    }

    if (labelerSuccess) {
      await this.db!.db.deleteFrom('pendingLabels')
        .where('id', '=', pendingLabel.id)
        .execute()

      scoringLog.info(
        {
          labelId: pendingLabel.id,
          targetUri: pendingLabel.targetUri,
          labelValue: pendingLabel.labelValue,
          negative: pendingLabel.negative,
          labelerDid: this.config.labeler.did,
        },
        '✅ Label fully synced and removed from pending',
      )
    } else {
      scoringLog.warn(
        {
          labelId: pendingLabel.id,
          labelerSuccess,
        },
        '⚠️  Label partially synced - keeping in pending for retry',
      )
    }
  }

  /**
   * Call external labeler service with simple HTTP GET
   */
  private async callExternalLabeler(pendingLabel: PendingLabel): Promise<void> {
    const labelerUrl = this.config.labeler.url
    if (!labelerUrl) {
      throw new Error('LABELER_URL not configured')
    }

    const url = `${labelerUrl}/label?uri=${encodeURIComponent(pendingLabel.targetUri)}&label=${encodeURIComponent(pendingLabel.labelValue)}&neg=${pendingLabel.negative ? 'true' : 'false'}`
    scoringLog.info(
      {
        url,
        labelId: pendingLabel.id,
        targetUri: pendingLabel.targetUri,
        labelValue: pendingLabel.labelValue,
        negative: pendingLabel.negative,
      },
      'Calling external labeler service',
    )

    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(
        `Labeler request failed: ${response.status} ${response.statusText}`,
      )
    }

    scoringLog.info(
      {
        labelId: pendingLabel.id,
        status: response.status,
      },
      'External labeler call successful',
    )
  }

  async close(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve, reject) => {
        this.server!.close((err) => {
          if (err) reject(err)
          else resolve()
        })
      })
    }
    if (this.internalServer) {
      await new Promise<void>((resolve, reject) => {
        this.internalServer!.close((err) => {
          if (err) reject(err)
          else resolve()
        })
      })
    }
    if (this.db) {
      await this.db.close()
    }
  }
}

export default NotesService
