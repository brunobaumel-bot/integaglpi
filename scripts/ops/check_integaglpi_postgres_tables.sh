#!/usr/bin/env sh
set -eu

usage() {
  cat <<'USAGE'
Usage:
  check_integaglpi_postgres_tables.sh --host <host> --port <port> --database <db> --user <user> [--dry-run]

Purpose:
  Read-only validation of critical IntegraGLPI PostgreSQL tables and columns.

Required:
  --host      PostgreSQL host.
  --port      PostgreSQL port.
  --database  PostgreSQL database.
  --user      PostgreSQL user.

Options:
  --dry-run   Print psql command and SQL without connecting.
  --help      Show this help.

Notes:
  Passwords must be provided through approved operator flow such as .pgpass,
  PGPASSFILE outside the repository, or interactive prompt. Do not put secrets
  in this script or in documentation.
USAGE
}

HOST=""
PORT=""
DATABASE=""
USER_NAME=""
DRY_RUN=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --host) HOST="${2:-}"; shift 2 ;;
    --port) PORT="${2:-}"; shift 2 ;;
    --database) DATABASE="${2:-}"; shift 2 ;;
    --user) USER_NAME="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

if [ -z "$HOST" ] || [ -z "$PORT" ] || [ -z "$DATABASE" ] || [ -z "$USER_NAME" ]; then
  echo "Missing required arguments." >&2
  usage >&2
  exit 2
fi

SQL_CONTENT=$(cat <<'SQL'
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'glpi_plugin_integaglpi_conversations',
    'glpi_plugin_integaglpi_messages',
    'glpi_plugin_integaglpi_audit_events',
    'glpi_plugin_integaglpi_entity_selection_attempts',
    'glpi_plugin_integaglpi_configs',
    'glpi_plugin_integaglpi_message_delivery_status',
    'glpi_plugin_integaglpi_inactivity_job_events'
  )
ORDER BY table_name;

SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'glpi_plugin_integaglpi_conversations',
    'glpi_plugin_integaglpi_messages',
    'glpi_plugin_integaglpi_audit_events',
    'glpi_plugin_integaglpi_entity_selection_attempts',
    'glpi_plugin_integaglpi_configs'
  )
ORDER BY table_name, ordinal_position;
SQL
)

if printf '%s' "$SQL_CONTENT" | grep -Eiq '(^|[^A-Z_])(INSERT|UPDATE|DROP|DELETE|TRUNCATE)([^A-Z_]|$)'; then
  echo "Safety check failed: non-read-only SQL token found." >&2
  exit 3
fi

if [ "$DRY_RUN" -eq 1 ]; then
  printf 'DRY-RUN: psql --host %s --port %s --username %s --dbname %s --set ON_ERROR_STOP=1\n' "$HOST" "$PORT" "$USER_NAME" "$DATABASE"
  printf '%s\n' "$SQL_CONTENT"
  exit 0
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required." >&2
  exit 2
fi

printf '%s\n' "$SQL_CONTENT" | psql --host "$HOST" --port "$PORT" --username "$USER_NAME" --dbname "$DATABASE" --set ON_ERROR_STOP=1
