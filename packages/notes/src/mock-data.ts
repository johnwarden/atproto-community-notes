/**
 * Community Notes mock data setup
 * This module contains notes-specific mock data generation that can be injected into dev-env
 */

export interface MockPost {
  uri: string
  cid: string
}

export interface MockUserAgent {
  session?: {
    handle: string
    accessJwt: string
  }
}

export interface NotesTestService {
  url: string
  internalUrl: string
}

export interface LabelerTestService {
  url: string
  labelerDid: string
}

/**
 * Generate Community Notes mock data
 * This function creates proposals, ratings, and scoring data for testing
 */
export async function generateNotesMockData(
  posts: MockPost[],
  userAgents: MockUserAgent[],
  notesService: NotesTestService,
  labelerService: LabelerTestService,
): Promise<void> {
  // Community Notes integration using real endpoints
  const postsForCommunityNotes = posts.slice(0, 6)

  // Get Alice's JWT for creating proposals and ratings
  const aliceAgent = userAgents.find(
    (agent) => agent.session?.handle === 'alice.test',
  )
  if (!aliceAgent?.session?.accessJwt) {
    console.warn(
      '⚠️ [MOCK] Skipping Community Notes creation - no JWT available',
    )
    return
  }

  const proposalUris: string[] = []

  // Create proposals for all 6 posts
  for (let i = 0; i < 6; i++) {
    const post = postsForCommunityNotes[i]
    try {
      const response = await fetch(
        `${notesService.url}/xrpc/org.opencommunitynotes.createProposal`,
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
      console.error(`❌ [MOCK] Error creating proposal for ${post.uri}:`, error)
      throw error
    }
  }

  // Alice rates ALL her proposals as helpful
  for (let i = 0; i < 6; i++) {
    const proposalUri = proposalUris[i]
    try {
      const rateResponse = await fetch(
        `${notesService.url}/xrpc/org.opencommunitynotes.rateProposal`,
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
      console.error(`❌ [MOCK] Error rating proposal ${proposalUri}:`, error)
      throw error
    }
  }

  // Wait a moment for notes service to be fully ready
  await new Promise((resolve) => setTimeout(resolve, 1000))

  // Simulate algorithm behavior by calling /score directly
  // All proposals start with needs_more_ratings status and proposed-note:needs-context label
  // Later, some will be updated to rated_helpful based on algorithm decisions

  // First pass: Set all proposals to needs_more_ratings with proposed-note:needs-context
  for (let i = 0; i < 6; i++) {
    const proposalUri = proposalUris[i]

    try {
      const scoreResponse = await fetch(
        `${notesService.internalUrl}/internal/score`,
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
  for (let i = 0; i < 3; i++) {
    const proposalUri = proposalUris[i]

    try {
      const scoreResponse = await fetch(
        `${notesService.internalUrl}/internal/score`,
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
      console.error(`❌ [MOCK] Error updating score for ${proposalUri}:`, error)
      throw error
    }
  }

  console.log(
    '✅ [MOCK] Community Notes creation complete with algorithm simulation',
  )
}
