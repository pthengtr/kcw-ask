#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
NODE="${NODE_BIN:-$(command -v node || true)}"
if [[ -z "${NODE}" || ! -x "${NODE}" ]]; then
  NODE="/home/hqadmin/.local/share/cursor-agent/versions/2026.08.11-e8db854/node"
fi
cd "$ROOT"
exec "$NODE" "$ROOT/server.mjs"
