# Community Notes Service - Production Deployment Plan

**Feed Generator DID**: In production, set `FEEDGEN_DOCUMENT_DID=did:web:$DOMAIN` where `$DOMAIN` is your service domain. The service serves the DID document at `/.well-known/did.json`.

## Overview

This document outlines the comprehensive plan for deploying the Community Notes service to production. This service is part of the atproto-community-notes project (https://github.com/johnwarden/atproto-community-notes).

## Architecture Overview

The Community Notes system consists of three main services:

- **Notes Service**: User-facing API for creating, rating, and reading proposals. Provides internal `/score` endpoint for scoring service
- **Labeler Service**: AT Protocol labeler that creates and serves Community Notes labels  
- **Scoring Service**: Runs algorithms to score proposals and calls Notes Service `/score` API to create labels

## Architecture Decisions

### DID and Service Management
- **Multi-DID Architecture**: Separate DIDs for repository account, feed generator document, and labeler
- **Manual Setup**: Production DIDs created manually (not auto-generated)
- **Manual Registration**: Labeler and feed generator registration handled manually

### Configuration System
- **PDS-Style Pattern**: Uses `readEnv()` and `envToCfg()` pattern from AT Protocol services
- **Environment Helpers**: Uses `@atproto/common` `envStr`, `envInt` helpers
- **Validation**: Required variables validated in production, skipped in dev-env
- **Override Support**: Dev-env can pass config overrides without modifying process.env
- **Secret Management**: All secrets stored in Fly.io secrets, no .env files with secrets

### Database Architecture
- **Single SQLite Database**: Shared via LiteFS for algorithm service access
- **Event-Sourced Labels**: Uses scoreEvent table for audit trail and label generation
- **Database Triggers**: Automatic label creation via database triggers
- **LiteFS Replication**: Enables algorithm service to directly read ratings data

## Configuration Management

**Single .env file**: Contains only non-secret environment variables for production deployment.

**Justfile reads .env**: Uses `set dotenv-load := true` to read non-secret variables.

### Environment Variables

Based on the new PDS-style configuration system and multi-DID architecture:

#### Production (.env) - Non-Secret Variables Only
```bash
# Service Configuration
NODE_ENV=production
PORT=8080                    # Main API port (also in fly.toml)
INTERNAL_API_PORT=8081      # Internal service API port (also in fly.toml)

# External Services
PDS_URL=https://bsky.network

# Database (shared via LiteFS)
DB_PATH=/litefs/notes.db

# LiteFS Configuration
PRIMARY_REGION=sjc

# DIDs (public, not secrets)
REPO_DID=did:plc:actual-production-repo-did
FEEDGEN_DOCUMENT_DID=did:web:your-domain.com
LABELER_DID=did:plc:actual-production-labeler-did

# Labeler Service
LABELER_URL=http://labeler.internal:8081
```

#### Development Environment

Development configuration is handled entirely by `dev-env` package - no .env file needed.

#### Secrets

Export secrets from password manager to fly.io

  just setup-secrets


#### Required Environment Variables
Per `config.ts`, these variables are required:
- `PORT` - Main service port (set in fly.toml [env])
- `INTERNAL_API_PORT` - Internal API port (set in fly.toml [env])
- `DB_PATH` - SQLite database path
- `PDS_URL` - AT Protocol PDS URL
- `REPO_DID` - Repository account DID
- `REPO_PASSWORD` - Repository account password
- `FEEDGEN_DOCUMENT_DID` - Feed generator document DID
- `LABELER_DID` - Labeler service DID
- `LABELER_URL` - Labeler service URL (use HTTP for internal Fly.io services, e.g., `http://testlabeler3.internal`)

### Configuration Validation

The new config system validates required variables in production:

**Required Variables** (validated unless `skipValidation=true`):
- `PORT` - Main service port
- `INTERNAL_PORT` - Internal API port
- `DB_PATH` - Database file path
- `PDS_URL` - AT Protocol PDS URL
- `REPO_DID` - Repository account DID
- `REPO_PASSWORD` - Repository account password
- `FEEDGEN_DOCUMENT_DID` - Feed generator document DID
- `LABELER_DID` - Labeler service DID
- `LABELER_URL` - Labeler service URL (use HTTP for internal Fly.io services, e.g., `http://testlabeler3.internal`)

## File Structure

```
services/notes/
├── DEPLOYMENT_PLAN.md          # This document
├── package.json                # Service dependencies
├── index.js                    # Main service entry point
├── Dockerfile                  # Container configuration
├── fly.toml                    # Notes service Fly.io configuration
├── justfile                    # Deployment commands
├── env.example                 # Environment template
└── README.md                   # Service documentation

services/scoring/               # Future: Scoring service
├── package.json                # Scoring service dependencies
├── index.js                    # Scoring service entry point
├── algorithm.js                # Algorithm implementation
├── Dockerfile                  # Container configuration
├── fly.toml                    # Scoring service Fly.io configuration
├── justfile                    # Scoring deployment commands
├── env.example                 # Environment template
└── README.md                   # Scoring service documentation
```

## Implementation Phases

### Phase 1: Basic Service Structure ✅ COMPLETED
- [x] Create `services/notes/` directory
- [x] Create `package.json` with `@atproto/notes` dependency
- [x] Create `index.js` entry point that imports and starts NotesService
- [x] Create Dockerfile with all required dependencies
- [x] Create basic README.md

### Phase 2: Fly.io Configuration ✅ COMPLETED
- [x] Create `fly.toml` with app name and configuration
- [x] Configure single port for both services
- [x] Set up persistent volume for SQLite database
- [x] Create environment templates (non-secret only)

### Phase 3: Deployment Automation ✅ COMPLETED
- [x] Create `justfile` with deployment commands
- [x] Remove `--app` flags (app name in fly.toml)
- [x] Add secret management commands
- [x] Add health check and testing commands

### Phase 4: Multi-DID Architecture ✅ COMPLETED
- [x] Implement repository account for all records
- [x] Separate feed generator document DID
- [x] Separate labeler actor DID
- [x] Update configuration system for multi-DID

### Phase 5: Trigger-Based Labeling ✅ DESIGNED
- [x] Design trigger-based label creation system
- [x] Document negative label handling requirements
- [x] Create database migration for label triggers
- [x] Event-sourced scoreEvent table

### Phase 6: Configuration Cleanup 🔄 IN PROGRESS
- [ ] Update `env.example` to match config.ts
- [ ] Update `justfile` environment variables
- [ ] Update `fly.toml` configuration

### Phase 7: Production Hardening (Future)
- [ ] Document manual DID creation process
- [ ] Document manual labeler registration process
- [ ] Add monitoring and alerting
- [ ] Add backup verification scripts

## Database Configuration

### LiteFS Shared Database

The Notes Service uses LiteFS for shared database access:

- **Access Pattern**: LiteFS replication for multi-service access
- **Concurrency**: WAL mode with LiteFS coordination
- **Migrations**: Automatic migration on startup
- **Algorithm Access**: Scoring service reads directly from replicated database

### Database Schema
Key tables for the event-sourced label system:
- `scoreEvent` - Immutable audit trail of scoring decisions
- `score` - Current state derived from events  
- `pendingLabels` - Labels awaiting sync to labeler service
- `record` - Proposals and ratings from AT Protocol

### Internal Service Communication
- **Internal Service Communication**: Uses IPv6 binding ('::') for internal API
- **Fly.io Integration**: Services communicate via internal networking on port 8081
- **Scoring Service**: Will use this to call Notes Service `/score` endpoint on port 8081
- **Labeler Service**: Notes service calls labeler `/label` endpoint via internal HTTP URLs (e.g., `http://testlabeler3.internal`)
- **Protocol Note**: Internal Fly.io services use HTTP (not HTTPS) for inter-service communication

### Fly.io Configuration Details

#### Notes Service (fly.toml)
```toml
app = 'notes'
primary_region = 'sjc'

[build]

[env]
  PORT = '8080'
  INTERNAL_API_PORT = '8081'
  PRIMARY_REGION = 'sjc'

[[services]]
  protocol = "tcp"
  internal_port = 8080
  processes = ["app"]

  [[services.ports]]
    port = 80
    handlers = ["http"]
    force_https = true

  [[services.ports]]
    port = 443
    handlers = ["tls", "http"]

  [services.concurrency]
    type = "connections"
    hard_limit = 25
    soft_limit = 20

  [[services.tcp_checks]]
    interval = "15s"
    timeout = "2s"
    grace_period = "1s"
    method = "GET"
    path = "/health"

[processes]
  app = "node index.js"

[[vm]]
  memory = '1gb'
  cpu_kind = 'shared'
  cpus = 1

[deploy]
  strategy = "immediate"

# LiteFS configuration
[experimental]
  enable_consul = true

[[mounts]]
  source = "litefs"
  destination = "/litefs"
```

#### Scoring Service (Future)
The scoring service will be deployed separately and will:
- Read from the Notes Service database via LiteFS replication (direct access)
- Call the Notes Service `/score` endpoint to submit results
- Run on a scheduled basis (e.g., every 6 hours)
- Access same LiteFS volume for shared database access

### Dockerfile Configuration
```dockerfile
FROM node:20.11-alpine

RUN apk add --update dumb-init curl ca-certificates

# Avoid zombie processes, handle signal forwarding
ENTRYPOINT ["dumb-init", "--"]

WORKDIR /app/services/notes
COPY --from=build /app /app

# Create data directory for database
RUN mkdir -p /data

EXPOSE 8081
ENV PORT=8081
ENV NODE_ENV=production

# Run the Node.js application directly
CMD ["node", "--heapsnapshot-signal=SIGUSR2", "--enable-source-maps", "index.js"]
```

### Justfile Commands

#### Setup Commands
- `just fly-setup`: Complete setup (app creation, secrets, volume, deploy)
- `just setup-litefs-volume`: Create LiteFS storage volume
- `just setup-secrets`: Set all secrets from environment variables
- `just litefs-status`: Check LiteFS replication status

#### Deployment Commands
- `just deploy`: Deploy notes service (no app flag needed)
- `just restart`: Restart application
- `just logs`: Show recent application logs

#### Status Commands
- `just status`: Show app status and health
- `just health`: Check health endpoints
- `just env`: Show non-sensitive environment configuration

#### Development Commands
- `just dev`: Run locally for development (uses dev-env)
- `just test-api-dev`: Test local API endpoints
- `just test-health-dev`: Test local health endpoint

#### Production Testing
- `just test-api`: Test production API endpoints
- `just test-health`: Test production health endpoint

## Deployment Steps

### 1. Deploy Notes Service

```bash
cd services/notes
fly deploy --config fly.toml
```

This deploys:
- **Notes Service**: HTTP API on port 8080 (Node.js app)
- **Internal API**: Internal `/score` endpoint on port 8081
- **Database**: `/litefs/notes.db` (LiteFS FUSE mount)

### 2. Deploy Scoring Service (Future)

The scoring service will be deployed separately and will:
- Connect to same LiteFS volume for direct database access
- Read ratings data directly from `/litefs/notes.db`
- Call Notes Service `/score` endpoint to submit results
- Run on scheduled intervals

### 3. Environment Variables

Set these secrets in Fly.io:

```bash
# Repository account credentials
fly secrets set AID_SALT="your-aid-generation-salt"
fly secrets set REPO_PASSWORD="your-repo-password"
```

### 4. Volume Setup

Create LiteFS volume for shared database:

```bash
# Create volume for Notes service
cd services/notes
fly volumes create litefs --region sjc --size 10

# Create volume for Scoring service (future)
cd services/scoring
fly volumes create litefs --region sjc --size 10
```

## Database Access Pattern

### Notes Service (Primary)
- **Reads**: Direct SQLite access via LiteFS FUSE mount
- **Writes**: All user operations (proposals, ratings) and label sync
- **Ports**: 8080 (main API), 8081 (internal `/score` endpoint)
- **LiteFS Role**: Primary node for database writes

### Scoring Service (Replica)
- **Reads**: Direct SQLite access via LiteFS replication
- **Database Path**: Same `/litefs/notes.db` via LiteFS mount
- **API Calls**: Calls Notes Service `/score` endpoint to submit results
- **Schedule**: Periodic execution (e.g., every 6 hours)
- **LiteFS Role**: Replica node for database reads

## Health Checks and Monitoring

### Health Endpoints
- `GET /health`: Basic health check
- `GET /health/ready`: Readiness check (database connectivity)
- `GET /health/live`: Liveness check (service responsiveness)

### Graceful Shutdown
- Handle SIGTERM signal
- Close database connections
- Stop accepting new requests
- Wait for in-flight requests to complete
- Exit cleanly

### Logging Configuration
- Use structured JSON logging in production
- Set log level via `LOG_LEVEL` environment variable
- Include request IDs for tracing
- Log service startup configuration (without secrets)

### Monitoring and Troubleshooting

#### Health Checks

```bash
# Check Notes service
curl https://atproto-notes-api.fly.dev/health

# Check Algorithm service
curl https://notes-algorithm.fly.dev/health
```

#### LiteFS Status

```bash
# SSH into container
fly ssh console

# Check LiteFS status
litefs status

# View LiteFS logs
tail -f /var/log/litefs.log
```

#### Database Status

```bash
# SSH into container
fly ssh console

# Check database file
ls -la /litefs/

# Check database health
sqlite3 /litefs/notes.db "SELECT COUNT(*) FROM sqlite_master;"
```

#### Database Verification

```bash
# Connect to database
sqlite3 /litefs/notes.db

# Check recent score events
SELECT * FROM scoreEvent ORDER BY createdAt DESC LIMIT 10;

# Check pending labels
SELECT * FROM pendingLabels ORDER BY createdAt DESC LIMIT 10;

# Check recent proposals
SELECT * FROM record WHERE collection = 'social.pmsky.proposal' ORDER BY indexedAt DESC LIMIT 10;
```

## Manual Setup Procedures

### 1. Repository Account Creation
```bash
# Create repository account in PDS for storing all records
curl -X POST https://bsky.social/xrpc/com.atproto.server.createAccount \
  -H "Content-Type: application/json" \
  -d '{
    "handle": "repo.your-domain.com",
    "email": "repo@your-domain.com", 
    "password": "secure-password"
  }'

# Store the returned DID and password in Fly secrets
fly secrets set REPO_DID="did:plc:returned-repo-did"
fly secrets set REPO_PASSWORD="secure-password"
```

### 2. Feed Generator Document DID Setup
```bash
# In production, use did:web format with your domain
# No manual DID creation needed - the service serves /.well-known/did.json
export FEEDGEN_DOCUMENT_DID="did:web:your-domain.com"

# The service automatically serves the DID document at:
# https://your-domain.com/.well-known/did.json
# with the BskyFeedGenerator service endpoint
```

### 3. Feed Generator Records Creation
```bash
# Authenticate with repository account
export REPO_ACCESS_JWT=$(curl -X POST https://bsky.social/xrpc/com.atproto.server.createSession \
  -H "Content-Type: application/json" \
  -d '{
    "identifier": "repo.your-domain.com",
    "password": "secure-password"
  }' | jq -r '.accessJwt')

# Create "New" feed generator record
curl -X POST https://bsky.social/xrpc/com.atproto.repo.createRecord \
  -H "Authorization: Bearer $REPO_ACCESS_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "repo": "'$REPO_DID'",
    "collection": "app.bsky.feed.generator",
    "rkey": "new",
    "record": {
      "did": "'$FEEDGEN_DOCUMENT_DID'",
      "displayName": "Community Notes: New",
      "description": "Posts with the newest community notes",
      "createdAt": "'$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)'"
    }
  }'

# Create "Needs Your Help" feed generator record  
curl -X POST https://bsky.social/xrpc/com.atproto.repo.createRecord \
  -H "Authorization: Bearer $REPO_ACCESS_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "repo": "'$REPO_DID'",
    "collection": "app.bsky.feed.generator",
    "rkey": "needs_your_help",
    "record": {
      "did": "'$FEEDGEN_DOCUMENT_DID'",
      "displayName": "Community Notes: Needs Your Help",
      "description": "Posts that need community notes ratings",
      "createdAt": "'$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)'"
    }
  }'

# Create "Rated Helpful" feed generator record
curl -X POST https://bsky.social/xrpc/com.atproto.repo.createRecord \
  -H "Authorization: Bearer $REPO_ACCESS_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "repo": "'$REPO_DID'",
    "collection": "app.bsky.feed.generator",
    "rkey": "rated_helpful", 
    "record": {
      "did": "'$FEEDGEN_DOCUMENT_DID'",
      "displayName": "Community Notes: Rated Helpful",
      "description": "Posts with community notes rated as helpful",
      "createdAt": "'$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)'"
    }
  }'
```

### 4. Labeler Account Creation
```bash
# Create labeler account (must be actor for getActors() validation)
curl -X POST https://bsky.social/xrpc/com.atproto.server.createAccount \
  -H "Content-Type: application/json" \
  -d '{
    "handle": "labeler.your-domain.com",
    "email": "labeler@your-domain.com",
    "password": "secure-labeler-password"
  }'

# Update labeler DID document to include AtprotoLabeler service
# Use PLC operation to add service to existing DID
# See: https://skyware.js.org/guides/labeler/introduction/getting-started/
```

## Configuration System Details

### PDS-Style Pattern
The new configuration system follows the PDS pattern:

1. **`readEnv()`**: Reads environment variables using `@atproto/common` helpers
2. **`envToCfg()`**: Converts environment to config with validation and defaults
3. **`NotesConfig.readEnv()`**: Creates config instance with optional overrides
4. **Validation**: Required variables validated in production, skipped for dev-env

### Environment Variable Changes
- **Port**: `NOTES_PORT` → `PORT`
- **Database**: `DB_PATH` → `COMMUNITY_NOTES_DB_SQLITE_PATH` (required)
- **PDS URL**: `PDS_URL` (required)
- **Validation**: Required variables throw errors if missing in production

### Dev-Env Integration
- Dev-env passes config overrides to skip validation
- Database path set by dev-env (temporary file)
- Service account and labeler credentials generated by dev-env
- No process.env modification needed

## Scaling Considerations

### Horizontal Scaling
- **Notes Service**: Can scale to multiple replicas (all read-only except primary)
- **Scoring Service**: Single instance, direct database access via LiteFS
- **Database**: Single primary, multiple replicas via LiteFS

### Performance
- **Read Performance**: Excellent (local SQLite access via LiteFS)
- **Write Performance**: Good (single primary writer)
- **Replication Lag**: < 100ms between primary and replicas
- **Algorithm Performance**: Direct database access (no API overhead)

### Data Persistence
- **LiteFS Replication**: Primary/replica pattern for data durability
- **Volume Storage**: Persistent Fly.io volumes for database files
- **Automatic Failover**: Primary promotion if current primary fails
- **Event Sourcing**: Complete audit trail via scoreEvent table

## Security Considerations

### Secret Management
- All sensitive data stored in Fly secrets
- No secrets in code or configuration files
- Environment-specific secret rotation

### Network Security
- HTTPS enforcement via Fly.io
- Internal service communication security
- Database access controls

### Access Controls
- Service account permissions
- API endpoint authentication
- Labeler authorization checks

### Configuration Security
- Required variables validated in production
- Fallback values only used in development
- Sensitive data never logged or exposed

## Dependencies

### Package Dependencies
- `@atproto/notes`: Main service package (workspace dependency)
- `@atproto/common`: Environment variable helpers
- Standard Node.js runtime dependencies

### External Services
- Fly.io platform for hosting
- AT Protocol network for DID resolution
- PDS for user account management
- Bluesky network for content access

### Manual Setup Requirements
- Service DID creation and registration
- Labeler registration in AT Protocol
- Service account creation in PDS
- SSL certificate setup (handled by Fly.io)

## Summary of Key Changes

### ✅ Architecture Decisions Implemented

1. **Multi-DID Architecture**: Repository account, feed generator document DID, and labeler DID
2. **Single Database**: Simplified SQLite approach without LiteFS complexity
3. **Event-Sourced Labels**: scoreEvent table provides complete audit trail
4. **PDS-Style Configuration**: Environment validation and config patterns
5. **Internal API**: `/score` endpoint for scoring service integration
6. **Trigger-Based Labels**: Database triggers handle label creation automatically

### 🔄 Implementation Status

- **Phases 1-3**: ✅ Completed (basic service structure and deployment)
- **Phase 4**: ✅ Completed (multi-DID architecture)
- **Phase 5**: ✅ Completed (trigger-based labeling)
- **Phase 6**: 🔄 In Progress (configuration cleanup)
- **Phase 7**: Future production hardening

### 🎯 Next Steps

1. **Update configuration files** to match new architecture
2. **Remove LiteFS references** from all deployment files
3. **Test deployment** with simplified database approach
4. **Document manual DID setup** for production
5. **Create scoring service** deployment (future)

The service architecture is now simplified and ready for production with a single SQLite database and clear service separation!
