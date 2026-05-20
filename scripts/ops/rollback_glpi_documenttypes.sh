#!/usr/bin/env sh
set -eu

usage() {
  cat <<'USAGE'
Usage:
  rollback_glpi_documenttypes.sh --defaults-file <mysql-client-cnf> --database <glpi-db> --backup-table <glpi_documenttypes_backup_YYYYMMDDHHMMSS> --archive-suffix <YYYYMMDDHHMMSS> [--execute]

Purpose:
  Roll back glpi_documenttypes using a backup table created in the same
  production database by apply_glpi_documenttypes.sh.

Default behavior:
  Dry-run. The generated SQL is printed and no database connection is made.

Safety:
  - Does not touch glpi_documents_items.
  - Does not run DROP, DELETE, or TRUNCATE.
  - Uses RENAME TABLE only after explicit human confirmation.
USAGE
}

DEFAULTS_FILE=""
DATABASE=""
BACKUP_TABLE=""
ARCHIVE_SUFFIX=""
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
    --backup-table)
      BACKUP_TABLE="${2:-}"
      shift 2
      ;;
    --archive-suffix)
      ARCHIVE_SUFFIX="${2:-}"
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

if [ -z "$DEFAULTS_FILE" ] || [ -z "$DATABASE" ] || [ -z "$BACKUP_TABLE" ] || [ -z "$ARCHIVE_SUFFIX" ]; then
  echo "Missing required arguments." >&2
  usage >&2
  exit 2
fi

case "$DATABASE" in
  *'<'*|*'>'*) echo "--database must be a real schema name, not a placeholder with < or >." >&2; exit 2 ;;
  *[!A-Za-z0-9_]*|'') echo "--database must contain only letters, numbers, and underscore." >&2; exit 2 ;;
esac

case "$BACKUP_TABLE" in
  glpi_documenttypes_backup_[0-9]*)
    suffix=${BACKUP_TABLE#glpi_documenttypes_backup_}
    case "$suffix" in
      *[!0-9]*|'') echo "--backup-table must match glpi_documenttypes_backup_<digits>." >&2; exit 2 ;;
    esac
    ;;
  *) echo "--backup-table must match glpi_documenttypes_backup_<timestamp>." >&2; exit 2 ;;
esac

case "$ARCHIVE_SUFFIX" in
  *[!0-9]*|'') echo "--archive-suffix must be numeric, e.g. YYYYMMDDHHMMSS." >&2; exit 2 ;;
esac

ARCHIVE_TABLE="glpi_documenttypes_after_reconciliation_${ARCHIVE_SUFFIX}"

SQL_CONTENT=$(cat <<SQL
-- IntegraGLPI manual rollback for glpi_documenttypes.
-- Manual only. Review before executing.
USE \`${DATABASE}\`;

SELECT COUNT(*) AS current_count FROM glpi_documenttypes;
SELECT COUNT(*) AS backup_count FROM \`${BACKUP_TABLE}\`;

RENAME TABLE glpi_documenttypes TO \`${ARCHIVE_TABLE}\`;
RENAME TABLE \`${BACKUP_TABLE}\` TO glpi_documenttypes;

SELECT COUNT(*) AS restored_count FROM glpi_documenttypes;
SQL
)

validate_defaults_file() {
  if [ ! -f "$DEFAULTS_FILE" ]; then
    echo "--defaults-file not found. Keep credentials outside the repository." >&2
    exit 2
  fi

  perms=""
  if command -v stat >/dev/null 2>&1; then
    perms=$(stat -c '%a' "$DEFAULTS_FILE" 2>/dev/null || stat -f '%Lp' "$DEFAULTS_FILE" 2>/dev/null || true)
  fi

  case "$perms" in
    600|400) ;;
    "")
      echo "Warning: could not determine --defaults-file permissions. Verify it is 0600." >&2
      ;;
    *)
      echo "--defaults-file permissions must be 0600 or 0400; current mode is $perms." >&2
      exit 2
      ;;
  esac
}

if printf '%s' "$SQL_CONTENT" | grep -Eiq 'glpi_documents_items|(^|[^A-Z_])(DROP|DELETE|TRUNCATE)([^A-Z_]|$)'; then
  echo "Safety check failed: forbidden SQL token found." >&2
  exit 3
fi

if [ "$EXECUTE" -ne 1 ]; then
  printf '%s\n' "$SQL_CONTENT"
  printf '\nDRY-RUN: no SQL was executed. Add --execute after human approval.\n'
  exit 0
fi

validate_defaults_file

if ! command -v mysql >/dev/null 2>&1; then
  echo "mysql client is required." >&2
  exit 2
fi

printf 'Type ROLLBACK_DOCUMENTTYPES_%s to execute against database %s: ' "$ARCHIVE_SUFFIX" "$DATABASE" >&2
read -r CONFIRM
if [ "$CONFIRM" != "ROLLBACK_DOCUMENTTYPES_${ARCHIVE_SUFFIX}" ]; then
  echo "Confirmation mismatch. Aborted." >&2
  exit 4
fi

printf '%s\n' "$SQL_CONTENT" | mysql --defaults-extra-file="$DEFAULTS_FILE" --database="$DATABASE"
