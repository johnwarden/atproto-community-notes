# Community Notes Integration Test Suite

This directory contains integration tests for the Community Notes service. The tests are designed to verify the complete end-to-end functionality of the system.

## Test Organization

### Core Test Scripts

#### `notes-service-test.sh`
**Purpose**: Tests the Community Notes service API endpoints and core functionality.

**Scope**:
- Service health checks
- Authentication and authorization
- XRPC endpoint validation
- Proposal creation and retrieval
- Rating creation and retrieval
- Input validation and error handling
- Rate limiting

**Dependencies**: Notes service, Bsky service, PDS service

#### `labeler-test.sh`
**Purpose**: Tests the complete labeling pipeline from status events to label creation.

**Scope**:
- Core labeling logic (status events → database triggers → labels)
- Database trigger functionality
- Label creation in scores database
- Status filtering in `getProposals` API
- `queryLabels` endpoint functionality
- Both positive and negative label creation

**Dependencies**: Notes service, Bsky service, scores database

**Note**: This test mocks algorithm behavior by directly inserting score events into the database, rather than relying on the actual scoring algorithm.

#### `accept-labelers-header-test.sh`
**Purpose**: Tests the `atproto-accept-labelers` header functionality.

**Scope**:
- Label hydration via `atproto-accept-labelers` header
- Integration with existing mock labels
- Bsky API label integration

**Dependencies**: Notes service, Bsky service, existing mock labels

### Shared Utilities

#### `test-utils.sh`
**Purpose**: Provides common functions and utilities used across all test scripts.

**Features**:
- Colored output formatting
- Environment variable loading
- Service health checking
- Authentication token creation
- Test post and community note creation
- Proposal rating
- Status event insertion (for mocking)
- Database interaction helpers



## Running Tests

### Prerequisites

1. **Development Environment**: Ensure the dev environment is running:
   ```bash
   just restart
   ```

2. **Services**: The following services must be running:
   - Notes service (http://localhost:2595)
   - Bsky service (http://localhost:2584)
   - PDS service (http://localhost:2583)
   - Introspection service (http://localhost:2581)

### Individual Tests

Run individual test scripts from the project root:

```bash
# Test the Notes service API
./packages/notes/tests/notes-service-test.sh

# Test the labeling pipeline
./packages/notes/tests/labeler-test.sh

# Test the accept-labelers header
./packages/notes/tests/accept-labelers-header-test.sh
```

### All Tests

Run all integration tests using the justfile command:

```bash
# From project root
just integration-test-notes
```

Or run them manually:

```bash
# From project root
for test in packages/notes/tests/*-test.sh; do
    echo "Running $test..."
    ./"$test"
    echo "✅ $test passed"
    echo ""
done
```

## Test Architecture

### Mocking Strategy

The tests use different mocking strategies depending on their scope:

1. **API Tests** (`notes-service-test.sh`): Tests real API endpoints with real data
2. **Labeling Tests** (`labeler-test.sh`): Mocks algorithm behavior by directly inserting status events
3. **Header Tests** (`accept-labelers-header-test.sh`): Uses existing mock labels created during dev environment setup

### Database Interaction

Tests interact with two databases:
- **Notes Database** (`notes.db`): Contains proposals and votes
- **Scores Database** (`scores.db`): Contains status events, status, and labels

The labeling tests directly insert status events into the scores database to simulate algorithm behavior, then verify that database triggers correctly create labels.

### Error Handling

All tests use the shared `test_result()` function which:
- Provides colored output (✅ for success, ❌ for failure)
- Includes detailed error messages
- Exits immediately on first failure
- Provides context for debugging

## Test Data

### Mock Users
- **alice.test**: Primary test user (password: hunter2)
- **bob.test**: Secondary test user (password: hunter2)

### Test Posts
Tests create temporary posts for testing purposes. These are cleaned up automatically by the dev environment reset.

### Mock Labels
The dev environment creates mock labels during startup for testing the accept-labelers header functionality.

## Troubleshooting

### Common Issues

1. **Services Not Running**
   ```
   ❌ Failed to get service information
   ```
   **Solution**: Run `just restart` to start the dev environment

2. **Authentication Failures**
   ```
   ❌ Failed to create authentication token
   ```
   **Solution**: Ensure PDS service is running and mock users exist

3. **Database Connection Issues**
   ```
   ❌ Failed to get scores database path
   ```
   **Solution**: Ensure introspection service is running and databases are created

4. **Test Timeouts**
   Some tests may fail due to timing issues with the scoring stub service (which runs on a 10-second loop).
   **Solution**: Wait for the next scoring cycle or manually insert status events

### Debug Mode

Add `set -x` to any test script to enable debug output:

```bash
#!/bin/bash
set -e
set -x  # Enable debug mode
```

### Manual Testing

For manual testing and debugging, see `manual-commands.txt` for example curl commands and database queries.

#### Bsky Hydration Testing

For debugging Bsky feed integration issues, use the dedicated manual testing script:

```bash
# Run manual Bsky feed hydration test with detailed debugging
just test-bsky-feed-hydration

# Or run directly:
./packages/notes/tests/test-bsky-feed-hydration.sh
```

**This script provides**:
- Health checks for all services
- Manual curl commands for testing each endpoint
- Automated tests with detailed debugging output
- Feed generator record verification in PDS
- DID document inspection (when accessible)
- Timing-tolerant Bsky hydration testing

**Use this when**:
- Debugging Bsky integration issues
- Investigating timing-related sync problems
- Manual verification of feed functionality
- Understanding the feed discovery process

The script includes both automated tests and manual curl commands you can copy/paste for debugging.

## Contributing

When adding new tests:

1. Use the shared utilities in `test-utils.sh`
2. Follow the existing naming convention (`*-test.sh`)
3. Include comprehensive error handling
4. Document the test's purpose and scope in this README
5. Ensure tests are idempotent and don't interfere with each other
