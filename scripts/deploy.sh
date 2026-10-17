#!/usr/bin/env bash
# Ships the repo (with a fresh web/dist) to the lab VM and restarts the server there.
# The VM has no Node, so the web build happens here; the VM only runs Python.
set -euo pipefail

VM="${VM:?set VM to your lab SSH alias, e.g. VM=bc-elio}"
VM_DIR="${VM_DIR:-hack}"  # relative to the remote home; never a laptop-expanded ~
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "→ syncing to ${VM}:${VM_DIR}"
rsync -az --delete \
  --exclude '.git' --exclude 'node_modules' --exclude '.astro' \
  --exclude '.venv' --exclude '__pycache__' --exclude '.pytest_cache' --exclude '.ruff_cache' \
  --exclude 'server/data' --exclude 'server/.env' \
  "${ROOT}/" "${VM}:${VM_DIR}/"

echo "→ restarting server on ${VM}"
ssh "${VM}" "cd ${VM_DIR} && ./scripts/vm-run.sh"
