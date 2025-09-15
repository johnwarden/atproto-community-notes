# Some helper commands to be run with 'just'. The 'just' command more or less to replaces .PHONY targets in Makefiles, but has a few advantages as a "just a command runner". There is also a Makefile with similar commands for those who prefer it.

help:
    @just --list --unsorted

# Default recipe - show available commands
default:
    @just --list

    
set shell := ["zsh", "-o", "pipefail", "-c"]


set dotenv-filename := "dev.env" 
import "notes.just"
import "dev-env.just"


# Codegen
codegen PACKAGE="":
    #!/usr/bin/env bash
    if [ -n "{{PACKAGE}}" ]; then
       pnpm --filter "@atproto/{{PACKAGE}}" codegen
    else
       pnpm codegen
    fi

# Build
build:
   pnpm build

# Run tests
test FILE="":
    #!/usr/bin/env bash
        cd packages/notes
    if [ -n "{{FILE}}" ]; then
        LOG_LEVEL=debug LOG_ENABLED=true LOG_DESTINATION="../../test.log" time timeout 30 ../dev-infra/with-test-redis-and-db.sh node --test --import=tsx tests/$(basename {{FILE}})
    else
        LOG_LEVEL=debug LOG_ENABLED=true LOG_DESTINATION="../../test.log" time timeout 120 ../dev-infra/with-test-redis-and-db.sh node --test --import=tsx tests/*.test.ts
    fi


lint PACKAGE="":
    eslint "packages/notes" --ext .ts,.js,.tsx,.jsx

# Format source files (lint --fix and prettier --write)
format  *ARGS:
    #!/usr/bin/env bash
    eslint "packages/notes" --ext .ts,.js,.tsx,.jsx --fix
    prettier --write "packages/notes" {{ARGS}}

# verify
verify:
    just style notes
    just lint notes
    just typecheck notes


# Run syntax re-formatting, just on lexicon .json files
fmt-lexicons:
    pnpm exec eslint ./lexicons/ --ext .json --fix

# Run Typescript typechecks
typecheck PACKAGE="":
    #!/usr/bin/env bash
    if [ -n "{{PACKAGE}}" ]; then
        cd packages/{{PACKAGE}}; npx tsc --build tsconfig.json
    else
        npx tsc --build tsconfig.json
    fi

# Run the query-pds tool
query-pds *ARGS:
    cd packages/pds && pnpm exec ts-node src/query-pds.ts --json {{ARGS}}

# Tail debug logs through pino-pretty. Optionally FILTER logs for specific package.
logs FILTER="":
    #!/usr/bin/env bash
    if [ -n "{{FILTER}}" ]; then
        echo "📋 Showing recent logs for filter: {{FILTER}}"
        tail -20 $LOG_DESTINATION | jq --unbuffered -c 'select((.name // "") | startswith("{{FILTER}}"))' | pnpm exec pino-pretty
        echo ""
        echo "🔄 Following new logs for filter: {{FILTER}}"
        tail -f $LOG_DESTINATION | jq --unbuffered -c 'select((.name // "") | startswith("{{FILTER}}"))' | pnpm exec pino-pretty
    else
        tail -f $LOG_DESTINATION | pnpm exec pino-pretty
    fi

# Show recent debug logs without following. Optionally FILTER logs for specific package.
recent-logs FILTER="" LINES="50":
    #!/usr/bin/env bash
    if [ -n "{{FILTER}}" ]; then
        echo "📋 Showing recent {{LINES}} logs for filter: {{FILTER}}"
        tail -{{LINES}} $LOG_DESTINATION | jq --unbuffered -c 'select((.name // "") | startswith("{{FILTER}}"))' | pnpm exec pino-pretty
    else
        echo "📋 Showing recent {{LINES}} logs"
        tail -{{LINES}} $LOG_DESTINATION | pnpm exec pino-pretty
    fi

# Show recent debug logs without following. Optionally FILTER logs for specific package.
test-logs FILTER="" LINES="50":
    #!/usr/bin/env bash
    if [ -n "{{FILTER}}" ]; then
        echo "📋 Showing recent {{LINES}} logs for filter: {{FILTER}}"
        tail -{{LINES}} test.log | jq --unbuffered -c 'select((.name // "") | startswith("{{FILTER}}"))' | pnpm exec pino-pretty
    else
        echo "📋 Showing recent {{LINES}} logs"
        tail -{{LINES}} test.log | pnpm exec pino-pretty
    fi

introspect:
    curl --get http://localhost:2581 | jq
