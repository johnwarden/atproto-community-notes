# Test Network

A utility to run commands with a test AT Protocol network including the notes service.

## Overview

The test network runner creates a complete AT Protocol test network *including* the notes service. The test network is similar to that created by @atproto/dev-env, but it uses randomly assigned ports and includes mock users and test data.

## Usage

### Basic Usage
```bash
cd packages/dev-infra
./with-test-network.sh <your_command>
```

### Examples
```bash
# Run a Python scoring service
./with-test-network.sh python my_scoring_service.py

# Test the score endpoint directly
./with-test-network.sh curl -X POST http://localhost:2597/score \
  -H "Content-Type: application/json" \
  -d '{"proposalUri": "at://test", "status": "needs_more_ratings", "score": 0.5}'

# Run any command that needs the test network
./with-test-network.sh node my_test_script.js
```

## What You Get

The test network includes:
- **Test Users**: alice.test, bob.test, carol.test (password: hunter2)
- **Test Posts**: Sample posts from Alice and Bob  
- **Scored Proposals**: Community notes proposals with various scores and statuses
- **All Services**: PDS, Bsky, Ozone, PLC, Notes Service, Labeler Service

When started, the script displays service URLs and test data URIs for your use.

## Environment Variables

Your command will have access to these environment variables:

- `DB_POSTGRES_URL` - PostgreSQL connection string
- `REDIS_HOST` - Redis server host:port
- `INTROSPECT_PORT` - Port number for the introspection server (e.g., "2581")

The introspection server provides service information at `http://localhost:$INTROSPECT_PORT/`.

## How It Works

1. Starts Redis and PostgreSQL (like `with-test-redis-and-db.sh`)
2. Launches the test network with mock data in the background
3. Captures the randomly assigned introspection port
4. Runs your command with all environment variables available
5. Automatically shuts down the test network when your command exits
6. Propagates your command's exit code

The script handles signals properly and ensures clean shutdown even if interrupted.