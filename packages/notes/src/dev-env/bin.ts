import 'dotenv/config'
import { TestNetworkWrapper } from './test-network-wrapper'

const run = async () => {
  console.log(`

         __                         __
        /\\ \\__                     /\\ \\__
    __  \\ \\ ,_\\  _____   _ __   ___\\ \\ ,_\\   ___
  /'__'\\ \\ \\ \\/ /\\ '__'\\/\\''__\\/ __'\\ \\ \\/  / __'\\
 /\\ \\L\\.\\_\\ \\ \\_\\ \\ \\L\\ \\ \\ \\//\\ \\L\\ \\ \\ \\_/\\ \\L\\ \\
 \\ \\__/.\\_\\\\ \\__\\\\ \\ ,__/\\ \\_\\\\ \\____/\\ \\__\\ \\____/
  \\/__/\\/_/ \\/__/ \\ \\ \\/  \\/_/ \\/___/  \\/__/\\/___/
                   \\ \\_\\
                    \\/_/


                            with:

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



[ created by Bluesky and Jonathan Warden ]
`)

  // Create extended network with notes and labeler support
  const network = await TestNetworkWrapper.create({
    pds: {
      port: 2583,
      inviteRequired: false,
    },
    plc: { port: 2582 },
    bsky: {
      port: 2584,
      dbPostgresSchema: 'bsky',
    },
    // ozone: {
    //   port: 2587,
    //   dbPostgresSchema: 'ozone',
    // },
    introspect: { port: 2581 },
    notes: { port: 2595, internalPort: 2596 },
    // Add labeler and notes services
    labeler: { port: 2597 },
  })

  // Log core services (notes and labeler already logged during creation)
  console.log(
    `👤 DID Placeholder server started http://localhost:${network.network.plc.port}`,
  )
  console.log(
    `🌞 Personal Data server started http://localhost:${network.network.pds.port}`,
  )
  console.log(
    `🗼 Ozone server started http://localhost:${network.network.ozone.port}`,
  )
  console.log(
    `🗼 Ozone service DID ${network.network.ozone.ctx.cfg.service.did}`,
  )
  console.log(
    `🌅 Bsky Appview started http://localhost:${network.network.bsky.port}`,
  )
  console.log(`🏷️ Test Labeler service started ${network.labeler!.url}`)
  console.log(`🔧 Labeler DID: ${network.labeler!.labelerDid}`)
  console.log(
    `🔍 Enhanced introspection server started http://localhost:${network.introspectWrapper!.port}`,
  )
  console.log(
    `📝 Community Notes server started http://localhost:${network.notes.port}`,
  )
  console.log(
    `📝 Community Notes service DID ${network.notes.serviceAccount.did}`,
  )

  // Generate mock data
  console.log('Generating mock setup')
  await network.generateMockSetupWrapper()

  console.log('✅ Dev environment ready')
}

run().catch(console.error)
