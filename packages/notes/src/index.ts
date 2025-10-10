import {
  Server as HttpServer,
  createServer as createHttpServer,
} from 'node:http'
import cors from 'cors'
import express, { json } from 'express'
import { AtpAgent } from '@atproto/api'
import getConfig from './api/org/opencommunitynotes/getConfig'
import getProposals from './api/org/opencommunitynotes/getProposals'
import propose from './api/org/opencommunitynotes/propose'
import vote from './api/org/opencommunitynotes/vote'
import { AuthService } from './auth'
import { createRouter as createBasicRouter } from './basic-routes'
import {
  type NotesServiceConfig,
  type RepoAccount,
  envToCfg,
  readEnv,
} from './config'
import { AppContext } from './context'
import { Database } from './db'
import { registerFeedHandlers } from './feeds'
import { createServer } from './lexicon'
import { appLogger as log, loggerMiddleware } from './logger'
import { createAuthMiddleware } from './middleware/auth'
import { errorHandlingMiddleware } from './middleware/error-handling'
import { getOrCreatePdsAgent } from './utils'
import wellKnown from './well-known'

export interface PendingLabel {
  id: number
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
  private labelSyncInterval?: NodeJS.Timeout
  private labelSyncTimeout?: NodeJS.Timeout
  private isClosing = false
  private ctx?: AppContext

  public repoAccount: RepoAccount
  public feedgenDocumentDid: string
  public pdsUrl: string

  constructor(private config: NotesServiceConfig) {
    this.repoAccount = config.repoAccount

    this.feedgenDocumentDid = config.feedgenDocumentDid
    this.pdsUrl = config.pdsUrl
  }

  static async create(config: NotesServiceConfig): Promise<NotesService> {
    return new NotesService(config)
  }

  async start(): Promise<HttpServer> {
    // Validate required repository account configuration
    if (this.config.port === 0) {
      throw new Error('port == 0')
    }

    if (this.config.internalApiPort === 0) {
      throw new Error('internalApiPort == 0')
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
        origin: true, // Allow requests from any domain
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
    app.use(json())

    const server = createServer()

    const auth = new AuthService(this.config.pdsUrl)
    const authMiddleware = createAuthMiddleware(auth)

    const ctx: AppContext = {
      auth,
      db: this.db,
      aidSalt: this.config.aidSalt,
      repoAccount: this.repoAccount,
      feedgenDocumentDid: this.feedgenDocumentDid,
      pdsUrl: this.pdsUrl,
      reqLabelers: () => ({}), // Mocked for now
      config: this.config,
      notesService: this, // Pass NotesService instance for label sync
    }

    // Store context for cleanup
    this.ctx = ctx

    // Add basic routes (root, health, robots.txt)
    const basicRouter = createBasicRouter(ctx)
    app.use(basicRouter)

    // Register endpoints
    getConfig(server, ctx)
    getProposals(server, ctx)
    vote(server, ctx)
    propose(server, ctx)

    // Register feed endpoints
    registerFeedHandlers(app, ctx)

    wellKnown(app, ctx)

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
    internalApp.use(json())

    // Internal API endpoint for scoring
    internalApp.post('/score', async (req, res) => {
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
        log.error(
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
    await this.createFeedGeneratorRecords()

    const port = this.config.port

    this.server.listen(port, () => {
      log.info({ port }, `HTTP listening`)
    })

    const internalApiPort = this.config.internalApiPort

    this.internalServer.listen(internalApiPort, '::', () => {
      log.info({ internalApiPort }, `Internal HTTP listening on IPv6`)
    })

    // Start background label sync
    this.startBackgroundLabelSync()

    return this.server
  }

  /**
   * Create feed generator records idempotently on service startup
   */
  private async createFeedGeneratorRecords(): Promise<void> {
    if (!this.repoAccount?.did || !this.config.pdsUrl) {
      throw new Error('Repository account/PDS URL not configured')
    }

    let agent: AtpAgent | undefined
    try {
      log.info('Creating Community Notes feed generator records...')

      const { agent: pdsAgent, serviceRepoId } = await getOrCreatePdsAgent({
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
            did: this.feedgenDocumentDid,
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

          // Use putRecord for idempotent creation
          const { data } = await agent.com.atproto.repo.putRecord({
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
            'Feed generator record created/updated successfully',
          )
        } catch (error: any) {
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

    log.debug(
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

          log.debug(
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
          log.error(
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
      log.info(
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
      log.info(
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
      log.error(
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
   * Sync all pending labels with comprehensive error handling
   * @returns Number of labels successfully synced
   */
  async syncPendingLabels(): Promise<number> {
    // Skip if service is closing
    if (this.isClosing) {
      return 0
    }

    try {
      const pendingLabels = await this.getPendingLabels()

      if (pendingLabels.length === 0) {
        return 0
      }

      log.debug({ count: pendingLabels.length }, 'Syncing pending labels')

      let syncedCount = 0
      for (const pendingLabel of pendingLabels) {
        try {
          await this.syncSingleLabel(pendingLabel)
          syncedCount++
        } catch (error) {
          log.error(
            {
              error: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
              labelId: pendingLabel.id,
              targetUri: pendingLabel.targetUri,
              labelValue: pendingLabel.labelValue,
              negative: pendingLabel.negative,
            },
            'Failed to sync individual label - continuing with others',
          )
          // Continue with other labels instead of failing entirely
        }
      }

      return syncedCount
    } catch (error) {
      log.error(
        {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
        'Failed to sync pending labels',
      )
      // Don't throw - this should not fail the calling operation
      return 0
    }
  }

  /**
   * Start background label sync process
   */
  private startBackgroundLabelSync(): void {
    // Initial sync after 30 seconds (let service stabilize)
    this.labelSyncTimeout = setTimeout(() => {
      this.backgroundSyncPendingLabels()
    }, 30_000)

    // Then every 5 minutes
    this.labelSyncInterval = setInterval(
      () => {
        this.backgroundSyncPendingLabels()
      },
      5 * 60 * 1000,
    ) // 5 minutes

    log.info('Background label sync started (5 minute interval)')
  }

  /**
   * Background sync wrapper that logs results
   */
  private async backgroundSyncPendingLabels(): Promise<void> {
    // Skip if service is closing
    if (this.isClosing) {
      return
    }

    const syncedCount = await this.syncPendingLabels()
    if (syncedCount > 0) {
      log.info({ count: syncedCount }, 'Background synced labels')
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
    // Sync to external labeler (simple HTTP GET)
    await this.callExternalLabeler(pendingLabel)

    await this.db!.db.deleteFrom('pendingLabels')
      .where('id', '=', pendingLabel.id)
      .execute()

    log.info(
      {
        labelId: pendingLabel.id,
        targetUri: pendingLabel.targetUri,
        labelValue: pendingLabel.labelValue,
        negative: pendingLabel.negative,
        labelerDid: this.config.labeler.did,
      },
      '✅ Label fully synced and removed from pending',
    )
  }

  /**
   * Call external labeler service with simple HTTP GET
   */
  private async callExternalLabeler(pendingLabel: PendingLabel): Promise<void> {
    const labelerUrl = this.config.labeler.url
    if (!labelerUrl) {
      throw new Error('LABELER_URL not configured')
    }

    const url = `${labelerUrl}/label?uri=${encodeURIComponent(pendingLabel.targetUri)}&val=${encodeURIComponent(pendingLabel.labelValue)}&neg=${pendingLabel.negative ? 'true' : 'false'}`

    const requestContext = {
      labelId: pendingLabel.id,
      requestUri: url,
      requestBody: {
        uri: pendingLabel.targetUri,
        val: pendingLabel.labelValue,
        neg: pendingLabel.negative ? 'true' : 'false',
      },
    }

    log.info(
      {
        ...requestContext,
        targetUri: pendingLabel.targetUri,
        labelValue: pendingLabel.labelValue,
        negative: pendingLabel.negative,
      },
      'Calling external labeler service',
    )

    let response: Response
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'atproto-community-notes/1.0',
        },
      })
    } catch (error) {
      // Network/fetch errors
      log.error(
        {
          ...requestContext,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        },
        'Network error calling labeler service',
      )
      throw error
    }

    // Parse response body (try JSON first, fall back to text)
    let responseData: any
    try {
      responseData = await response.json()
    } catch {
      responseData = await response.text()
    }

    if (response.ok) {
      log.info(
        {
          labelId: pendingLabel.id,
          status: response.status,
          statusText: response.statusText,
          responseData,
        },
        'Labeler response received successfully',
      )
    } else {
      // HTTP error responses (4xx, 5xx)
      log.error(
        {
          ...requestContext,
          status: response.status,
          statusText: response.statusText,
          labelerErrorMessage: responseData,
        },
        'Labeler service returned error response',
      )

      throw new Error(
        `Labeler request failed: ${response.status} ${response.statusText}`,
      )
    }
  }

  async close(): Promise<void> {
    // Set closing flag to prevent new background sync operations
    this.isClosing = true

    // Clean up cached PDS agent to prevent connection leaks
    if (this.ctx) {
      await this.cleanupPdsAgent(this.ctx)
    }

    // Clean up background label sync
    if (this.labelSyncTimeout) {
      clearTimeout(this.labelSyncTimeout)
      this.labelSyncTimeout = undefined
    }
    if (this.labelSyncInterval) {
      clearInterval(this.labelSyncInterval)
      this.labelSyncInterval = undefined
      log.info('Background label sync stopped')
    }

    // Give any running background sync a moment to complete
    await new Promise((resolve) => setTimeout(resolve, 100))

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

  /**
   * Clean up cached PDS agent to prevent connection leaks
   */
  private async cleanupPdsAgent(ctx: AppContext): Promise<void> {
    if (ctx.pdsAgent?.agent) {
      try {
        await ctx.pdsAgent.agent.logout()
        log.debug('Cached PDS agent logged out')
      } catch (error) {
        log.warn({ error }, 'Error during cached PDS agent cleanup')
      }
      ctx.pdsAgent = undefined
    }
  }
}

export default NotesService
export { envToCfg, readEnv }
