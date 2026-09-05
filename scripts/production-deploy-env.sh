#!/usr/bin/env bash
# Load, validate, and (optionally) persist production deploy env for Fly.
#
# Do not scrape `env | grep` into GITHUB_ENV. GNU/coreutils `env` only dumps
# the exported environ, and some runners/wrappers omit names from that dump.
# GitHub Actions run 33938603909 wrote empty --env LABELER_DID= because
# LABELER_*, LOG_*, and FEEDGEN_DOCUMENT_DID never reached the Deploy step.
#
# `fly deploy --env KEY=value` *replaces* that Fly machine env key. An empty
# value wipes the previous working value (run 33938603909). Never pass
# `--env KEY=` when value is empty — omit the flag instead. production.env is
# the source of truth for these keys; CI/just deploy will clobber matching
# machine env on each deploy.
#
# Usage (from repo root, or any cwd — production.env is resolved next to this
# script's parent directory):
#   ./scripts/production-deploy-env.sh
#   ./scripts/production-deploy-env.sh --write-github-env
#   ./scripts/production-deploy-env.sh --print-fly-env-args
#   source ./scripts/production-deploy-env.sh  # also sets FLY_DEPLOY_ENV_ARGS
#
# Env:
#   PRODUCTION_ENV_FILE  Override path to the env file (tests).
#   GITHUB_ENV           Destination for --write-github-env.
set -euo pipefail

_PROD_DEPLOY_ENV_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_PROD_DEPLOY_ENV_ROOT="$(cd "${_PROD_DEPLOY_ENV_SCRIPT_DIR}/.." && pwd)"
PRODUCTION_ENV_FILE="${PRODUCTION_ENV_FILE:-${_PROD_DEPLOY_ENV_ROOT}/production.env}"

# Keys passed to `fly deploy --env`. Written explicitly to GITHUB_ENV.
# Do not include HOSTNAME/PORT — they collide with runner/OS env and are not
# passed through to Fly by this workflow.
DEPLOY_ENV_KEYS=(
  NODE_ENV
  LOG_ENABLED
  LOG_LEVEL
  LOG_DESTINATION
  PDS_URL
  PUBLIC_URL
  LABELER_URL
  LABELER_DID
  DB_PATH
  REPO_DID
  FEEDGEN_DOCUMENT_DID
)

# Fail-closed before fly deploy. AID_SALT is a Fly secret, not required here.
REQUIRED_DEPLOY_KEYS=(
  LABELER_DID
  LABELER_URL
  PDS_URL
  PUBLIC_URL
  REPO_DID
  DB_PATH
  FEEDGEN_DOCUMENT_DID
)

_prod_deploy_env_die() {
  echo "ERROR: $*" >&2
  return 1 2>/dev/null || exit 1
}

_prod_deploy_env_usage() {
  cat <<'EOF'
Usage: production-deploy-env.sh [--write-github-env] [--print-fly-env-args] [--help]

Source production.env, refuse empty required deploy vars, print a redacted
checklist. With --write-github-env, append explicit KEY=value lines to
GITHUB_ENV (never `env | grep`). With --print-fly-env-args, print the
non-empty --env KEY=value flags that are safe to pass to fly deploy.
EOF
}

_prod_deploy_env_redact() {
  local key="$1"
  local value="$2"
  local len="${#value}"
  case "$key" in
    *DID)
      if [[ "$value" == did:*:* ]]; then
        local rest="${value#did:}"
        local method="${rest%%:*}"
        printf 'ok  did:%s:...  (len=%s)' "$method" "$len"
      else
        printf 'ok  (len=%s)' "$len"
      fi
      ;;
    *)
      printf 'ok  (len=%s)' "$len"
      ;;
  esac
}

_prod_deploy_env_load() {
  if [[ ! -f "$PRODUCTION_ENV_FILE" ]]; then
    _prod_deploy_env_die "production env file not found: ${PRODUCTION_ENV_FILE}"
    return 1
  fi
  # File is the source of truth. Drop ambient/GitHub-Environment values so a
  # missing key cannot pass on a leftover export, and an empty assignment
  # cannot be rescued by the caller environment.
  local key
  for key in "${DEPLOY_ENV_KEYS[@]}" "${REQUIRED_DEPLOY_KEYS[@]}"; do
    unset "$key" || true
  done
  set -a
  # shellcheck disable=SC1090
  source "$PRODUCTION_ENV_FILE"
  set +a
}

_prod_deploy_env_assert() {
  local key value missing=()
  for key in "${REQUIRED_DEPLOY_KEYS[@]}"; do
    value="${!key:-}"
    if [[ -z "$value" ]]; then
      missing+=("$key")
    elif [[ "$value" == *$'\n'* || "$value" == *$'\r'* ]]; then
      _prod_deploy_env_die "${key} contains a newline/CR; refusing to deploy"
      return 1
    fi
  done

  if ((${#missing[@]} > 0)); then
    echo "ERROR: Refusing to fly deploy; required production env is empty:" >&2
    for key in "${missing[@]}"; do
      echo "  - ${key}" >&2
    done
    echo "These must be non-empty in ${PRODUCTION_ENV_FILE}." >&2
    echo "AID_SALT is a Fly secret and is not required from production.env." >&2
    return 1
  fi
}

_prod_deploy_env_checklist() {
  local key value
  echo "Production deploy env preflight (values redacted):" >&2
  for key in "${REQUIRED_DEPLOY_KEYS[@]}"; do
    value="${!key:-}"
    printf '  %-22s %s\n' "$key" "$(_prod_deploy_env_redact "$key" "$value")" >&2
  done
  for key in NODE_ENV LOG_ENABLED LOG_LEVEL LOG_DESTINATION; do
    value="${!key:-}"
    if [[ -z "$value" ]]; then
      printf '  %-22s %s\n' "$key" "empty (optional for preflight)" >&2
    else
      printf '  %-22s %s\n' "$key" "$(_prod_deploy_env_redact "$key" "$value")" >&2
    fi
  done
  printf '  %-22s %s\n' "AID_SALT" "skipped (Fly secret, not required from production.env)" >&2
}

# Populate FLY_DEPLOY_ENV_ARGS with --env KEY=value for non-empty keys only.
# Empty --env KEY= wipes prior Fly machine env; omit those flags.
_prod_deploy_env_build_fly_args() {
  FLY_DEPLOY_ENV_ARGS=()
  local key value
  for key in "${DEPLOY_ENV_KEYS[@]}"; do
    value="${!key:-}"
    if [[ -z "$value" ]]; then
      echo "WARNING: omitting empty --env ${key}= (empty Fly --env wipes machine env)" >&2
      continue
    fi
    FLY_DEPLOY_ENV_ARGS+=(--env "${key}=${value}")
  done
}

_prod_deploy_env_print_fly_args() {
  local i
  for ((i = 0; i < ${#FLY_DEPLOY_ENV_ARGS[@]}; i += 2)); do
    printf '%s %s\n' "${FLY_DEPLOY_ENV_ARGS[i]}" "${FLY_DEPLOY_ENV_ARGS[i + 1]}"
  done
}

_prod_deploy_env_write_github_env() {
  if [[ -z "${GITHUB_ENV:-}" ]]; then
    _prod_deploy_env_die "--write-github-env requires GITHUB_ENV"
    return 1
  fi
  local key value
  for key in "${DEPLOY_ENV_KEYS[@]}"; do
    value="${!key:-}"
    if [[ -z "$value" ]]; then
      continue
    fi
    if [[ "$value" == *$'\n'* || "$value" == *$'\r'* ]]; then
      _prod_deploy_env_die "${key} contains a newline/CR; refusing to write GITHUB_ENV"
      return 1
    fi
    # Explicit assignment — never scrape `env`. Same-process ${value}.
    printf '%s=%s\n' "$key" "$value" >>"$GITHUB_ENV"
  done
}

_prod_deploy_env_main() {
  local write_github_env=0
  local print_fly_args=0
  local arg
  for arg in "$@"; do
    case "$arg" in
      --write-github-env) write_github_env=1 ;;
      --print-fly-env-args) print_fly_args=1 ;;
      --help|-h)
        _prod_deploy_env_usage
        return 0
        ;;
      *)
        _prod_deploy_env_die "unknown argument: ${arg}"
        return 1
        ;;
    esac
  done

  _prod_deploy_env_load || return 1
  _prod_deploy_env_assert || return 1
  _prod_deploy_env_build_fly_args
  _prod_deploy_env_checklist
  if ((write_github_env)); then
    _prod_deploy_env_write_github_env || return 1
  fi
  if ((print_fly_args)); then
    _prod_deploy_env_print_fly_args
  fi
  return 0
}

_prod_deploy_env_main "$@"
_prod_deploy_env_status=$?
if [[ "${BASH_SOURCE[0]}" != "${0}" ]]; then
  return "${_prod_deploy_env_status}"
fi
exit "${_prod_deploy_env_status}"
