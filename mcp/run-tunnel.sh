#!/usr/bin/env bash
set -euo pipefail

TUNNEL_CLIENT="${TUNNEL_CLIENT:-/home/hqadmin/.local/bin/tunnel-client}"
PROFILE="${TUNNEL_PROFILE:-parts9-chatgpt}"
ENV_FILE="/home/hqadmin/projects/ask-chat/mcp/tunnel.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE — copy tunnel.env.example and fill in CONTROL_PLANE_API_KEY + TUNNEL_ID" >&2
  exit 1
fi

# shellcheck source=/dev/null
source "$ENV_FILE"

: "${CONTROL_PLANE_API_KEY:?Set CONTROL_PLANE_API_KEY in tunnel.env}"
: "${TUNNEL_ID:?Set TUNNEL_ID in tunnel.env}"
MCP_SERVER_URL="${MCP_SERVER_URL:-http://127.0.0.1:8092/mcp}"

export CONTROL_PLANE_API_KEY

if ! "$TUNNEL_CLIENT" doctor --profile "$PROFILE" --explain 2>/dev/null; then
  "$TUNNEL_CLIENT" init \
    --sample sample_mcp_with_dcr \
    --profile "$PROFILE" \
    --tunnel-id "$TUNNEL_ID" \
    --mcp-server-url "$MCP_SERVER_URL"
  "$TUNNEL_CLIENT" doctor --profile "$PROFILE" --explain
fi

exec "$TUNNEL_CLIENT" run --profile "$PROFILE"
