#!/usr/bin/env bash
# Tests for scripts/production-deploy-env.sh — no fly deploy.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="${ROOT}/scripts/production-deploy-env.sh"
failures=0

assert_eq() {
  local name="$1" expected="$2" actual="$3"
  if [[ "$expected" != "$actual" ]]; then
    echo "FAIL ${name}: expected '${expected}' got '${actual}'" >&2
    failures=$((failures + 1))
    return 1
  fi
  echo "PASS ${name}"
}

assert_contains() {
  local name="$1" needle="$2" haystack="$3"
  if [[ "$haystack" != *"$needle"* ]]; then
    echo "FAIL ${name}: missing '${needle}'" >&2
    echo "$haystack" >&2
    failures=$((failures + 1))
    return 1
  fi
  echo "PASS ${name}"
}

assert_not_contains() {
  local name="$1" needle="$2" haystack="$3"
  if [[ "$haystack" == *"$needle"* ]]; then
    echo "FAIL ${name}: unexpectedly found '${needle}'" >&2
    echo "$haystack" >&2
    failures=$((failures + 1))
    return 1
  fi
  echo "PASS ${name}"
}

write_fixture() {
  local dest="$1"
  cat >"$dest" <<'EOF'
NODE_ENV=production
LOG_ENABLED=true
LOG_LEVEL=debug
LOG_DESTINATION=/dev/stdout
PDS_URL=https://pds.example.test
LABELER_URL=https://labeler.example.test
DB_PATH=/tmp/notes.db
REPO_DID=did:plc:repotestfixture0000000001
FEEDGEN_DOCUMENT_DID=did:web:feed.example.test
LABELER_DID=did:plc:labelertestfixture0000001
HOSTNAME=unused.example.test
PUBLIC_URL=https://notes.example.test
PORT=8080
INTERNAL_API_PORT=8081
EOF
}

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

# --- happy path: explicit GITHUB_ENV write includes LABELER_DID ---
fixture="${WORKDIR}/ok.env"
write_fixture "$fixture"
github_env="${WORKDIR}/github.env"
: >"$github_env"
out="$(
  PRODUCTION_ENV_FILE="$fixture" GITHUB_ENV="$github_env" \
    "$SCRIPT" --write-github-env
)"
assert_contains "checklist names LABELER_DID" "LABELER_DID" "$out"
assert_contains "checklist redacts DID" "did:plc:..." "$out"
assert_contains "checklist skips AID_SALT require" "AID_SALT" "$out"
assert_contains "GITHUB_ENV LABELER_DID" "LABELER_DID=did:plc:labelertestfixture0000001" "$(cat "$github_env")"
assert_contains "GITHUB_ENV FEEDGEN" "FEEDGEN_DOCUMENT_DID=did:web:feed.example.test" "$(cat "$github_env")"
assert_contains "GITHUB_ENV LOG_LEVEL" "LOG_LEVEL=debug" "$(cat "$github_env")"
assert_contains "GITHUB_ENV PUBLIC_URL" "PUBLIC_URL=https://notes.example.test" "$(cat "$github_env")"
assert_not_contains "GITHUB_ENV omits HOSTNAME" "HOSTNAME=" "$(cat "$github_env")"
assert_not_contains "GITHUB_ENV omits PORT" "PORT=" "$(cat "$github_env")"
assert_not_contains "GITHUB_ENV omits AID_SALT" "AID_SALT=" "$(cat "$github_env")"

# --- empty LABELER_DID fails closed and does not write GITHUB_ENV ---
empty_labeler="${WORKDIR}/empty-labeler.env"
write_fixture "$empty_labeler"
# Keep the assignment so source overwrites any ambient LABELER_DID.
sed -i 's/^LABELER_DID=.*/LABELER_DID=/' "$empty_labeler"
github_env_empty="${WORKDIR}/github-empty.env"
echo "PREEXISTING=1" >"$github_env_empty"
# Ambient value must not satisfy the check — file is source of truth.
export LABELER_DID="did:plc:ambientshouldnotwin0000001"
set +e
err="$(
  PRODUCTION_ENV_FILE="$empty_labeler" GITHUB_ENV="$github_env_empty" \
    "$SCRIPT" --write-github-env 2>&1
)"
empty_status=$?
set -e
unset LABELER_DID
assert_eq "empty LABELER_DID exit" "1" "$empty_status"
assert_contains "empty LABELER_DID message" "LABELER_DID" "$err"
assert_contains "empty refuses deploy" "Refusing to fly deploy" "$err"
assert_eq "empty does not write GITHUB_ENV" "PREEXISTING=1" "$(cat "$github_env_empty")"

# --- missing PUBLIC_URL fails closed ---
missing_public="${WORKDIR}/missing-public.env"
write_fixture "$missing_public"
sed -i '/^PUBLIC_URL=/d' "$missing_public"
set +e
err="$(PRODUCTION_ENV_FILE="$missing_public" "$SCRIPT" 2>&1)"
missing_status=$?
set -e
assert_eq "missing PUBLIC_URL exit" "1" "$missing_status"
assert_contains "missing PUBLIC_URL message" "PUBLIC_URL" "$err"

# --- empty FEEDGEN_DOCUMENT_DID fails closed ---
empty_feedgen="${WORKDIR}/empty-feedgen.env"
write_fixture "$empty_feedgen"
sed -i 's/^FEEDGEN_DOCUMENT_DID=.*/FEEDGEN_DOCUMENT_DID=/' "$empty_feedgen"
set +e
err="$(PRODUCTION_ENV_FILE="$empty_feedgen" "$SCRIPT" 2>&1)"
feedgen_status=$?
set -e
assert_eq "empty FEEDGEN_DOCUMENT_DID exit" "1" "$feedgen_status"
assert_contains "empty FEEDGEN message" "FEEDGEN_DOCUMENT_DID" "$err"

# --- real production.env ---
github_env_prod="${WORKDIR}/github-prod.env"
: >"$github_env_prod"
out="$(
  PRODUCTION_ENV_FILE="${ROOT}/production.env" GITHUB_ENV="$github_env_prod" \
    "$SCRIPT" --write-github-env
)"
assert_contains "real file GITHUB_ENV LABELER_DID non-empty" "LABELER_DID=did:plc:" "$(cat "$github_env_prod")"
# Empty assignment must not appear.
if grep -q '^LABELER_DID=$' "$github_env_prod"; then
  echo "FAIL real file wrote empty LABELER_DID" >&2
  failures=$((failures + 1))
else
  echo "PASS real file LABELER_DID not empty"
fi
assert_contains "real file checklist" "LABELER_DID" "$out"

# --- source path used by the Deploy step ---
set +e
source_ok="$(
  PRODUCTION_ENV_FILE="$fixture"
  # shellcheck disable=SC1090
  source "$SCRIPT" >/dev/null
  printf '%s' "${LABELER_DID:-}"
)"
source_ok_status=$?
set -e
assert_eq "source path exit" "0" "$source_ok_status"
assert_eq "source path exports LABELER_DID" "did:plc:labelertestfixture0000001" "$source_ok"

set +e
(
  PRODUCTION_ENV_FILE="$empty_labeler"
  # shellcheck disable=SC1090
  source "$SCRIPT" >/dev/null 2>&1
)
source_empty_status=$?
set -e
assert_eq "source path empty LABELER_DID fails" "1" "$source_empty_status"

# --- --write-github-env without GITHUB_ENV fails ---
set +e
err="$(PRODUCTION_ENV_FILE="$fixture" env -u GITHUB_ENV "$SCRIPT" --write-github-env 2>&1)"
no_ge_status=$?
set -e
assert_eq "missing GITHUB_ENV exit" "1" "$no_ge_status"
assert_contains "missing GITHUB_ENV message" "GITHUB_ENV" "$err"

if ((failures > 0)); then
  echo "FAILED ${failures} assertion(s)" >&2
  exit 1
fi
echo "All production-deploy-env tests passed."
