# Community Notes Service - Production Deployment Plan

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
- **Single SQLite Database**: No LiteFS - simplified single database approach
- **Event-Sourced Labels**: Uses scoreEvent table for audit trail and label generation
- **Database Triggers**: Automatic label creation via database triggers

## Configuration Management

**No .env files with secrets**: All secrets stored in Fly.io secrets only.

**Single .env file**: Contains only non-secret environment variables for production deployment.

**Justfile reads .env**: Uses `set dotenv-load := true` to read non-secret variables.

### Environment Variables

Based on the new PDS-style configuration system and multi-DID architecture:

#### Production (.env) - Non-Secret Variables Only
```bash
# Service Configuration
NODE_ENV=production
PORT=8081                    # Main API port (also in fly.toml)
INTERNAL_API_PORT=8082      # Internal service API port (also in fly.toml)

# Internal Service Communication
# If not set, app will use FLY_PRIVATE_IPV6 for internal host
INTERNAL_API_HOST=

# External Services
PDS_URL=https://bsky.network

# Database
DB_PATH=/data/notes.db

# DIDs (public, not secrets)
REPO_DID=did:plc:actual-production-repo-did
FEEDGEN_DOCUMENT_DID=did:plc:actual-production-feedgen-did
LABELER_DID=did:plc:actual-production-labeler-did

# Labeler Service
LABELER_URL=https://labeler.example.com
```

#### Development Environment

Development configuration is handled entirely by `dev-env` package - no .env file needed.

#### Fly.io Secrets (Only)
```bash
# Repository Account Credentials
REPO_PRIVATE_KEY=...
REPO_PASSWORD=...
```

#### Required Environment Variables
Per `config.ts`, these variables are required:
- `PORT` - Main service port (set in fly.toml [env])
- `INTERNAL_API_PORT` - Internal API port (set in fly.toml [env])
- `INTERNAL_API_HOST` - Internal service host (optional, defaults to FLY_PRIVATE_IPV6)
- `DB_PATH` - SQLite database path
- `PDS_URL` - AT Protocol PDS URL
- `REPO_DID` - Repository account DID
- `REPO_PASSWORD` - Repository account password
- `FEEDGEN_DOCUMENT_DID` - Feed generator document DID
- `LABELER_DID` - Labeler service DID
- `LABELER_URL` - Labeler service URL

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
- `LABELER_URL` - Labeler service URL

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
- [ ] Remove LiteFS references from all files
- [ ] Update `fly.toml` configuration
- [ ] Update `Dockerfile` to remove LiteFS

### Phase 7: Production Hardening (Future)
- [ ] Document manual DID creation process
- [ ] Document manual labeler registration process
- [ ] Add monitoring and alerting
- [ ] Add backup verification scripts

## Database Configuration

### Single SQLite Database
The Notes Service uses a single SQLite database without LiteFS:

- **Database Path**: `/data/notes.db` (persistent volume)
- **Access Pattern**: Direct SQLite access (no replication)
- **Concurrency**: WAL mode for better read/write performance
- **Migrations**: Automatic migration on startup

### Database Schema
Key tables for the event-sourced label system:
- `scoreEvent` - Immutable audit trail of scoring decisions
- `score` - Current state derived from events  
- `pendingLabels` - Labels awaiting sync to labeler service
- `record` - Proposals and ratings from AT Protocol

### Internal Service Communication
- **INTERNAL_API_HOST**: Optional environment variable for internal service communication
- **Default Behavior**: If not set, app automatically uses `process.env.FLY_PRIVATE_IPV6`
- **Fly.io Integration**: FLY_PRIVATE_IPV6 provides secure internal networking between services
- **Scoring Service**: Will use this to call Notes Service `/score` endpoint on port 8082

### Fly.io Configuration Details

#### Notes Service (fly.toml)
```toml
app = 'notes'
primary_region = 'sjc'

[build]

[env]
  PORT = '8081'
  INTERNAL_API_PORT = '8082'
  PRIMARY_REGION = 'sjc'

[[services]]
  protocol = "tcp"
  internal_port = 8081
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

# Persistent volume for database
[[mounts]]
  source = "notes_data"
  destination = "/data"
```

#### Scoring Service (Future)
The scoring service will be deployed separately and will:
- Read from the Notes Service database (read-only access)
- Call the Notes Service `/score` endpoint to submit results
- Run on a scheduled basis (e.g., every 6 hours)

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

### Justfile Commands (Revised)

**Key Changes**:
- No `--app` flags needed (app name in fly.toml)
- Reads non-secret variables from .env
- All secrets set via `fly secrets set`
- Added LiteFS volume setup

#### Setup Commands
- `just fly-setup`: Complete setup (app creation, secrets, volume, deploy)
- `just setup-volume`: Create persistent storage volume
- `just setup-secrets`: Set all secrets from environment variables

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
- **Notes Service**: HTTP API on port 8081
- **Internal API**: Internal `/score` endpoint on port 8082
- **Database**: `/data/notes.db` (persistent volume)

### 2. Deploy Scoring Service (Future)

The scoring service will be deployed separately and will:
- Connect to Notes Service database for read-only access
- Call Notes Service `/score` endpoint to submit results
- Run on scheduled intervals

### 3. Environment Variables

Set these secrets in Fly.io:

```bash
# Repository account credentials
fly secrets set REPO_PRIVATE_KEY="your-repo-private-key"
fly secrets set REPO_PASSWORD="your-repo-password"
```

### 4. Volume Setup

Create persistent volume for database:

```bash
# Create volume for Notes service
cd services/notes
fly volumes create notes_data --region sjc --size 10
```

## Database Access Pattern

### Notes Service
- **Reads**: Direct SQLite access to `/data/notes.db`
- **Writes**: All user operations (proposals, ratings) and label sync
- **Ports**: 8081 (main API), 8082 (internal `/score` endpoint)
- **Concurrency**: WAL mode for better read/write performance

### Scoring Service (Future)
- **Reads**: Read-only access to Notes Service database
- **API Calls**: Calls Notes Service `/score` endpoint to submit results
- **Schedule**: Periodic execution (e.g., every 6 hours)
- **Independence**: Separate deployment, connects via HTTP API

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
curl https://notes.fly.dev/health

# Check Algorithm service
curl https://notes-algorithm.fly.dev/health
```

#### Database Status

```bash
# SSH into container
fly ssh console

# Check database file
ls -la /data/

# Check database health
sqlite3 /data/notes.db "SELECT COUNT(*) FROM sqlite_master;"
```

#### Database Verification

```bash
# Connect to database
sqlite3 /data/notes.db

# Check recent score events
SELECT * FROM scoreEvent ORDER BY createdAt DESC LIMIT 10;

# Check pending labels
SELECT * FROM pendingLabels ORDER BY createdAt DESC LIMIT 10;

# Check recent proposals
SELECT * FROM record WHERE collection = 'social.pmsky.proposal' ORDER BY indexedAt DESC LIMIT 10;
```

## Manual Setup Procedures

### 1. Service DID Creation
```bash
# Create service DID manually using AT Protocol tools
# Store DID and private key in secure location
# Add to Fly secrets as SERVICE_ACCOUNT_DID and SERVICE_ACCOUNT_PRIVATE_KEY
```

### 2. Labeler Registration
```bash
# Register service as labeler in AT Protocol
# Configure labeler service record
# Set up labeler endpoints
# Store labeler DID and signing key in Fly secrets
```

### 3. Service Account Setup
```bash
# Create service account in PDS
# Generate access/refresh tokens
# Store tokens in Fly secrets as SERVICE_ACCOUNT_ACCESS_JWT, etc.
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
- **Notes Service**: Single instance with persistent volume
- **Scoring Service**: Single instance, calls Notes Service API
- **Database**: Single SQLite file with WAL mode for concurrency

### Performance
- **Read Performance**: Excellent (local SQLite access)
- **Write Performance**: Good (WAL mode, single writer)
- **API Performance**: Internal `/score` endpoint for scoring service

### Data Persistence
- **Persistent Volume**: Fly.io volume mounted at `/data`
- **Database Backups**: Regular SQLite backups (future enhancement)
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
