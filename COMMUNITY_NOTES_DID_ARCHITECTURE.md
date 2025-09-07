# Community Notes DID Architecture

## Overview

The Community Notes service uses a **multi-DID architecture** following AT Protocol best practices, where different DIDs serve distinct roles for feed generation, repository operations, and labeling.

## DID Roles and Architecture

### 1. Feed Generator Document DID (DOCUMENT ONLY)
**Role**: Service discovery for feed generator

**Responsibilities**:
- **Service Discovery**: Contains `BskyFeedGenerator` service endpoint in DID document
- **Feed Identification**: Used in feed generator records to identify the service
- **No Authentication**: Document-only DID, cannot authenticate or store records

**Why Document DID**: The feed generator document DID can be document-only because:
- It's only used for service discovery (finding the feed endpoint)
- Feed generator records are stored by the **repository account**, not the document DID
- Clients resolve the document DID to find the service endpoint, but don't need it to be an actor

**Environment Variables**:
```bash
FEEDGEN_DOCUMENT_DID=did:plc:your-feedgen-document-did
```

### 2. Repository Account DID (ACTOR)
**Role**: Single repository for all records (simplified architecture)

**Responsibilities**:
- **Feed Repository**: Stores `app.bsky.feed.generator` records for feed discovery
- **Notes Repository**: Stores `social.pmsky.proposal` and `social.pmsky.vote` records
- **AID Generation**: Signing key used for Anonymous ID generation (privacy protection)
- **PDS Authentication**: Authenticates with PDS for all record operations

**Environment Variables**:
```bash
REPO_DID=did:plc:your-repo-did
REPO_SIGNING_KEY=your-repo-signing-key
REPO_PASSWORD=your-repo-password
```

### 3. Labeler DID (ACTOR)
**Role**: Community Notes labeling service

**Responsibilities**:
- **Label Generation**: Creates Community Notes labels (`needs-context`, etc.)
- **Label Signing**: Signs labels with labeler signing key
- **Actor Account**: Must be an actor (DID with PDS account) for `getActors()` to work
- **Label Service**: Has `AtprotoLabeler` service in DID document

**Why Actor Required**: The labeler DID must be an **actor** (not just a document DID) because:
- Bsky's `getActors()` method only returns DIDs that exist in the `actor` table
- Labeler filtering in `createContext()` uses `getActors()` to validate labeler existence
- Document-only DIDs are not indexed in the actor table and will be filtered out

**Environment Variables**:
```bash
LABELER_DID=did:plc:your-labeler-actor-did
LABELER_SIGNING_KEY=your-labeler-signing-key
```

## Development Environment Setup

### DID Creation in Dev-Env

The dev-env automatically creates all required DIDs and accounts:

```typescript
// 1. Feed Generator Document DID (service discovery only)
const feedgenDocumentDid = await createFeedGeneratorDid(plcUrl, port)
// Creates document DID with BskyFeedGenerator service

// 2. Repository Account (for both feed records and notes records in dev-env)
const repoAccount = await createRepoAccount(pdsUrl, keypair)
// Creates actor account in PDS for repository operations

// 3. Labeler Actor (must be actor for getActors() to work)
const labelerDid = await createLabelerActor(pdsUrl, plcUrl, port)
// Creates actor account with AtprotoLabeler service
```

### Why Separate Repository and Document DIDs?

**Repository DIDs** (actors) and **Document DIDs** serve different purposes:

- **Repository DIDs**: Store records, authenticate, have PDS accounts
  - Used for: Storing feed generator records, proposal records, vote records
  - Must be actors with authentication capabilities

- **Document DIDs**: Service discovery, contain service endpoints
  - Used for: Clients finding feed endpoints, labeler endpoints
  - Can be document-only, no authentication needed

**Separation Benefits**:
- **Security**: Repository keys can be rotated without changing service discovery
- **Flexibility**: Service endpoints can move without affecting stored records
- **Scalability**: Multiple repositories can serve the same service
- **AT Protocol Compliance**: Follows standard patterns for service architecture

**Key Architectural Insight**:
- **Labeler must be actor**: Required for `getActors()` validation in labeler filtering
- **Feed generator can be document**: Only used for service discovery, not validation
- **Repository accounts are actors**: Need authentication to store records

This follows the same pattern as other feed generators in dev-env:
- **Alice's feed generator**: Alice's DID stores feed records pointing to separate feed generator DID

## Technical Implementation Details

### Actor vs Document DID Requirements

**Actors (DIDs with PDS accounts)**:
- Created via `createAccount()` on PDS
- Indexed in bsky's `actor` table
- Found by `getActors()` method
- Can authenticate and store records
- **Required for**: Labelers (validation), Repository accounts (record storage)

**Document DIDs (PLC-only DIDs)**:
- Created via PLC operations only
- Not in bsky's `actor` table
- Not found by `getActors()`
- Cannot authenticate or store records
- **Sufficient for**: Service discovery endpoints

### Labeler Filtering Technical Flow

```typescript
// In bsky's hydrator createContext():
const labelerActors = await this.actor.getActors(nonServiceLabelers)
// getActors() queries: SELECT * FROM actor WHERE did IN (labelerDids)
// Document-only DIDs return empty, actors return data

const availableDids = labelers.filter(
  (did) => this.serviceLabelers.has(did) || !!labelerActors.get(did)
)
// Only actors or service labelers pass this filter
```

**Result**: Document-only labeler DIDs are filtered out, breaking labeler functionality.

## Production Deployment

### 1. Create Feed Generator Document DID

```bash
# Create document DID with BskyFeedGenerator service
curl -X POST https://plc.directory/xrpc/com.atproto.identity.submitPlcOperation \
  -H "Content-Type: application/json" \
  -d '{
    "type": "plc_operation",
    "verificationMethods": {
      "atproto": "did:key:your-public-key"
    },
    "rotationKeys": ["did:key:your-rotation-key"],
    "alsoKnownAs": [],
    "services": {
      "bsky_fg": {
        "type": "BskyFeedGenerator",
        "serviceEndpoint": "https://your-domain.com"
      }
    },
    "prev": null
  }'
```

### 2. Create Repository Account

```bash
# Create single repository account for all records
curl -X POST https://your-pds.com/xrpc/com.atproto.server.createAccount \
  -H "Content-Type: application/json" \
  -d '{
    "handle": "repo.your-domain.com",
    "email": "repo@your-domain.com",
    "password": "secure-password"
  }'
```

### 3. Create Labeler Account

```bash
# Create labeler account (must be actor for getActors() validation)
curl -X POST https://your-pds.com/xrpc/com.atproto.server.createAccount \
  -H "Content-Type: application/json" \
  -d '{
    "handle": "labeler.your-domain.com",
    "email": "labeler@your-domain.com",
    "password": "secure-password"
  }'
```

### 4. Update Labeler DID document to include AtprotoLabeler service
 
Use PLC operation to add service to existing DID. Can do this with the [@skyware labeler](https://skyware.js.org/guides/labeler/introduction/getting-started/) or [https://github.com/johnwarden/atproto-labeler-starter-kit](https://github.com/johnwarden/atproto-labeler-starter-kit)

Example DID document:

{
  "@context": [
    "https://www.w3.org/ns/did/v1",
    "https://w3id.org/security/multikey/v1",
    "https://w3id.org/security/suites/secp256k1-2019/v1"
  ],
  "id": "did:plc:57fl6zy4wmpuknwpgtjqkvlz",
  "alsoKnownAs": [
    "at://testlabeler3.bsky.social"
  ],
  "verificationMethod": [
    {
      "id": "did:plc:57fl6zy4wmpuknwpgtjqkvlz#atproto",
      "type": "Multikey",
      "controller": "did:plc:57fl6zy4wmpuknwpgtjqkvlz",
      "publicKeyMultibase": "zQ3shhA3msuXRaJUa5bb8ck5Hcfwm48cpjMPdAKJ9WjpyjG9z"
    },
    {
      "id": "did:plc:57fl6zy4wmpuknwpgtjqkvlz#atproto_label",
      "type": "Multikey",
      "controller": "did:plc:57fl6zy4wmpuknwpgtjqkvlz",
      "publicKeyMultibase": "zQ3shuC5NPVMRJ57SF7K4UJZ562WtoSunWgxPMyWHRNjcdqrP"
    }
  ],
  "service": [
    {
      "id": "#atproto_pds",
      "type": "AtprotoPersonalDataServer",
      "serviceEndpoint": "https://chalciporus.us-west.host.bsky.network"
    },
    {
      "id": "#atproto_labeler",
      "type": "AtprotoLabeler",
      "serviceEndpoint": "https://testlabeler3.c10t.es"
    }
  ]
}
### 4. Create Feed Generator Records

```bash
# Create feed generator records in repository account
curl -X POST https://your-pds.com/xrpc/com.atproto.repo.createRecord \
  -H "Authorization: Bearer $REPO_ACCESS_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "repo": "$REPO_DID",
    "collection": "app.bsky.feed.generator",
    "rkey": "new",
    "record": {
      "did": "$FEEDGEN_DOCUMENT_DID",
      "displayName": "Community Notes: New",
      "description": "Posts with the newest community notes",
      "createdAt": "'$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)'"
    }
  }'
```

## Code Architecture

### Repository Account Usage

```typescript
// All repository operations (feed records, proposals, votes)
const repoAgent = await createAuthenticatedPdsAgent(ctx, ctx.repoAccount)
```

### AID Generation

Anonymous IDs use the **Repository Account** signing key for privacy:

```typescript
// Generate Anonymous ID for proposal creator
const creatorAid = generateAid(
  userDid,
  ctx.repoAccount.key // Repository account signing key (for rainbow table resistance)
)
```

## API Integration

### getConfig Endpoint

Returns only DIDs needed by frontend:

```typescript
// GET /xrpc/org.opencommunitynotes.getConfig
{
  "version": "2025-01-01T00:00:00.000Z",
  "feedGeneratorDid": "did:plc:repo-did",      // Repository DID for constructing feed URIs
  "labelerDid": "did:plc:labeler-actor-did"    // Labeler actor DID for headers
}
```

### Frontend Usage

```javascript
// Get configuration
const config = await fetch('/xrpc/org.opencommunitynotes.getConfig')

// Construct feed URIs using repository DID
const feedUri = `at://${config.feedGeneratorDid}/app.bsky.feed.generator/new`

// Call Bsky with labeler header
const feed = await fetch(`/xrpc/app.bsky.feed.getFeed?feed=${feedUri}`, {
  headers: {
    'atproto-accept-labelers': config.labelerDid
  }
})
```

### Introspection Service

Dev-env introspection exposes all DIDs for debugging:

```json
{
  "notes": {
    "url": "http://localhost:2595",
    "feedgenDocumentDid": "did:plc:feedgen-document-did",
    "repoDid": "did:plc:repo-did",
    "labelerDid": "did:plc:labeler-actor-did"
  }
}
```

## Standard AT Protocol Endpoints

### describeFeedGenerator

```bash
curl https://your-domain.com/xrpc/app.bsky.feed.describeFeedGenerator
```

Returns:
```json
{
  "did": "did:plc:feedgen-document-did",
  "feeds": [
    {"uri": "at://did:plc:repo-did/app.bsky.feed.generator/new"},
    {"uri": "at://did:plc:repo-did/app.bsky.feed.generator/needs_your_help"},
    {"uri": "at://did:plc:repo-did/app.bsky.feed.generator/rated_helpful"}
  ]
}
```

Note: The `did` field returns the **document DID** (service host), while feed URIs use the **repository DID** (record storage).

### getFeedSkeleton

```bash
curl "https://your-domain.com/xrpc/app.bsky.feed.getFeedSkeleton?feed=at://did:plc:repo-did/app.bsky.feed.generator/new"
```

## Security Considerations

### Signing Key Usage

1. **Feed Generator Document Signing Key**:
   - Used for DID document operations only
   - NOT used for repository operations
   - NOT used for AID generation

2. **Repository Account Signing Key**:
   - Used for repository authentication to PDS
   - Used for all record operations (feed, proposal, vote records)
   - **Used for AID generation** (privacy-critical)

3. **Labeler Signing Key**:
   - Used for signing Community Notes labels
   - Separate from repository operations
   - Required for labeler functionality

### AID Privacy

Anonymous IDs are generated using the Repository Account signing key to ensure:
- **Rainbow table resistance**: Repository key acts as secret salt
- **Service binding**: Different services produce different AIDs
- **Stability**: Same inputs always produce same AID
- **Privacy**: User identity protected through anonymization

### Key Management Notes

- **Repository signing key is required**: Used for both authentication and AID generation
- **Labeler signing key is required**: Used for label signing
- **Document signing key is optional**: Only needed for DID document updates

## Architecture Benefits

### Clear Separation of Concerns
- **Document DID**: Service discovery only (no authentication needed)
- **Repository Account**: Record storage and authentication (single account simplicity)
- **Labeler Actor**: Label generation and validation (must be actor for `getActors()`)

### Simplified Architecture
- **Single Repository**: One account handles all record operations
- **Actor Requirements**: Only labeler needs to be actor, document DIDs can be lightweight
- **Reduced Complexity**: Fewer accounts to manage and authenticate

### AT Protocol Compliance
- Follows standard feed generator patterns used throughout the ecosystem
- Compatible with existing Bsky App View feed discovery mechanisms
- Respects actor vs document DID distinctions for proper validation

### Development vs Production Flexibility
- **Development**: Same patterns work in dev-env with proper actor creation
- **Production**: Can scale to separate accounts if needed
- **Migration Path**: Easy to split repository account later if requirements change

This architecture balances simplicity with AT Protocol compliance, ensuring labeler functionality works correctly while minimizing operational complexity.
