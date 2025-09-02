import { Router } from 'express'
import { AppContext } from './context'

export const createRouter = (ctx: AppContext): Router => {
  const router = Router()

  router.get('/', function (req, res) {
    res.type('text/plain')
    res.send(`
   ___                                      _ _
  / __\\___  _ __ ___  _ __ ___  _   _ _ __ (_) |_ _   _
 / /  / _ \\| '_ \\ _ \\| '_ \\ _ \\| | | | '_ \\| | __| | | |
/ /__| (_) | | | | | | | | | | | |_| | | | | | |_| |_| |
\\____/\\___/|_| |_| |_|_| |_| |_|\\__,_|_| |_|_|\\__|\\__, |
                                                  |___/
     __      _
  /\\ \\ \\___ | |_ ___  ___
 /  \\/ / _ \\| __/ _ \\/ __|
/ /\\  / (_) | ||  __/\\__ \\
\\_\\ \\/ \\___/ \\__\\___||___/


This is an AT Protocol Community Notes Service

Similar to Twitter/X's Community Notes, this service allows users to add helpful
context notes to content and rate the helpfulness of existing notes.

Protocol: https://github.com/johnwarden/open-community-notes/tree/master/proposals/001-architecture
`)
  })

  router.get('/robots.txt', function (req, res) {
    res.type('text/plain')
    res.send(
      '# Hello!\n\n# Crawling the public API is allowed\nUser-agent: *\nAllow: /',
    )
  })

  router.get('/health', async function (req, res) {
    try {
      // Check database connection if available
      if (ctx.db?.db) {
        await ctx.db.db.selectFrom('record').select('uri').limit(1).execute()
      }

      res.send({
        status: 'healthy',
        service: 'Community Notes',
        database: ctx.db ? 'connected' : 'not configured',
      })
    } catch (err) {
      req.log?.error({ err }, 'failed health check')
      res.status(503).send({
        status: 'unhealthy',
        service: 'Community Notes',
        error: 'Service Unavailable',
      })
    }
  })

  return router
}
