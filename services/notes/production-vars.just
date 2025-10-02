HOSTNAME := "api.bluenotes.social"

PORT := "8080"
INTERNAL_API_PORT := "8081"

# Set up internal endpoint for local development
INTERNAL_ENDPOINT := "http://atproto-notes-api.internal:8081"


NODE_ENV      := "production"
LOG_LEVEL     := "debug"
LOG_ENABLED   := "true"
LOG_DESTINATION := "/dev/stdout"

PDS_URL       := "https://rhizopogon.us-west.host.bsky.network"
LABELER_URL   := "http://testlabeler3.internal:8081"

DB_PATH       := "/litefs/community-notes.db"

# Public DIDs (not secrets)
REPO_DID             := "did:plc:jqzvhkz7gxovq55fa7ibs6px"
FEEDGEN_DOCUMENT_DID := "did:web:" + HOSTNAME
LABELER_DID          := "did:plc:57fl6zy4wmpuknwpgtjqkvlz"
