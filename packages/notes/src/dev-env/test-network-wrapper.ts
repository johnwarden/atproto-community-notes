import { TestNetwork } from '@atproto/dev-env'
import { generateMockSetup } from '@atproto/dev-env/dist/mock'
import { createTestNotes } from '../test-notes'
import { IntrospectWrapper } from './introspect-wrapper'
import { TestLabeler } from './test-labeler'

/**
 * Extended TestNetwork that adds support for Notes service and Labeler
 * This wraps the original TestNetwork without modifying it
 */
export class TestNetworkWrapper {
  public network: TestNetwork
  public labeler?: TestLabeler
  public notes?: any // Direct TestNotes instance
  public introspectWrapper?: IntrospectWrapper

  constructor(network: TestNetwork) {
    this.network = network
  }

  static async create(
    params: Parameters<typeof TestNetwork.create>[0] & {
      labeler: { port: number }
      notes: { port: number; internalPort: number }
    },
  ): Promise<TestNetworkWrapper> {
    // Extract notes-specific params
    const { labeler, ...baseParams } = params

    // Create base network without modifications
    const network = await TestNetwork.create(baseParams)
    const wrapper = new TestNetworkWrapper(network)

    // Add labeler if requested
    wrapper.labeler = await TestLabeler.create({
      port: labeler.port,
      bskyDb: network.bsky.db, // Pass the actual bsky database connection
      pdsUrl: network.pds.url, // Pass PDS URL for service account creation
    })

    // Add notes service if requested and labeler exists
    if (wrapper.labeler) {
      wrapper.notes = await createTestNotes({
        port: baseParams.notes.port,
        internalPort: baseParams.notes.internalPort,
        plcUrl: network.plc.url,
        pdsUrl: network.pds.url,
        labelerDid: wrapper.labeler.labelerDid,
        labelerUrl: wrapper.labeler.url,
      })
    }

    // Create enhanced introspection server that includes notes and labeler info
    if (network.introspect) {
      // Close the original introspect server
      await network.introspect.close()

      // Create our enhanced version
      wrapper.introspectWrapper = await IntrospectWrapper.create(
        network,
        wrapper.notes,
        wrapper.labeler,
      )
    }

    return wrapper
  }

  async generateMockSetupWrapper() {
    // First, run the standard mock setup which creates users and posts
    await generateMockSetup(this.network)

    // Then generate notes-specific mock data using the existing users
    await this.generateNotesMockSetup()

    // Mark mock setup as complete in our introspection wrapper
    if (this.introspectWrapper) {
      this.introspectWrapper.mockSetupComplete()
    }
  }

  private async generateNotesMockSetup() {
    // Use the existing mock users created by generateMockSetup

    // Login as the existing mock users
    const userCredentials = [
      { email: 'alice@test.com', handle: 'alice.test', password: 'hunter2' },
      { email: 'bob@test.com', handle: 'bob.test', password: 'hunter2' },
      { email: 'carla@test.com', handle: 'carla.test', password: 'hunter2' },
    ]

    const userAgents = await Promise.all(
      userCredentials.map(async (creds) => {
        const client = this.network.pds.getClient() as any
        await client.login({
          identifier: creds.handle,
          password: creds.password,
        })
        return client
      }),
    )

    // Get some existing posts from the timeline to use for Community Notes
    // The generateMockSetup function has already created posts
    const alice = userAgents[0]
    const timeline = await alice.app.bsky.feed.getTimeline({ limit: 10 })
    const existingPosts = timeline.data.feed.slice(0, 6) // Use first 6 posts

    if (this.notes && this.labeler) {
      // Get Alice's JWT for creating proposals and ratings
      const aliceAgent = userAgents.find(
        (agent) => agent.session?.handle === 'alice.test',
      )
      if (!aliceAgent?.session?.accessJwt) {
        // Skip Community Notes creation if no JWT available
      } else {
        const proposalUris: string[] = []

        // Create proposals for existing posts
        for (let i = 0; i < existingPosts.length; i++) {
          const feedItem = existingPosts[i]
          const post = feedItem.post
          try {
            const response = await fetch(
              `${this.notes.url}/xrpc/org.opencommunitynotes.createProposal`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${aliceAgent.session.accessJwt}`,
                },
                body: JSON.stringify({
                  typ: 'label',
                  uri: post.uri,
                  val: 'needs-context',
                  note: `This post may be misleading. Test note ${i + 1} for Community Notes integration.`,
                  reasons: ['misrepresentation_or_missing_context'],
                }),
              },
            )

            if (response.ok) {
              const createResult = (await response.json()) as any
              proposalUris.push(createResult.uri)
              // Proposal created successfully
            } else {
              const errorText = await response.text()
              throw new Error(
                `Failed to create proposal for ${post.uri}: ${response.status} ${errorText}`,
              )
            }
          } catch (error) {
            console.error(
              `❌ [MOCK] Error creating proposal for ${post.uri}:`,
              error,
            )
            throw error
          }
        }

        // Alice rates ALL her proposals as helpful
        for (let i = 0; i < proposalUris.length; i++) {
          const proposalUri = proposalUris[i]
          try {
            const rateResponse = await fetch(
              `${this.notes.url}/xrpc/org.opencommunitynotes.rateProposal`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${aliceAgent.session.accessJwt}`,
                },
                body: JSON.stringify({
                  uri: proposalUri,
                  val: 1, // Helpful
                  reasons: ['helpful'],
                }),
              },
            )

            if (!rateResponse.ok) {
              const errorText = await rateResponse.text()
              throw new Error(
                `Failed to rate proposal ${proposalUri}: ${rateResponse.status} ${errorText}`,
              )
            }
            // Proposal rated successfully
          } catch (error) {
            console.error(
              `❌ [MOCK] Error rating proposal ${proposalUri}:`,
              error,
            )
            throw error
          }
        }

        // Wait a moment for notes service to be fully ready
        await new Promise((resolve) => setTimeout(resolve, 1000))

        // Simulate algorithm behavior by calling /score directly
        // All proposals start with needs_more_ratings status and proposed-note:needs-context label
        // Later, some will be updated to rated_helpful based on algorithm decisions

        // First pass: Set all proposals to needs_more_ratings with proposed-note:needs-context
        for (let i = 0; i < proposalUris.length; i++) {
          const proposalUri = proposalUris[i]

          try {
            const scoreResponse = await fetch(
              `${this.notes.internalUrl}/internal/score`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  proposalUri,
                  status: 'needs_more_ratings',
                  score: 0.1 + i * 0.05, // Small varied scores: 0.1, 0.15, 0.2, 0.25, 0.3, 0.35
                }),
              },
            )

            if (!scoreResponse.ok) {
              const errorText = await scoreResponse.text()
              throw new Error(
                `Failed to set initial score for ${proposalUri}: ${scoreResponse.status} ${errorText}`,
              )
            }
          } catch (error) {
            console.error(
              `❌ [MOCK] Error setting initial score for ${proposalUri}:`,
              error,
            )
            throw error
          }
        }

        // Second pass: Update first 3 proposals to rated_helpful (algorithm decided they're helpful)
        const helpfulCount = Math.min(3, proposalUris.length)
        for (let i = 0; i < helpfulCount; i++) {
          const proposalUri = proposalUris[i]

          try {
            const scoreResponse = await fetch(
              `${this.notes?.internalUrl}/internal/score`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  proposalUri,
                  status: 'rated_helpful',
                  score: 0.7 + i * 0.1, // Higher scores: 0.7, 0.8, 0.9
                }),
              },
            )

            if (!scoreResponse.ok) {
              const errorText = await scoreResponse.text()
              throw new Error(
                `Failed to update score for ${proposalUri}: ${scoreResponse.status} ${errorText}`,
              )
            }
          } catch (error) {
            console.error(
              `❌ [MOCK] Error updating score for ${proposalUri}:`,
              error,
            )
            throw error
          }
        }

        // Community Notes creation complete with algorithm simulation
      }
    } else {
      throw new Error('Notes service not available')
    }
    // TODO: Implement actual notes mock data generation
    // This could include:
    // - Sample community notes on posts
    // - Sample ratings from users
    // - Sample labeler responses
    // - Feed generator records for notes
  }

  async close() {
    await this.network.close()
    if (this.labeler) {
      await this.labeler.close()
    }
    if (this.notes) {
      await this.notes.close()
    }
    if (this.introspectWrapper) {
      await this.introspectWrapper.close()
    }
  }

  // Proxy common properties for convenience
  get pds() {
    return this.network.pds
  }
  get bsky() {
    return this.network.bsky
  }
  get ozone() {
    return this.network.ozone
  }
  get plc() {
    return this.network.plc
  }
  get introspect() {
    return this.introspectWrapper || this.network.introspect
  }
}
