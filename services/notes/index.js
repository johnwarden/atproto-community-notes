/* eslint-env node */

'use strict'

const { NotesService } = require('@atproto/notes')

const main = async () => {
  // Create and start the notes service
  // The service will read configuration from environment variables
  const notesService = await NotesService.create()

  await notesService.start()

  console.log('Community Notes service is running')

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
