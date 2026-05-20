#!/usr/bin/env sh
set -eu

usage() {
  cat <<'USAGE'
Usage:
  create_mysql_defaults_from_glpi_config.sh --config <path/to/config_db.php> --output <path/to/mysql-defaults.cnf> [--execute]

Purpose:
  Create a MySQL/MariaDB client defaults file from GLPI config_db.php for
  manual operations. Dry-run is the default and never writes files.

Required:
  --config   Existing GLPI config_db.php path.
  --output   Output path for the mysql defaults file. Must be outside repo.

Options:
  --execute  Write the file after human confirmation.
  --help     Show this help.

Safety:
  - Prints DB_HOST, DB_NAME, and DB_USER only.
  - Never prints DB password.
  - Blocks output paths inside the repository.
  - Writes the output with permission 0600.
USAGE
}

CONFIG_FILE=""
OUTPUT_FILE=""
EXECUTE=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --config)
      CONFIG_FILE="${2:-}"
      shift 2
      ;;
    --output)
      OUTPUT_FILE="${2:-}"
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

if [ -z "$CONFIG_FILE" ] || [ -z "$OUTPUT_FILE" ]; then
  echo "Missing required arguments." >&2
  usage >&2
  exit 2
fi

if [ ! -f "$CONFIG_FILE" ]; then
  echo "--config must point to an existing config_db.php file." >&2
  exit 2
fi

case "$(basename "$CONFIG_FILE")" in
  config_db.php) ;;
  *) echo "--config must point to a file named config_db.php." >&2; exit 2 ;;
esac

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd -P)
OUTPUT_DIR=$(dirname -- "$OUTPUT_FILE")
OUTPUT_BASE=$(basename -- "$OUTPUT_FILE")

if [ ! -d "$OUTPUT_DIR" ]; then
  echo "--output directory does not exist: $OUTPUT_DIR" >&2
  exit 2
fi

OUTPUT_ABS=$(CDPATH= cd -- "$OUTPUT_DIR" && pwd -P)/"$OUTPUT_BASE"
case "$OUTPUT_ABS" in
  "$REPO_ROOT"|"$REPO_ROOT"/*)
    echo "--output must be outside the repository: $REPO_ROOT" >&2
    exit 2
    ;;
esac

extract_define() {
  key="$1"
  sed -n "s/^[[:space:]]*define([[:space:]]*['\"]${key}['\"][[:space:]]*,[[:space:]]*['\"]\\([^'\"]*\\)['\"][[:space:]]*)[[:space:]]*;.*/\\1/p" "$CONFIG_FILE" | head -n 1
}

extract_property() {
  key="$1"
  sed -n "s/^[[:space:]]*public[[:space:]]*\\\$${key}[[:space:]]*=[[:space:]]*['\"]\\([^'\"]*\\)['\"][[:space:]]*;.*/\\1/p" "$CONFIG_FILE" | head -n 1
}

DB_HOST=$(extract_define DB_HOST)
DB_NAME=$(extract_define DB_NAME)
DB_USER=$(extract_define DB_USER)
DB_PASSWORD=$(extract_define DB_PASSWORD)

if [ -z "$DB_HOST" ]; then DB_HOST=$(extract_property dbhost); fi
if [ -z "$DB_NAME" ]; then DB_NAME=$(extract_property dbdefault); fi
if [ -z "$DB_USER" ]; then DB_USER=$(extract_property dbuser); fi
if [ -z "$DB_PASSWORD" ]; then DB_PASSWORD=$(extract_property dbpassword); fi

if [ -z "$DB_HOST" ] || [ -z "$DB_NAME" ] || [ -z "$DB_USER" ] || [ -z "$DB_PASSWORD" ]; then
  echo "Could not extract DB_HOST, DB_NAME, DB_USER, and DB_PASSWORD from config_db.php." >&2
  exit 2
fi

cat <<INFO
Detected GLPI database config:
  DB_HOST=$DB_HOST
  DB_NAME=$DB_NAME
  DB_USER=$DB_USER
  DB_PASSWORD=hidden
  OUTPUT=$OUTPUT_ABS
INFO

if [ "$EXECUTE" -ne 1 ]; then
  printf '\nDRY-RUN: no file was written. Add --execute after human approval.\n'
  exit 0
fi

if [ -e "$OUTPUT_ABS" ]; then
  echo "Output file already exists. Move it aside manually before recreating it." >&2
  exit 2
fi

printf 'Type CREATE_MYSQL_DEFAULTS_%s to write %s: ' "$DB_NAME" "$OUTPUT_ABS" >&2
read -r CONFIRM
if [ "$CONFIRM" != "CREATE_MYSQL_DEFAULTS_${DB_NAME}" ]; then
  echo "Confirmation mismatch. Aborted." >&2
  exit 4
fi

TMP_FILE="${OUTPUT_ABS}.tmp.$$"
umask 077
{
  printf '[client]\n'
  printf 'host=%s\n' "$DB_HOST"
  printf 'user=%s\n' "$DB_USER"
  printf 'password=%s\n' "$DB_PASSWORD"
  printf 'database=%s\n' "$DB_NAME"
} > "$TMP_FILE"
chmod 600 "$TMP_FILE"
mv "$TMP_FILE" "$OUTPUT_ABS"
chmod 600 "$OUTPUT_ABS"
printf 'Created mysql defaults file with permission 0600: %s\n' "$OUTPUT_ABS"
