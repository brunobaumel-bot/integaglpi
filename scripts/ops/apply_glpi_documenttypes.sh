#!/usr/bin/env sh
set -eu

usage() {
  cat <<'USAGE'
Usage:
  apply_glpi_documenttypes.sh --defaults-file <mysql-client-cnf> --database <glpi-db> --backup-suffix <YYYYMMDDHHMMSS> [--execute]

Purpose:
  Create a local production backup table and idempotently upsert GLPI
  document types required for WhatsApp audio/video attachments.

Default behavior:
  Dry-run. The generated SQL is printed and no database connection is made.

Required:
  --defaults-file   Path to a MySQL/MariaDB client option file outside repo.
  --database        GLPI database/schema name.
  --backup-suffix   Timestamp suffix for glpi_documenttypes_backup_<suffix>.

Options:
  --execute         Apply SQL using mysql. Requires human confirmation.
  --help            Show this help.

Safety:
  - Does not touch glpi_documents_items.
  - Does not run DROP, DELETE, or TRUNCATE.
  - Creates backup before any update/insert.
USAGE
}

DEFAULTS_FILE=""
DATABASE=""
BACKUP_SUFFIX=""
EXECUTE=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --defaults-file)
      DEFAULTS_FILE="${2:-}"
      shift 2
      ;;
    --database)
      DATABASE="${2:-}"
      shift 2
      ;;
    --backup-suffix)
      BACKUP_SUFFIX="${2:-}"
      shift 2
      ;;
    --execute)
      EXECUTE=1
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

if [ -z "$DEFAULTS_FILE" ] || [ -z "$DATABASE" ] || [ -z "$BACKUP_SUFFIX" ]; then
  echo "Missing required arguments." >&2
  usage >&2
  exit 2
fi

case "$DATABASE" in
  *[!A-Za-z0-9_]*|'')
    echo "--database must contain only letters, numbers, and underscore." >&2
    exit 2
    ;;
esac

case "$BACKUP_SUFFIX" in
  *[!0-9]*|'')
    echo "--backup-suffix must be numeric, e.g. YYYYMMDDHHMMSS." >&2
    exit 2
    ;;
esac

BACKUP_TABLE="glpi_documenttypes_backup_${BACKUP_SUFFIX}"

generate_sql() {
  cat <<SQL
-- IntegraGLPI pre-production documenttypes reconciliation.
-- Manual only. Review before executing.
USE \`${DATABASE}\`;

SELECT COLUMN_NAME, DATA_TYPE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME = 'glpi_documenttypes'
ORDER BY ORDINAL_POSITION;

CREATE TABLE IF NOT EXISTS \`${BACKUP_TABLE}\` AS
SELECT *
FROM glpi_documenttypes;

UPDATE glpi_documenttypes SET mime = 'audio/ogg', name = 'ogg', is_uploadable = 1 WHERE ext = 'ogg';
INSERT INTO glpi_documenttypes (name, ext, mime, is_uploadable)
SELECT 'ogg', 'ogg', 'audio/ogg', 1
WHERE NOT EXISTS (SELECT 1 FROM glpi_documenttypes WHERE ext = 'ogg');

UPDATE glpi_documenttypes SET mime = 'audio/ogg', name = 'oga', is_uploadable = 1 WHERE ext = 'oga';
INSERT INTO glpi_documenttypes (name, ext, mime, is_uploadable)
SELECT 'oga', 'oga', 'audio/ogg', 1
WHERE NOT EXISTS (SELECT 1 FROM glpi_documenttypes WHERE ext = 'oga');

UPDATE glpi_documenttypes SET mime = 'audio/mpeg', name = 'mp3', is_uploadable = 1 WHERE ext = 'mp3';
INSERT INTO glpi_documenttypes (name, ext, mime, is_uploadable)
SELECT 'mp3', 'mp3', 'audio/mpeg', 1
WHERE NOT EXISTS (SELECT 1 FROM glpi_documenttypes WHERE ext = 'mp3');

UPDATE glpi_documenttypes SET mime = 'audio/mp4', name = 'm4a', is_uploadable = 1 WHERE ext = 'm4a';
INSERT INTO glpi_documenttypes (name, ext, mime, is_uploadable)
SELECT 'm4a', 'm4a', 'audio/mp4', 1
WHERE NOT EXISTS (SELECT 1 FROM glpi_documenttypes WHERE ext = 'm4a');

UPDATE glpi_documenttypes SET mime = 'audio/aac', name = 'aac', is_uploadable = 1 WHERE ext = 'aac';
INSERT INTO glpi_documenttypes (name, ext, mime, is_uploadable)
SELECT 'aac', 'aac', 'audio/aac', 1
WHERE NOT EXISTS (SELECT 1 FROM glpi_documenttypes WHERE ext = 'aac');

UPDATE glpi_documenttypes SET mime = 'audio/webm', name = 'webm', is_uploadable = 1 WHERE ext = 'webm';
INSERT INTO glpi_documenttypes (name, ext, mime, is_uploadable)
SELECT 'webm', 'webm', 'audio/webm', 1
WHERE NOT EXISTS (SELECT 1 FROM glpi_documenttypes WHERE ext = 'webm');

UPDATE glpi_documenttypes SET mime = 'video/mp4', name = 'mp4', is_uploadable = 1 WHERE ext = 'mp4';
INSERT INTO glpi_documenttypes (name, ext, mime, is_uploadable)
SELECT 'mp4', 'mp4', 'video/mp4', 1
WHERE NOT EXISTS (SELECT 1 FROM glpi_documenttypes WHERE ext = 'mp4');

UPDATE glpi_documenttypes SET mime = 'video/3gpp', name = '3gp', is_uploadable = 1 WHERE ext = '3gp';
INSERT INTO glpi_documenttypes (name, ext, mime, is_uploadable)
SELECT '3gp', '3gp', 'video/3gpp', 1
WHERE NOT EXISTS (SELECT 1 FROM glpi_documenttypes WHERE ext = '3gp');

SELECT ext, mime, is_uploadable
FROM glpi_documenttypes
WHERE ext IN ('ogg', 'oga', 'mp3', 'm4a', 'aac', 'webm', 'mp4', '3gp')
ORDER BY ext;

SELECT
  (SELECT COUNT(*) FROM glpi_documenttypes) AS source_count,
  (SELECT COUNT(*) FROM \`${BACKUP_TABLE}\`) AS backup_count;
SQL
}

SQL_CONTENT="$(generate_sql)"

if printf '%s' "$SQL_CONTENT" | grep -Eiq 'glpi_documents_items|(^|[^A-Z_])(DROP|DELETE|TRUNCATE)([^A-Z_]|$)'; then
  echo "Safety check failed: forbidden SQL token found." >&2
  exit 3
fi

if [ "$EXECUTE" -ne 1 ]; then
  printf '%s\n' "$SQL_CONTENT"
  printf '\nDRY-RUN: no SQL was executed. Add --execute after human approval.\n'
  exit 0
fi

if [ ! -f "$DEFAULTS_FILE" ]; then
  echo "--defaults-file not found. Keep credentials outside the repository." >&2
  exit 2
fi

if ! command -v mysql >/dev/null 2>&1; then
  echo "mysql client is required." >&2
  exit 2
fi

printf 'Type APPLY_DOCUMENTTYPES_%s to execute against database %s: ' "$BACKUP_SUFFIX" "$DATABASE" >&2
read -r CONFIRM
if [ "$CONFIRM" != "APPLY_DOCUMENTTYPES_${BACKUP_SUFFIX}" ]; then
  echo "Confirmation mismatch. Aborted." >&2
  exit 4
fi

printf '%s\n' "$SQL_CONTENT" | mysql --defaults-extra-file="$DEFAULTS_FILE" --database="$DATABASE"
