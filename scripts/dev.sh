#!/usr/bin/env bash
#
# DevDigest local bootstrap — bring the whole stack up from zero.
#
#   ./scripts/dev.sh              # full: docker → migrate → seed → server + client
#   ./scripts/dev.sh --no-seed    # skip the demo seed
#   ./scripts/dev.sh --no-client  # run only Postgres + API (no Next.js)
#   ./scripts/dev.sh --db-only    # just Postgres + migrate + seed, then exit
#   ./scripts/dev.sh --free-ports # kill a leftover dev server holding :3000/:3001
#
# Idempotent: re-running installs only what's missing, migrations and seed
# both upsert. Ctrl-C stops the dev servers and leaves Postgres running.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CONTAINER="devdigest-postgres"
RUN_SEED=1
RUN_CLIENT=1
DB_ONLY=0
FREE_PORTS="${FREE_PORTS:-0}"
API_PORT="${API_PORT:-3001}"
WEB_PORT="${WEB_PORT:-3000}"

for arg in "$@"; do
  case "$arg" in
    --no-seed)    RUN_SEED=0 ;;
    --no-client)  RUN_CLIENT=0 ;;
    --db-only)    DB_ONLY=1 ;;
    --free-ports) FREE_PORTS=1 ;;
    -h|--help)   sed -n '2,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

log()  { printf '\033[1;36m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m! %s\033[0m\n' "$*"; }

# --- prerequisites -----------------------------------------------------------
command -v docker >/dev/null || { echo "docker not found"; exit 1; }
command -v pnpm   >/dev/null || { echo "pnpm not found (npm i -g pnpm)"; exit 1; }

# --- git hooks ---------------------------------------------------------------
# The pr-self-review gate's git half (.githooks/pre-push). Idempotent; see AGENTS.md.
if [ "$(git config --get core.hooksPath || true)" != ".githooks" ]; then
  git config core.hooksPath .githooks
  log "enabled .githooks (pr-self-review pre-push gate)"
fi

# --- env files ---------------------------------------------------------------
for dir in server client; do
  if [ ! -f "$dir/.env" ] && [ -f "$dir/.env.example" ]; then
    cp "$dir/.env.example" "$dir/.env"
    warn "created $dir/.env from .env.example — add your API keys (OPENAI/ANTHROPIC/GITHUB_TOKEN) in server/.env"
  fi
done

# --- Postgres ----------------------------------------------------------------
# The container name is fixed (container_name: devdigest-postgres), so if one is
# already running (possibly under another compose project) we reuse it instead
# of failing on a name conflict. If it exists but is stopped, start it; else
# create it via compose.
state="$(docker inspect -f '{{.State.Status}}' "$CONTAINER" 2>/dev/null || echo "missing")"
case "$state" in
  running) log "Postgres container already running — reusing it" ;;
  exited|created) log "starting existing Postgres container"; docker start "$CONTAINER" >/dev/null ;;
  *)       log "starting Postgres (docker compose up -d)"; docker compose up -d ;;
esac

log "waiting for Postgres to be healthy"
for _ in $(seq 1 60); do
  status="$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo "starting")"
  [ "$status" = "healthy" ] && break
  sleep 1
done
[ "${status:-}" = "healthy" ] || { echo "Postgres did not become healthy in time"; exit 1; }
log "Postgres healthy"

# --- install deps (only if missing) ------------------------------------------
install_if_needed() {
  if [ ! -d "$1/node_modules" ]; then
    log "installing deps in $1"
    (cd "$1" && pnpm install)
  fi
}
install_if_needed server
[ "$DB_ONLY" -eq 0 ] && [ "$RUN_CLIENT" -eq 1 ] && install_if_needed client
# reviewer-core's RAW source is imported by the API at runtime (tsconfig alias);
# without its deps the API crashes at boot with ERR_MODULE_NOT_FOUND. It uses npm.
[ -d reviewer-core/node_modules ] || { log "installing deps in reviewer-core"; (cd reviewer-core && npm ci); }

# --- migrate + seed ----------------------------------------------------------
log "applying migrations"
(cd server && pnpm db:migrate)

if [ "$RUN_SEED" -eq 1 ]; then
  log "seeding demo data"
  (cd server && pnpm db:seed)
fi

if [ "$DB_ONLY" -eq 1 ]; then
  log "DB ready. Postgres is running; server/client not started (--db-only)."
  exit 0
fi

# --- port guard --------------------------------------------------------------
# Without this the failure is silent and confusing: the API cannot bind and dies,
# while `next dev` quietly moves to the next free port — so the web app ends up
# on the port the API was supposed to own. A leftover dev server is the usual
# occupant (a killed terminal on Windows orphans the whole `cmd → next dev →
# start-server` tree, which keeps the socket). We only report it: never kill a
# process this script did not start — it may be the user's other terminal.

# `/dev/tcp` is a bash builtin, so this needs no lsof (Git Bash ships none).
port_busy() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null && exec 3<&- 3>&- && return 0
  return 1
}

# Best-effort PID for the message only — must never fail the script.
port_owner() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti "tcp:$1" -s TCP:LISTEN 2>/dev/null | head -1
  elif command -v netstat >/dev/null 2>&1; then
    netstat -ano 2>/dev/null | awk -v p=":$1" '$0 ~ /LISTEN/ && $2 ~ p"$" { print $NF; exit }'
  fi
}

is_windows() {
  case "$(uname -s 2>/dev/null || echo unknown)" in
    MINGW*|MSYS*|CYGWIN*) return 0 ;;
    *) return 1 ;;
  esac
}

# Opt-in only (--free-ports). Kills the *chain* that holds the port, not just
# the listener: on Windows the leaf node is wrapped in cmd.exe/pnpm and killing
# the leaf leaves the wrappers behind. free-port.ps1 walks up to the topmost
# wrapper and stops before the terminal that launched it.
free_port() {
  local port="$1"
  log "reclaiming port $port (--free-ports)"
  if is_windows; then
    local ps1; ps1="$(cygpath -w "$ROOT/scripts/free-port.ps1")"
    MSYS2_ARG_CONV_EXCL='*' powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$ps1" -Port "$port"
  else
    local pid; pid="$(port_owner "$port" || true)"
    [ -n "$pid" ] || { warn "could not resolve the owner of :$port"; return 1; }
    pkill -TERM -P "$pid" 2>/dev/null || true
    kill -TERM "$pid" 2>/dev/null || true
    for _ in $(seq 1 20); do port_busy "$port" || return 0; sleep 0.25; done
    kill -KILL "$pid" 2>/dev/null || true
    for _ in $(seq 1 8); do port_busy "$port" || return 0; sleep 0.25; done
    warn "port $port is still held after SIGKILL"
    return 1
  fi
}

check_port() {
  port_busy "$1" || return 0

  if [ "$FREE_PORTS" -eq 1 ]; then
    free_port "$1" && ! port_busy "$1" && return 0
    warn "could not free port $1 — stop the process by hand and re-run"
    exit 1
  fi

  local pid; pid="$(port_owner "$1" || true)"
  warn "port $1 is already in use — $2 cannot start"
  if [ -n "$pid" ]; then
    warn "  held by PID $pid — stop it (Ctrl-C in its terminal, or: kill $pid)"
  else
    warn "  stop whatever is listening on :$1"
  fi
  warn "  a leftover dev server? re-run with: ./scripts/dev.sh --free-ports"
  exit 1
}

check_port "$API_PORT" "the API"
[ "$RUN_CLIENT" -eq 1 ] && check_port "$WEB_PORT" "the web app"

# --- dev servers -------------------------------------------------------------
SERVER_PID=""
cleanup() {
  log "shutting down dev servers (Postgres stays up; stop it with: docker compose down)"
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

log "starting API on :$API_PORT (server)"
(cd server && pnpm dev) &
SERVER_PID=$!

if [ "$RUN_CLIENT" -eq 1 ]; then
  log "starting web on :$WEB_PORT (client) — Ctrl-C to stop both"
  (cd client && pnpm dev)
else
  log "API running (PID $SERVER_PID) — Ctrl-C to stop"
  wait "$SERVER_PID"
fi
