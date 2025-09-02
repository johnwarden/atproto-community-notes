# Development environment management commands
#
# This file contains all commands related to managing the ATProto dev-env.
# The dev-env runs multiple services: PDS, Bsky, Ozone, Notes, PLC, and introspection.
# Now powered by Process Compose for better reliability.

# Start the dev-env and wait for all services to be ready
start:
    @packages/dev-env/dev-env-manager.sh start

# Start the dev-env without waiting (immediate return)
start-nowait:
    @packages/dev-env/dev-env-manager.sh start-nowait

# Start the dev-env in foreground (with logs)
start-foreground:
    @packages/dev-env/dev-env-manager.sh start-foreground

# Stop the dev-env gracefully
stop:
    @packages/dev-env/dev-env-manager.sh stop

# Restart the dev-env (stops if running, then starts with waiting)
restart:
    @packages/dev-env/dev-env-manager.sh restart

# Show dev-env status, service URLs, and mock data status
status:
    @packages/dev-env/dev-env-manager.sh status

# Show logs from the dev-env process
process-logs:
    @packages/dev-env/dev-env-manager.sh logs

# Health check - verify all services are responding
health:
    @packages/dev-env/dev-env-manager.sh health

# Check process-compose server status
process-compose-server-status:
    @packages/dev-env/dev-env-manager.sh server-status

# Clean up any stuck processes or resources
clean:
    @packages/dev-env/dev-env-manager.sh clean

# Open SQLite REPL connection to PDS databases with all databases attached
pds-db:
    #!/usr/bin/env bash
    # Get PDS database paths from introspection server
    ACCOUNT_DB=$(curl -s http://localhost:2581 2>/dev/null | jq -r '.pds.accountDb // empty')
    SEQUENCER_DB=$(curl -s http://localhost:2581 2>/dev/null | jq -r '.pds.sequencerDb // empty')
    DID_CACHE_DB=$(curl -s http://localhost:2581 2>/dev/null | jq -r '.pds.didCacheDb // empty')

    if [[ -z "$ACCOUNT_DB" || "$ACCOUNT_DB" == "null" || "$ACCOUNT_DB" == "empty" ]]; then
        echo "❌ Could not get PDS database paths from introspection server"
        echo "   Make sure the dev-env is running with 'just start'"
        exit 1
    fi

    if [[ ! -f "$ACCOUNT_DB" ]]; then
        echo "❌ PDS account database file not found: $ACCOUNT_DB"
        exit 1
    fi

    echo "🌞 Connecting to PDS databases with all databases attached:"
    echo "   Main: account database"
    echo "   Attached: sequencer (as 'seq'), did_cache (as 'did')"
    echo ""
    echo "   Useful commands:"
    echo "     .tables                    - List tables in main database"
    echo "     .schema                    - Show schemas in main database"
    echo "     .databases                 - List all attached databases"
    echo "     SELECT * FROM seq.commit;  - Query sequencer database"
    echo "     SELECT * FROM did.entry;   - Query DID cache database"
    echo "     .quit                      - Exit"
    echo ""

    # Create a temporary SQL script to attach databases
    ATTACH_SCRIPT=$(mktemp)
    echo "ATTACH DATABASE '$SEQUENCER_DB' AS seq;" > "$ATTACH_SCRIPT"
    echo "ATTACH DATABASE '$DID_CACHE_DB' AS did;" >> "$ATTACH_SCRIPT"
    echo ".databases" >> "$ATTACH_SCRIPT"

    # Run sqlite3 with the attach script, then start interactive mode
    sqlite3 "$ACCOUNT_DB" < "$ATTACH_SCRIPT"
    rm "$ATTACH_SCRIPT"

    # Create init script for interactive session
    INIT_SCRIPT=$(mktemp)
    echo "ATTACH DATABASE '$SEQUENCER_DB' AS seq;" > "$INIT_SCRIPT"
    echo "ATTACH DATABASE '$DID_CACHE_DB' AS did;" >> "$INIT_SCRIPT"

    # Start interactive session with databases already attached
    sqlite3 "$ACCOUNT_DB" -init "$INIT_SCRIPT"
    rm "$INIT_SCRIPT"

# Open SQLite connection to the notes database (interactive or execute SQL)
# Usage: just notes-db [SQL_STATEMENT]
notes-db *SQL:
    #!/usr/bin/env bash
    # Get the notes database path from introspection server
    DB_PATH=$(curl -s http://localhost:2581 2>/dev/null | jq -r '.notes.dbPath // empty')

    if [[ -z "$DB_PATH" || "$DB_PATH" == "null" || "$DB_PATH" == "empty" ]]; then
        echo "❌ Could not get notes database path from introspection server"
        echo "   Make sure the dev-env is running with 'just start'"
        exit 1
    fi

    if [[ ! -f "$DB_PATH" ]]; then
        echo "❌ Notes database file not found: $DB_PATH"
        exit 1
    fi

    if [[ -z "{{ SQL }}" ]]; then
        # Interactive mode
        echo "📝 Connecting to notes database: $DB_PATH"
        echo "   Contains: proposals, votes (user-generated content)"
        echo "   Useful commands:"
        echo "     .tables          - List all tables"
        echo "     .schema          - Show table schemas"
        echo "     .quit            - Exit"
        echo ""
        sqlite3 "$DB_PATH"
    else
        # Execute SQL statement
        echo "📝 Executing SQL on notes database: $DB_PATH"
        sqlite3 "$DB_PATH" "{{ SQL }}"
    fi

# Open SQLite connection to the notes database for scoring data (interactive or execute SQL)
# Usage: just scores-db [SQL_STATEMENT]
scores-db *SQL:
    #!/usr/bin/env bash
    # Get the notes database path from introspection server (now contains scoring data)
    DB_PATH=$(curl -s http://localhost:2581 2>/dev/null | jq -r '.notes.dbPath // empty')

    if [[ -z "$DB_PATH" || "$DB_PATH" == "null" || "$DB_PATH" == "empty" ]]; then
        echo "❌ Could not get notes database path from introspection server"
        echo "   Make sure the dev-env is running with 'just start'"
        exit 1
    fi

    if [[ ! -f "$DB_PATH" ]]; then
        echo "❌ Notes database file not found: $DB_PATH"
        exit 1
    fi

    if [[ -z "{{ SQL }}" ]]; then
        # Interactive mode
        echo "🏷️  Connecting to notes database (scoring tables): $DB_PATH"
        echo "   Contains: scoreEvent, score, pendingLabels (consolidated scoring data)"
        echo "   Useful commands:"
        echo "     .tables          - List all tables"
        echo "     .schema          - Show table schemas"
        echo "     .quit            - Exit"
        echo ""
        sqlite3 "$DB_PATH"
    else
        # Execute SQL statement
        echo "🏷️  Executing SQL on notes database: $DB_PATH"
        sqlite3 "$DB_PATH" "{{ SQL }}"
    fi

# Connect to PostgreSQL database used by Bsky and Ozone
postgres:
    #!/usr/bin/env bash
    # Get PostgreSQL connection info from introspection server
    DB_URL=$(curl -s http://localhost:2581 2>/dev/null | jq -r '.bsky.dbUrl // empty')

    if [[ -z "$DB_URL" || "$DB_URL" == "null" || "$DB_URL" == "empty" ]]; then
        echo "❌ Could not get PostgreSQL URL from introspection server"
        echo "   Make sure the dev-env is running with 'just start'"
        exit 1
    fi

    echo "🐘 Connecting to PostgreSQL database: $DB_URL"
    echo "   Useful commands:"
    echo "     \\dt              - List all tables"
    echo "     \\d table_name    - Describe table schema"
    echo "     \\l               - List databases"
    echo "     \\q               - Exit"
    echo ""
    psql "$DB_URL"
