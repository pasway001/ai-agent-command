#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load .env from project root if it exists
ENV_FILE="$PROJECT_ROOT/.env"
if [ -f "$ENV_FILE" ]; then
  set -o allexport
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +o allexport
fi

# Validate CRON_SECRET
if [ -z "${CRON_SECRET:-}" ]; then
  echo "ERROR: CRON_SECRET is not set. Please define it in .env or the environment." >&2
  exit 1
fi

# Determine APP_URL
APP_URL="${NEXT_PUBLIC_APP_URL:-http://localhost:3000}"

# Ensure logs directory exists
LOG_DIR="$PROJECT_ROOT/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/cron.log"

TIMESTAMP="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

echo "[$TIMESTAMP] Calling $APP_URL/api/cron/scout ..." | tee -a "$LOG_FILE"

RESPONSE="$(curl -s -X GET "$APP_URL/api/cron/scout" \
  -H "Authorization: Bearer $CRON_SECRET" \
  --max-time 310)"
CURL_EXIT=$?

echo "[$TIMESTAMP] Response: $RESPONSE" | tee -a "$LOG_FILE"

if [ $CURL_EXIT -ne 0 ]; then
  echo "[$TIMESTAMP] ERROR: curl exited with code $CURL_EXIT" | tee -a "$LOG_FILE"
fi

exit $CURL_EXIT
