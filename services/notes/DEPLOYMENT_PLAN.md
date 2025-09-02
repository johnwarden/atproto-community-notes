# Community Notes Service - Production Deployment Plan

## Overview

This document outlines the comprehensive plan for deploying the Community Notes service to production using LiteFS for shared SQLite database access. The service provides both Community Notes API (XRPC endpoints) and AT Protocol Labeler functionality with trigger-based label creation.

## Architecture Overview

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Algorithm      │    │   LiteFS         │    │  Notes Service  │
│  Service        │───▶│   Shared Volume  │◀───│                 │
│  (Batch Writer) │    │                  │    │  (Query + Sign) │
└─────────────────┘    └──────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ Cron Job        │    │ SQLite Database │    │ HTTP API        │
│ (Every 6h)      │    │ /litefs/        │    │ Port 8080       │
│                 │    │ community-      │    │                 │
│                 │    │ notes.db        │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## Architecture Decisions

### Service Structure
- **Dual Service**: Notes service (HTTP API) + Algorithm service (batch processing)
- **Shared Database**: Both services access same SQLite database via LiteFS
- **Trigger-Based Labels**: Database triggers create label records, services sign on-demand
- **Primary/Replica**: Notes service (primary), Algorithm service (replica)

### Database Strategy
- **LiteFS**: Distributed SQLite with FUSE mounting for multi-machine access
- **Primary/Replica Pattern**: One primary writer, multiple readers
- **Shared Volume**: Both services mount same LiteFS volume
- **Trigger-Based**: Labels created by database triggers on status changes
- **Lazy Signing**: Labels signed when first requested, not when created

### Key Benefits of LiteFS
1. **Multi-Machine SQLite**: True shared database across services
2. **Low Latency**: Near real-time replication (< 100ms)
3. **Fly.io Native**: Built-in Consul integration for leader election
4. **FUSE Integration**: Transparent to applications (just a file path)
5. **Automatic Failover**: Primary/replica with automatic promotion

### DID and Service Management
- **Manual Setup**: Production service DID created manually (not auto-generated)
- **Manual Registration**: Labeler registration handled manually
- **Predictable**: Avoids runtime DID creation complexity in production

### Configuration System
- **PDS-Style Pattern**: Uses `readEnv()` and `envToCfg()` pattern from AT Protocol services
- **Environment Helpers**: Uses `@atproto/common` `envStr`, `envInt`, `envBool` helpers
- **Validation**: Required variables validated in production, skipped in dev-env
- **Override Support**: Dev-env can pass config overrides without modifying process.env
- **Secret Management**: All secrets stored in Fly.io secrets, no .env files with secrets

## Key Questions & Answers

### Q: How do we set up LiteFS with Fly.io?

**Answer**: LiteFS provides distributed SQLite access across multiple machines:

1. **Install LiteFS**: Add to Dockerfile alongside the Node.js service
2. **Configuration**: Create `litefs.yml` with FUSE mount and Consul settings
3. **Primary Region**: Use `primary_region` in fly.toml for leader election
4. **FUSE Mount**: LiteFS mounts at `/litefs`, applications access database normally

### Q: How do we obtain SERVICE_ACCOUNT_ACCESS_JWT in production?

**Answer**: The `SERVICE_ACCOUNT_ACCESS_JWT` is obtained through manual account creation:

1. **Create User Account**: Manually create a user account in the target PDS
2. **Login**: Use the account credentials to authenticate and get JWT tokens
3. **Store Tokens**: Store `accessJwt` and `refreshJwt` in Fly.io secrets
4. **Automatic Refresh**: The service automatically refreshes tokens using the refresh token

### Q: Why can't we use SERVICE_ACCOUNT_DID for authentication?

**Answer**: We CAN and SHOULD use `SERVICE_ACCOUNT_DID` for authentication! The service authenticates using its own DID.

- **`SERVICE_ACCOUNT_DID`**: The service's DID (used for both labeling AND authentication)
- **`SERVICE_ACCOUNT_USER_DID`**: Not needed - this was a misunderstanding from dev-env patterns

**Correction**: The service should authenticate directly with its own DID, not create a separate user account.

### Q: Why LABELER_SIGNING_KEY vs SERVICE_ACCOUNT_PRIVATE_KEY?

**Answer**: Both are secp256k1 private keys (signing keys), just used for different purposes:

- **`LABELER_SIGNING_KEY`**: Signs AT Protocol labels for content moderation
- **`SERVICE_ACCOUNT_PRIVATE_KEY`**: Signs general service operations (AID generation, authentication, etc.)

The terminology difference is just naming convention - both are cryptographic signing keys.

### Q: How do we handle negative labels correctly?

**Answer**: Database triggers create label records automatically on status transitions:

1. **Status Changes**: Algorithm service writes to `statusEvent` table
2. **Triggers Fire**: Database triggers detect status transitions and create label records
3. **Label History**: All positive and negative labels preserved permanently
4. **Lazy Signing**: Labels signed when first requested via `queryLabels`

This ensures negative labels are created correctly when status changes FROM a labeled state.



## Configuration Management

### Revised Configuration Strategy

**No .env files with secrets**: All secrets stored in Fly.io secrets only.

**Single .env file**: Contains only non-secret environment variables for production deployment.

**Justfile reads .env**: Uses `set dotenv-load := true` to read non-secret variables.

### Updated Environment Variables

Based on the new PDS-style configuration system:

#### Production (.env) - Non-Secret Variables Only
```bash
# Service Configuration
NODE_ENV=production
PORT=8081
LOG_LEVEL=info

# External Services
PDS_URL=https://bsky.network
SYNC_VOTES_TO_PDS=true

# Database
COMMUNITY_NOTES_DB_SQLITE_PATH=/litefs/community-notes.db

# LiteFS Configuration
PRIMARY_REGION=sjc
```

#### Development Environment
Development configuration is handled entirely by `dev-env` package - no .env file needed.

### Fly.io Secrets (Only)
```bash
# Service Account Private Keys (NOT DIDs - DIDs are public)
SERVICE_ACCOUNT_PRIVATE_KEY=actual-production-private-key-hex


```

### Public Configuration (in fly.toml [env])
```bash
# DIDs are public, not secrets
SERVICE_ACCOUNT_DID=did:plc:actual-production-service-did
LABELER_DID=did:plc:actual-production-labeler-did
```

### Configuration Validation

The new config system validates required variables in production:

**Required Variables** (validated unless `skipValidation=true`):
- `COMMUNITY_NOTES_DB_SQLITE_PATH`
- `LABELER_DID`
- `LABELER_SIGNING_KEY`

**Optional Variables** (with corrected defaults):
- `PORT` (default: 2595, production: 8081)
- `NODE_ENV` (default: 'development', production: 'production')
- `PDS_URL` (required, production: 'https://bsky.network')
- `SYNC_VOTES_TO_PDS` (default: false)

## File Structure

```
services/notes/
├── DEPLOYMENT_PLAN.md          # This document
├── TRIGGER_BASED_LABELING_DESIGN.md  # Label creation design
├── package.json                # Service dependencies
├── index.js                    # Main service entry point
├── Dockerfile                  # Container configuration with LiteFS
├── fly.toml                    # Notes service Fly.io configuration
├── litefs.yml                  # LiteFS configuration
├── justfile                    # Deployment commands
├── .env                        # Development environment
├── .env.production             # Production environment template
├── .env.example                # Environment template
└── README.md                   # Service documentation

services/notes-algorithm/
├── package.json                # Algorithm service dependencies
├── index.js                    # Algorithm service entry point
├── algorithm.js                # Stub algorithm implementation
├── Dockerfile                  # Container configuration with LiteFS
├── fly.toml                    # Algorithm service Fly.io configuration
├── litefs.yml                  # LiteFS configuration
├── justfile                    # Algorithm deployment commands
├── env.example                 # Environment template
└── README.md                   # Algorithm service documentation
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

### Phase 4: LiteFS Integration ✅ COMPLETED
- [x] Update Dockerfile to include LiteFS
- [x] Create `litefs.yml` configuration file
- [x] Update `fly.toml` to use LiteFS mount
- [x] Create `fly-algorithm.toml` for algorithm service
- [x] Update database path to `/litefs/community-notes.db`

### Phase 5: Trigger-Based Labeling ✅ DESIGNED
- [x] Design trigger-based label creation system
- [x] Document negative label handling requirements
- [x] Create database migration for label triggers
- [x] Design lazy signing for query services

### Phase 6: Configuration Cleanup 🔄 NEEDS UPDATES
- [ ] Update `.env` files (remove secrets, keep non-secret only)
- [ ] Update `justfile` to read from single `.env` file
- [ ] Remove `env.production` file (replaced by single `.env`)
- [ ] Update `fly.toml` environment variables section

### Phase 7: Production Hardening (Future)
- [ ] Document manual DID creation process
- [ ] Document manual labeler registration process
- [ ] Add monitoring and alerting
- [ ] Add backup verification scripts

## LiteFS Configuration Details

### litefs.yml Structure
```yaml
# LiteFS configuration for Community Notes Service
# This enables shared SQLite database access across multiple machines

# FUSE mount directory for LiteFS
fuse:
  dir: "/litefs"

# Data directory where LiteFS stores its data
data:
  dir: "/var/lib/litefs"

# Proxy configuration - LiteFS will proxy HTTP requests to the application
proxy:
  addr: ":8080"
  target: "localhost:8081"
  db: "community-notes.db"

# Lease configuration using Fly.io's Consul
lease:
  type: "consul"
  candidate: ${FLY_REGION == PRIMARY_REGION}
  promote: true

  consul:
    url: "${FLY_CONSUL_URL}"
    key: "litefs/${FLY_APP_NAME}"

# No backup configuration - using LiteFS replication only

# Logging
log:
  level: "info"
```

### Fly.io Configuration Details

#### Notes Service (fly.toml)
```toml
app = 'notes'
primary_region = 'sjc'

[build]

[env]
  NODE_ENV = 'production'
  PORT = '8081'
  LOG_LEVEL = 'info'
  PDS_URL = 'https://bsky.network'
  SYNC_VOTES_TO_PDS = 'true'
  COMMUNITY_NOTES_DB_SQLITE_PATH = '/litefs/community-notes.db'
  SERVICE_ACCOUNT_DID = 'did:plc:actual-production-service-did'
  LABELER_DID = 'did:plc:actual-production-labeler-did'
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

#### Algorithm Service (fly-algorithm.toml)
```toml
app = 'notes-algorithm'
primary_region = 'sjc'

[build]

[env]
  NODE_ENV = 'production'
  LOG_LEVEL = 'info'
  COMMUNITY_NOTES_DB_SQLITE_PATH = '/litefs/community-notes.db'
  PRIMARY_REGION = 'sjc'

[[services]]
  protocol = "tcp"
  internal_port = 8082
  processes = ["algorithm"]

  [[services.ports]]
    port = 8082
    handlers = ["http"]

  [[services.tcp_checks]]
    interval = "30s"
    timeout = "5s"
    grace_period = "2s"
    method = "GET"
    path = "/health"

[processes]
  algorithm = "node algorithm-service.js"

[deploy]
  strategy = "immediate"

[[vm]]
  memory = '512mb'
  cpu_kind = 'shared'
  cpus = 1

# LiteFS configuration - same as notes service
[experimental]
  enable_consul = true

[[mounts]]
  source = "litefs"
  destination = "/litefs"

# Schedule algorithm to run periodically
[[cron]]
  schedule = "0 */6 * * *"  # Every 6 hours
  command = "node run-algorithm.js"
```

### Dockerfile Configuration
```dockerfile
FROM node:20.11-alpine

RUN apk add --update dumb-init curl ca-certificates fuse3

# Install LiteFS
RUN curl -L https://github.com/superfly/litefs/releases/latest/download/litefs-linux-amd64.tar.gz | tar xz -C /tmp
RUN mv /tmp/litefs /usr/local/bin/

# Create directories for LiteFS
RUN mkdir -p /var/lib/litefs /litefs

# Avoid zombie processes, handle signal forwarding
ENTRYPOINT ["dumb-init", "--"]

WORKDIR /app/services/notes
COPY --from=build /app /app
COPY litefs.yml /app/services/notes/

EXPOSE 8080
ENV PORT=8081
ENV NODE_ENV=production

# LiteFS needs to run as root for FUSE mounting
# The Node.js app will run on port 8081, LiteFS proxies on 8080
CMD ["litefs", "mount", "-config", "litefs.yml", "-exec", "node --heapsnapshot-signal=SIGUSR2 --enable-source-maps index.js"]
```

### Justfile Commands (Revised)

**Key Changes**:
- No `--app` flags needed (app name in fly.toml)
- Reads non-secret variables from .env
- All secrets set via `fly secrets set`
- Added LiteFS volume setup

#### Setup Commands
- `just fly-setup`: Complete setup (app creation, secrets, volume, deploy)
- `just setup-volume`: Create LiteFS storage volume
- `just setup-secrets`: Set all secrets from environment variables
- `just setup-algorithm`: Deploy algorithm service
- `just scale-single`: Ensure single machine deployment

#### Deployment Commands
- `just deploy`: Deploy notes service (no app flag needed)
- `just deploy-algorithm`: Deploy algorithm service
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

### 1. Deploy Notes Service (Primary)

```bash
cd services/notes
fly deploy --config fly.toml
```

This deploys:
- **Notes Service**: HTTP API on port 8080
- **LiteFS Primary**: Handles writes and replication
- **Database**: `/litefs/community-notes.db`

### 2. Deploy Algorithm Service (Replica)

```bash
cd services/notes-algorithm
fly deploy
```

This deploys:
- **Algorithm Service**: Batch process with health endpoint
- **LiteFS Replica**: Reads from primary, can write during batch windows
- **Periodic Processing**: Runs algorithm every 6 hours

### 3. Environment Variables

Set these secrets in Fly.io:

```bash
# Required for both services
fly secrets set SERVICE_ACCOUNT_DID="did:plc:actual-production-service-did"
fly secrets set LABELER_DID="did:plc:actual-production-labeler-did"
fly secrets set LABELER_SIGNING_KEY="your-signing-key"


```

### 4. Volume Setup

LiteFS uses Fly.io volumes for persistence:

```bash
# Create volume for Notes service
cd services/notes
fly volumes create litefs --region sjc --size 10

# Create volume for Algorithm service
cd services/notes-algorithm
fly volumes create litefs --region sjc --size 10
```

## Database Access Pattern

### Notes Service (Primary)
- **Reads**: Direct SQLite access via LiteFS FUSE mount
- **Writes**: Only for signing labels (updates `labels.sig`)
- **Port**: 8080 (LiteFS proxy) → 8081 (Node.js app)

### Algorithm Service (Replica)
- **Reads**: Replicated data from primary
- **Writes**: Batch writes to `statusEvent` table
- **Schedule**: Every 6 hours via cron job
- **Health**: Port 8082 for monitoring

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

#### LiteFS Status

```bash
# SSH into container
fly ssh console

# Check LiteFS status
litefs status

# View LiteFS logs
tail -f /var/log/litefs.log
```

#### Database Verification

```bash
# Connect to database
sqlite3 /litefs/community-notes.db

# Check recent status events
SELECT * FROM statusEvent ORDER BY statusEventTime DESC LIMIT 10;

# Check label creation
SELECT * FROM labels ORDER BY cts DESC LIMIT 10;
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
- **Notes Service**: Can scale to multiple replicas (all read-only)
- **Algorithm Service**: Should remain single instance (batch writer)
- **Database**: Single primary, multiple replicas via LiteFS

### Performance
- **Read Performance**: Excellent (local SQLite access)
- **Write Performance**: Good (single primary writer)
- **Replication Lag**: < 100ms between primary and replicas

### Data Persistence
- **LiteFS Replication**: Primary/replica pattern for data durability
- **Volume Storage**: Persistent Fly.io volumes for database files
- **Automatic Failover**: Primary promotion if current primary fails

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
- `@atproto/notes`: Main service package
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

### ✅ Questions Answered & Addressed

1. **LiteFS Setup**: Complete configuration with shared SQLite database access
2. **SERVICE_ACCOUNT_ACCESS_JWT**: Manual account creation process documented
3. **DID Differences**: SERVICE_ACCOUNT_DID vs SERVICE_ACCOUNT_USER_DID explained
4. **Key Differences**: Labeler signing key vs service private key purposes clarified
5. **Environment Variables**: Non-secrets in fly.toml, secrets in Fly.io secrets only
6. **APP_NAME**: Hardcoded in fly.toml, no --app flags needed
7. **Configuration Strategy**: Single .env with non-secrets, justfile reads via dotenv-load
8. **Negative Labels**: Trigger-based system ensures correct negative label creation

### 🔄 Implementation Status

- **Phases 1-3**: ✅ Completed (basic service structure and deployment)
- **Phase 4**: ✅ Completed (LiteFS integration)
- **Phase 5**: ✅ Designed (trigger-based labeling)
- **Phase 6**: 🔄 Needs configuration cleanup
- **Phase 7**: Future production hardening

### 🎯 Next Steps

1. **Implement trigger-based labeling** with database migrations
2. **Update existing files** for configuration cleanup
3. **Test deployment** with new LiteFS configuration
4. **Document manual setup procedures** for production DIDs and accounts
5. **Implement monitoring** and health checks

The service architecture is now ready for production with LiteFS-based shared database access and proper trigger-based label creation!
