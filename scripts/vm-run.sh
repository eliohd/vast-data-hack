#!/usr/bin/env bash
# Runs on the lab VM. (Re)starts the API on :8000 in a detached tmux session (or nohup if tmux
# is missing). The Cloudflare tunnel for hack.elio.ltd points at http://localhost:8000.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8000}"
LOG=/tmp/hack-server.log

if ! command -v uv >/dev/null 2>&1; then
  echo "→ installing uv (user-local, no sudo)"
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi

cd "${ROOT}/server"
# VastDB SDK is optional; fall back to core deps if its wheels are unavailable here.
uv sync --frozen --extra vast >/dev/null 2>&1 || uv sync --frozen >/dev/null

CMD="cd ${ROOT}/server && uv run uvicorn app.main:app --host 127.0.0.1 --port ${PORT} --proxy-headers --forwarded-allow-ips='*' 2>&1 | tee ${LOG}"

if command -v tmux >/dev/null 2>&1; then
  tmux kill-session -t hack 2>/dev/null || true
  tmux new-session -d -s hack "export PATH=\$HOME/.local/bin:\$PATH; ${CMD}"
  echo "✓ server running in tmux session 'hack' (tmux attach -t hack) — log: ${LOG}"
else
  pkill -f "uvicorn app.main:app" 2>/dev/null || true
  nohup bash -c "${CMD}" >/dev/null 2>&1 &
  echo "✓ server running with nohup — log: ${LOG}"
fi

sleep 2
curl -fsS "http://127.0.0.1:${PORT}/api/health" && echo
