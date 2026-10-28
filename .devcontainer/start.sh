#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$PROJECT_ROOT/.devcontainer/.runtime"
mkdir -p "$RUNTIME_DIR"
cd "$PROJECT_ROOT/backend"
.venv/bin/alembic upgrade head
if ! .venv/bin/python -c 'import urllib.request; urllib.request.urlopen("http://127.0.0.1:43180/api/health", timeout=2)' >/dev/null 2>&1; then
  nohup .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 43180 >"$RUNTIME_DIR/api.log" 2>&1 </dev/null &
fi
for attempt in $(seq 1 30); do
  if .venv/bin/python -c 'import urllib.request; urllib.request.urlopen("http://127.0.0.1:43180/api/health", timeout=2)' >/dev/null 2>&1; then
    break
  fi
  if [ "$attempt" = 30 ]; then
    tail -40 "$RUNTIME_DIR/api.log"
    exit 1
  fi
  sleep 1
done
cd "$PROJECT_ROOT/frontend"
if ! curl --fail --silent http://127.0.0.1:43123/ >/dev/null; then
  nohup npm run dev -- --host 0.0.0.0 >"$RUNTIME_DIR/frontend.log" 2>&1 </dev/null &
fi
for attempt in $(seq 1 30); do
  if curl --fail --silent http://127.0.0.1:43123/ >/dev/null; then
    break
  fi
  if [ "$attempt" = 30 ]; then
    tail -40 "$RUNTIME_DIR/frontend.log"
    exit 1
  fi
  sleep 1
done
printf '%s\n' '知汇台已启动：打开 Ports 面板中的 43123 端口（保持 Private）。运行日志在 .devcontainer/.runtime/。'
