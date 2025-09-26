# Create a test note through the notes API
create-note URI="":
    #!/usr/bin/env bash
    if [ -z "{{URI}}" ]; then
        # Get a real post URI from Alice's posts if no URI provided
        REAL_URI=$(curl -s "http://localhost:2583/xrpc/com.atproto.repo.listRecords?repo=alice.test&collection=app.bsky.feed.post&limit=1" -H "Authorization: Bearer $TOKEN" | jq -r '.records[0].uri // empty')
        if [[ -n "$REAL_URI" && "$REAL_URI" != "null" && "$REAL_URI" != "empty" ]]; then
            TARGET_URI="$REAL_URI"
        else
            echo "❌ Could not get real post URI and no URI provided"
            exit 1
        fi
    else
        TARGET_URI="{{URI}}"
    fi

    curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d "{
      \"typ\": \"label\",
      \"uri\": \"$TARGET_URI\",
      \"val\": \"annotation\",
      \"note\": \"This is my test note\",
      \"reasons\": [\"factual_error\", \"missing_context\"]
    }" "http://localhost:2595/xrpc/org.opencommunitynotes.propose" | jq

# Run integration tests for the notes service
test-dev-env:
	cd packages/notes/tests; ./run-tests.sh

auth-token:
    #!/usr/bin/env bash
    TOKEN=$(curl -s -X POST "http://localhost:2583/xrpc/com.atproto.server.createSession" \
      -H "Content-Type: application/json" \
      -d '{"identifier": "alice.test", "password": "hunter2"}' | jq -r '.accessJwt')
    echo "export TOKEN=$TOKEN"

get-auth-token:
    `just auth-token`



get-proposals URI="":
    #!/usr/bin/env bash
    NOTES_RESPONSE=$(curl -s "http://localhost:2595/xrpc/org.opencommunitynotes.getProposals?uris={{URI}}" -H "Authorization: Bearer $TOKEN")
    NOTES_COUNT=$(echo "$NOTES_RESPONSE" | jq '.notes | length')
    GET_NOTES_ERROR=$(echo "$NOTES_RESPONSE" | jq -r '.error')
    echo $NOTES_RESPONSE | jq

get-posts URI="":
    #!/usr/bin/env bash
    RESPONSE=$(curl -s "http://localhost:2584/xrpc/app.bsky.feed.getPosts?uris={{URI}}" -H "Authorization: Bearer $TOKEN")
    echo $RESPONSE | jq .




