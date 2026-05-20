#!/usr/bin/env sh
set -eu

EXPECTED_UPLOAD_MAX_FILESIZE="${EXPECTED_UPLOAD_MAX_FILESIZE:-64M}"
EXPECTED_POST_MAX_SIZE="${EXPECTED_POST_MAX_SIZE:-96M}"
EXPECTED_MEMORY_LIMIT="${EXPECTED_MEMORY_LIMIT:-512M}"
EXPECTED_MAX_EXECUTION_TIME="${EXPECTED_MAX_EXECUTION_TIME:-120}"
EXPECTED_MAX_INPUT_TIME="${EXPECTED_MAX_INPUT_TIME:-120}"

usage() {
  cat <<'USAGE'
Usage:
  check_php_limits.sh --url <php-limits-probe-url> [--dry-run]

Purpose:
  Read PHP web limits from an operator-provided HTTPS probe and compare them
  with the IntegraGLPI pre-production baseline.

Required:
  --url       Full HTTPS URL of a temporary/authorized PHP limits probe.

Options:
  --dry-run   Print the curl command without calling the URL.
  --help      Show this help.

Notes:
  This script is read-only. It does not create the probe and does not modify
  GLPI, LSWS, PHP, or production.
USAGE
}

URL=""
DRY_RUN=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --url)
      URL="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [ -z "$URL" ]; then
  echo "Missing required --url" >&2
  usage >&2
  exit 2
fi

case "$URL" in
  https://*) ;;
  *)
    echo "--url must use https:// to avoid leaking diagnostics over plaintext." >&2
    exit 2
    ;;
esac

if [ "$DRY_RUN" -eq 1 ]; then
  printf 'DRY-RUN: curl -fsS %s\n' "$URL"
  exit 0
fi

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required." >&2
  exit 2
fi

BODY="$(curl -fsS "$URL")"
printf '%s\n' "$BODY"

check_contains() {
  key="$1"
  expected="$2"
  if printf '%s' "$BODY" | grep -Eq "\"$key\"[[:space:]]*:[[:space:]]*\"?$expected\"?"; then
    printf 'OK %s=%s\n' "$key" "$expected"
  else
    printf 'MISMATCH %s expected %s\n' "$key" "$expected" >&2
    return 1
  fi
}

check_contains upload_max_filesize "$EXPECTED_UPLOAD_MAX_FILESIZE"
check_contains post_max_size "$EXPECTED_POST_MAX_SIZE"
check_contains memory_limit "$EXPECTED_MEMORY_LIMIT"
check_contains max_execution_time "$EXPECTED_MAX_EXECUTION_TIME"
check_contains max_input_time "$EXPECTED_MAX_INPUT_TIME"
