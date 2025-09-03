# Community Notes Service

Community Notes service that provides the Community Notes API and integrated scoring functionality.

## Overview

This service provides:

- **Community Notes API**: XRPC endpoints for creating proposals, rating proposals, and retrieving community notes
- **Integrated Scoring**: Built-in scoring functionality with external labeler integration
- **Single Service Architecture**: Consolidated notes and scoring in one service for simplified deployment

## Architecture

The service uses a single-database architecture:

- **notes.db**: Contains proposals, votes, and scoring data (consolidated)

The service integrates with an external labeler service via HTTP API for label publishing.

## 🚀 Database Initialization

**The Notes service manages a single consolidated database.**

On startup, the Notes service:
1. Creates and migrates `notes.db` (contains all data: proposals, votes, scores, events)
2. Connects to external labeler service for label publishing
3. Provides internal `/score` endpoint for algorithm integration

## Development Setup

### Prerequisites

From the project root, you can use devbox for easy setup:

```bash
# Install devbox if you haven't already
curl -fsSL https://get.jetpack.io/devbox | bash

# Enter the development environment
devbox shell

# Or manually install: Node.js 20+, pnpm, just, sqlite3
```

### Quick Start

```bash
# Start the development environment (from project root)
just start

# View logs
just recent-logs notes

# Run integration tests
just integration-test-notes

# Access database
just notes-db    # Notes database (proposals, votes, scoring data)
just scores-db   # Alias for notes-db (scoring tables)
```

### Development Environment

The dev environment automatically:

- Creates temporary SQLite database (consolidated)
- Sets up mock data
- Configures service accounts and TestLabeler mock
- Runs all services with hot reload

## Production Deployment

### Prerequisites

1. **Fly.io Account**: Sign up at https://fly.io
2. **Service Account**: Create an AT Protocol service account
3. **Labeler Account**: Create an AT Protocol labeler account

### Service Account Setup

**Recommended Approach**: Use a single account on Bluesky's infrastructure for both service identity and feed generator records.

#### Option 1: Use Bluesky PBC Infrastructure (Recommended)

1. **Create Account on bsky.social**:
   ```bash
   # Create account via web interface at https://bsky.app
   # Or use AT Protocol tools:
   curl -X POST https://bsky.social/xrpc/com.atproto.server.createAccount \
     -H "Content-Type: application/json" \
     -d '{
       "handle": "notes-service.bsky.social",
       "email": "your-email@domain.com",
       "password": "secure-password",
       "inviteCode": "your-invite-code"
     }'
   ```

2. **Get Authentication Tokens**:
   ```bash
   # Authenticate and get session tokens
   curl -X POST https://bsky.social/xrpc/com.atproto.server.createSession \
     -H "Content-Type: application/json" \
     -d '{
       "identifier": "notes-service.bsky.social",
       "password": "secure-password"
     }' | jq .

   # Save the response values:
   # - "did" → REPO_DID
   # - "accessJwt" → COMMUNITY_NOTES_SERVICE_ACCOUNT_ACCESS_JWT
   # - "refreshJwt" → COMMUNITY_NOTES_SERVICE_ACCOUNT_REFRESH_JWT
   ```

3. **Add Feed Generator Service to DID Document**:
   ```bash
   # Update DID document to include BskyFeedGenerator service
   # This requires a PLC operation - contact Bluesky support or use PLC tools

   # The DID document should include:
   # {
   #   "service": [
   #     {
   #       "id": "#bsky_fg",
   #       "type": "BskyFeedGenerator",
   #       "serviceEndpoint": "https://your-notes-service.fly.dev"
   #     }
   #   ]
   # }
   ```

#### Option 2: Self-Hosted PDS (Advanced)

1. **Create Account on Your PDS**:
   ```bash
   curl -X POST https://your-pds.com/xrpc/com.atproto.server.createAccount \
     -H "Content-Type: application/json" \
     -d '{
       "handle": "notes-service.your-domain.com",
       "email": "notes-service@your-domain.com",
       "password": "secure-password"
     }'
   ```

2. **Get Authentication Tokens** (same as Option 1, but use your PDS URL)

3. **Configure DID Document** (requires PLC operations or DID management tools)

#### Display Name Limitations

**IMPORTANT**: Feed generator display names are limited to **24 characters maximum**.

Valid examples:
- ✅ "CN: New" (7 chars)
- ✅ "CN: Needs Your Help" (19 chars)
- ✅ "CN: Rated Helpful" (18 chars)
- ❌ "Community Notes: New Posts" (27 chars - too long)

#### Service Account Private Key

For the `COMMUNITY_NOTES_SERVICE_ACCOUNT_PRIVATE_KEY`, you'll need the account's signing key:

```bash
# If using AT Protocol CLI tools:
atproto account export-key --did your-service-did

# Or extract from session/account creation response
# The private key is typically in hex format
```

### Labeler Account Setup

**Recommended**: Use the skyware.js labeler library for simplified labeler setup.

#### Option 1: Using Skyware.js (Recommended)

1. **Install Skyware CLI**:
   ```bash
   npm install -g @skyware/labeler
   ```

2. **Create Labeler Account**:
   ```bash
   # Create account on bsky.social or your preferred PDS
   curl -X POST https://bsky.social/xrpc/com.atproto.server.createAccount \
     -H "Content-Type: application/json" \
     -d '{
       "handle": "notes-labeler.bsky.social",
       "email": "labeler@your-domain.com",
       "password": "secure-labeler-password"
     }'
   ```

3. **Generate Labeler Signing Key**:
   ```bash
   # Use skyware to generate a signing key
   skyware labeler generate-key

   # Or generate manually:
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

   # Save this as LABELER_SIGNING_KEY
   ```

4. **Configure Labeler DID Document**:
   ```bash
   # The labeler DID document must include AtprotoLabeler service:
   # {
   #   "service": [
   #     {
   #       "id": "#atproto_labeler",
   #       "type": "AtprotoLabeler",
   #       "serviceEndpoint": "https://your-scoring-service.fly.dev"
   #     }
   #   ]
   # }
   ```

5. **Test Labeler Setup**:
   ```bash
   # Verify labeler is working
   skyware labeler test --did your-labeler-did --key your-signing-key
   ```

#### Option 2: Manual Setup (Advanced)

1. **Create Account** (same as Option 1)
2. **Generate Signing Key** using AT Protocol tools
3. **Configure DID Document** manually via PLC operations
4. **Test Label Creation** using AT Protocol labeler tools

### Registration Requirements

**CRITICAL**: Before deploying, you must register the service accounts with the AT Protocol network.

#### 1. Register Labeler DID as Labeler

The labeler DID must include an `AtprotoLabeler` service in its DID document:

```bash
# Example DID document update (requires PLC operation):
curl -X POST https://plc.directory/your-labeler-did \
  -H "Content-Type: application/json" \
  -d '{
    "service": [
      {
        "id": "#atproto_labeler",
        "type": "AtprotoLabeler",
        "serviceEndpoint": "https://your-scoring-service.fly.dev"
      }
    ]
  }'
```

**Required for**: Label queries, WebSocket subscriptions, labeler discovery

#### 2. Register Service Account as Feed Generator

The service account DID must include a `BskyFeedGenerator` service in its DID document:

```bash
# Example DID document update (requires PLC operation):
curl -X POST https://plc.directory/your-service-did \
  -H "Content-Type: application/json" \
  -d '{
    "service": [
      {
        "id": "#bsky_fg",
        "type": "BskyFeedGenerator",
        "serviceEndpoint": "https://your-notes-service.fly.dev"
      }
    ]
  }'
```

**Required for**: Bsky feed discovery, feed skeleton requests

#### 3. Feed Generator Records (Automatic)

The Notes service automatically creates feed generator records on startup:

```bash
# These records are created automatically (no manual action needed):
# at://{service-did}/app.bsky.feed.generator/new
# at://{service-did}/app.bsky.feed.generator/needs_your_help
# at://{service-did}/app.bsky.feed.generator/rated_helpful
```

**Display Name Requirements**:
- Maximum 24 characters
- Service uses: "CN: New", "CN: Needs Your Help", "CN: Rated Helpful"
- Creation is idempotent (safe to restart service)

#### 4. Manual Feed Generator Record Creation (Optional)

If you need to create feed generator records manually:

```bash
# Create "New" feed generator record
curl -X POST https://your-pds.com/xrpc/com.atproto.repo.createRecord \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $ACCESS_JWT" \
  -d '{
    "repo": "your-service-did",
    "collection": "app.bsky.feed.generator",
    "rkey": "new",
    "record": {
      "did": "your-service-did",
      "displayName": "CN: New",
      "description": "New Community Notes proposals",
      "createdAt": "'$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)'"
    }
  }'

# Repeat for "needs_your_help" and "rated_helpful" with appropriate rkey and displayName
```

#### Registration Checklist

Before production deployment:

- [ ] **Labeler DID** has `AtprotoLabeler` service in DID document
- [ ] **Service Account DID** has `BskyFeedGenerator` service in DID document
- [ ] **Service endpoints** point to production URLs (not localhost)
- [ ] **Display names** are ≤24 characters
- [ ] **Environment variables** include correct DIDs and endpoints
- [ ] **Test feed generator records** creation during dev-env startup

**Note**: DID document service registration must be done during initial account setup. The Notes service handles feed generator record creation automatically.

### Deployment Steps

1. **Setup Development Environment**:
   ```bash
   # Fly CLI is included in devbox
   devbox shell
   fly auth login
   ```

2. **Set Environment Variables**:
   ```bash
   # Copy and customize the environment file
   cp env.example .env

   # Edit .env with your production values:
   # - REPO_DID
   # - LABELER_DID
   # - PRIMARY_REGION
   ```

3. **Complete Deployment**:
   ```bash
   # This will:
   # - Create the Fly app
   # - Set up secrets interactively
   # - Create LiteFS volume
   # - Deploy the service
   just fly-setup
   ```

### Manual Deployment Steps

If you prefer manual setup:

```bash
# 1. Create Fly app
fly apps create notes

# 2. Set up secrets (interactive - never saved to files)
just setup-secrets

# 3. Create LiteFS volume
just setup-litefs-volume

# 4. Deploy
just deploy
```

### Environment Variables

**Public Variables** (set in fly.toml):

- `NODE_ENV=production`
- `PORT=8081`
- `LOG_LEVEL=info`
- `PDS_URL=https://bsky.network`
- `DB_PATH=/litefs/notes.db`
- `PRIMARY_REGION=sjc`
- `REPO_DID=did:plc:your-service-did`
- `LABELER_DID=did:plc:your-labeler-did`
**Secrets** (set via `just setup-secrets`):

TODO

## Management Commands

### Health & Status
```bash
just status          # Complete health check
just health          # Service health endpoint
just fly-status      # Fly.io app status
just logs            # Recent application logs
```

### Environment
```bash
just env             # Show environment variables (non-sensitive)
```

### Database Management
```bash
just db-status           # Database status overview
just db-connect-notes    # Connect to notes database
just db-connect-scores   # Connect to scores database
just db-proposals        # Show recent proposals
just db-status-events    # Show recent status events
just db-labels           # Show recent labels
```

### LiteFS Management
```bash
just litefs-status       # Check LiteFS replication status
```

### Deployment
```bash
just deploy              # Deploy to Fly.io
just restart             # Restart the service
just fly-dashboard       # Open Fly.io dashboard
```

## Database Schema

### notes.db (Notes Service - Read/Write)
- `record`: Proposals and votes
- `kysely_migration`: Migration tracking

### scores.db (Scoring Service Output - Read Only)
- `statusEvent`: Algorithm outputs
- `status`: Current proposal statuses
- `labels`: Generated labels
- `constants`: Configuration values

## Monitoring

### Health Checks
- Service: `https://notes.fly.dev/health`
- Database connectivity is checked automatically

### Logs
```bash
just logs                # Recent logs
fly logs --app notes     # Live logs
```

### Metrics
- LiteFS replication status
- Database query performance
- API response times

## Troubleshooting

### Common Issues

**Service won't start**:
- Check secrets are set: `fly secrets list`
- Verify environment variables: `just env`
- Check logs: `just logs`

**Database issues**:
- Check LiteFS status: `just litefs-status`
- Verify volume: `fly volumes list`
- Check database connectivity: `just db-status`

**Labeler issues**:
- Verify labeler DID configuration
- Check signing key is set
- Review label creation logs

### Support
- Check logs with `just logs`
- Review database status with `just db-status`
- Verify configuration with `just env`

## Security

- Secrets are never stored in files
- Database access is read-only where appropriate
- LiteFS provides encrypted replication
- Service runs with minimal privileges

## Performance

- SQLite with WAL mode for concurrency
- LiteFS for distributed database access
- Optimized queries with proper indexing
- Connection pooling and caching
