/* eslint-env node */

'use strict'

const { NotesService, envToCfg, readEnv } = require('@atproto/notes')

const main = async () => {
  // Read environment variables and create configuration
  const env = readEnv()
  const config = envToCfg(env)
  
  // Create and start the notes service with configuration
  const notesService = await NotesService.create(config)

  await notesService.start()

  console.log('Community Notes service is running')
  console.log(`Main API listening on port ${config.port}`)
  console.log(`Internal API listening on port ${config.internalApiPort}`)
  console.log(`Database: ${config.dbPath}`)

  // Graceful shutdown (see also https://aws.amazon.com/blogs/containers/graceful-shutdowns-with-ecs/)
  process.on('SIGTERM', async () => {
    console.log('Community Notes service is stopping')
    await notesService.close()
    console.log('Community Notes service is stopped')
  })
}

main().catch((err) => {
  console.error('Failed to start Community Notes service:', err)
  process.exit(1)
})
