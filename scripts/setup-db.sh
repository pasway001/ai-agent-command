#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# setup-db.sh — Postgres setup helper for Mac mini
# ---------------------------------------------------------------------------
# 1. Checks that psql is available
# 2. Reads DATABASE_URL from .env in the project root
# 3. Parses user, password, host, port, and database name
# 4. Creates the role and database if they don't exist
# 5. Runs: pnpm drizzle-kit push
# ---------------------------------------------------------------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${PROJECT_ROOT}/.env"

# ---- 1. Check psql availability ------------------------------------------
if ! command -v psql &>/dev/null; then
  echo "[error] psql not found. Install PostgreSQL 16 with:"
  echo "  brew install postgresql@16"
  echo "  echo 'export PATH=\"/opt/homebrew/opt/postgresql@16/bin:\$PATH\"' >> ~/.zprofile"
  echo "  source ~/.zprofile"
  exit 1
fi
echo "[ok] psql found: $(psql --version)"

# ---- 2. Read DATABASE_URL from .env --------------------------------------
if [[ ! -f "${ENV_FILE}" ]]; then
  echo "[error] .env file not found at: ${ENV_FILE}"
  echo "  Copy .env.example to .env and fill in the values:"
  echo "  cp ${PROJECT_ROOT}/.env.example ${ENV_FILE}"
  exit 1
fi

# Extract the value, ignoring comment lines
DATABASE_URL="$(grep -E '^DATABASE_URL=' "${ENV_FILE}" | head -1 | cut -d'=' -f2-)"
if [[ -z "${DATABASE_URL}" ]]; then
  echo "[error] DATABASE_URL not found in ${ENV_FILE}"
  exit 1
fi
echo "[ok] DATABASE_URL found"

# ---- 3. Parse connection components --------------------------------------
# Expected format: postgresql://user:password@host:port/dbname
# or:              postgres://user:password@host:port/dbname
_stripped="${DATABASE_URL#postgresql://}"
_stripped="${_stripped#postgres://}"

_userinfo="${_stripped%%@*}"       # user:password
_hostpart="${_stripped#*@}"        # host:port/dbname

DB_USER="${_userinfo%%:*}"
DB_PASS="${_userinfo#*:}"

_hostport="${_hostpart%%/*}"
DB_NAME="${_hostpart#*/}"
DB_NAME="${DB_NAME%%\?*}"          # strip any query params

DB_HOST="${_hostport%%:*}"
DB_PORT="${_hostport##*:}"
# If host == port (no colon present), default port to 5432
if [[ "${DB_HOST}" == "${DB_PORT}" ]]; then
  DB_PORT="5432"
fi

echo "[info] Database : ${DB_NAME}"
echo "[info] User     : ${DB_USER}"
echo "[info] Host     : ${DB_HOST}:${DB_PORT}"

# ---- 4. Create role and database if they don't exist ---------------------
# We connect as the OS superuser (postgres or the current user).
# On a Homebrew install the superuser is typically the current macOS user.

_psql_admin() {
  psql -h "${DB_HOST}" -p "${DB_PORT}" -U "$(whoami)" -d postgres "$@" 2>/dev/null \
    || psql -h "${DB_HOST}" -p "${DB_PORT}" -U postgres -d postgres "$@"
}

# Create role
if _psql_admin -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_USER}'" | grep -q 1; then
  echo "[skip] Role '${DB_USER}' already exists"
else
  echo "[create] Creating role '${DB_USER}'..."
  createuser -h "${DB_HOST}" -p "${DB_PORT}" --no-superuser --createdb --no-createrole "${DB_USER}" \
    || _psql_admin -c "CREATE ROLE \"${DB_USER}\" WITH LOGIN CREATEDB NOSUPERUSER NOCREATEROLE;"
  # Set password
  _psql_admin -c "ALTER ROLE \"${DB_USER}\" WITH PASSWORD '${DB_PASS}';"
  echo "[ok] Role '${DB_USER}' created"
fi

# Create database
if _psql_admin -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'" | grep -q 1; then
  echo "[skip] Database '${DB_NAME}' already exists"
else
  echo "[create] Creating database '${DB_NAME}'..."
  createdb -h "${DB_HOST}" -p "${DB_PORT}" -O "${DB_USER}" "${DB_NAME}" \
    || _psql_admin -c "CREATE DATABASE \"${DB_NAME}\" OWNER \"${DB_USER}\";"
  echo "[ok] Database '${DB_NAME}' created"
fi

# ---- 5. Apply schema with drizzle-kit push -------------------------------
echo "[run] pnpm drizzle-kit push ..."
cd "${PROJECT_ROOT}"
pnpm drizzle-kit push

# ---- Done ----------------------------------------------------------------
echo ""
echo "Database setup complete."
echo "  Host     : ${DB_HOST}:${DB_PORT}"
echo "  Database : ${DB_NAME}"
echo "  User     : ${DB_USER}"
