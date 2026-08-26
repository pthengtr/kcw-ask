# PARTS9 MCP for ChatGPT (hq-ubuntu-server)

Expose read-only HQ/SYP PARTS9 SQL to ChatGPT via **OpenAI Secure MCP Tunnel**. No public inbound ports.

## Prerequisites

- **ChatGPT Plus** (or higher) with **Developer mode** enabled
- OpenAI Platform account with **Tunnels Read + Manage** (create) and **Use** (run client)
- SQL tool running on this box (`owui-sql-tool.service`, port 8091)

## Architecture

```
ChatGPT → OpenAI tunnel endpoint → tunnel-client (this box) → MCP :8092/mcp → SQL tool :8091 → PARTS9
```

Tools exposed:

| Tool | Description |
|------|-------------|
| `query_hq` | Read-only SELECT on HQ/KSS PARTS9 |
| `query_syp` | Read-only SELECT on SYP/kss-pc PARTS9 |
| `list_tables` | Schema discovery for hq or syp |

Cursor on this box still uses stdio MCP (`ask-chat/.cursor/mcp.json`) — unchanged.

## One-time setup

### 1. Start the local MCP HTTP server

```bash
systemctl --user daemon-reload
systemctl --user enable --now parts9-mcp.service
systemctl --user status parts9-mcp.service
```

Verify:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"smoke","version":"1.0"}}}' \
  http://127.0.0.1:8092/mcp
```

Expect HTTP 200.

### 2. Create OpenAI tunnel

1. Open [Platform tunnel settings](https://platform.openai.com/settings/organization/tunnels) (or search “tunnels” in Platform).
2. Create a tunnel; associate it with your **ChatGPT workspace** (not only the Platform org).
3. Copy `tunnel_id` and create a **runtime API key** for `tunnel-client`.

### 3. Configure tunnel client on this box

```bash
cp /home/hqadmin/projects/ask-chat/mcp/tunnel.env.example \
   /home/hqadmin/projects/ask-chat/mcp/tunnel.env
chmod 600 /home/hqadmin/projects/ask-chat/mcp/tunnel.env
# Edit: CONTROL_PLANE_API_KEY, TUNNEL_ID
```

Start tunnel:

```bash
systemctl --user enable --now parts9-mcp-tunnel.service
systemctl --user status parts9-mcp-tunnel.service
/home/hqadmin/.local/bin/tunnel-client doctor --profile parts9-chatgpt --explain
```

### 4. Connect ChatGPT

1. ChatGPT web → **Settings → Security and login** → turn on **Developer mode**.
2. Go to **Plugins** (chatgpt.com/plugins) → **+** → create developer-mode app.
3. **Connection type: Tunnel** → select your tunnel (or paste `tunnel_id`).
4. Enable tools: `query_hq`, `query_syp`, `list_tables`.
5. In a new chat: **+ → More → Developer mode** → turn on your app.
6. Test: *“Latest 5 HQ sales bills from PARTS9”* — answer should cite `local:hq:PARTS9`.

## Services

| Unit | Role |
|------|------|
| `owui-sql-tool.service` | SQL tool `:8091` (existing) |
| `parts9-mcp.service` | MCP streamable-http `127.0.0.1:8092/mcp` |
| `parts9-mcp-tunnel.service` | OpenAI `tunnel-client` (needs `tunnel.env`) |

```bash
systemctl --user restart parts9-mcp.service
systemctl --user restart parts9-mcp-tunnel.service   # after tunnel.env is filled
journalctl --user -u parts9-mcp.service -f
journalctl --user -u parts9-mcp-tunnel.service -f
```

## Files

| Path | Purpose |
|------|---------|
| `mcp/sql_server.py` | MCP server (stdio default; HTTP when `MCP_TRANSPORT=streamable-http`) |
| `mcp/mcp.env` | MCP bind settings (from `mcp.env.example`) |
| `mcp/tunnel.env` | OpenAI tunnel secrets (from `tunnel.env.example`, **not in git**) |
| `mcp/run-tunnel.sh` | Init profile + run `tunnel-client` |
| `~/.local/bin/tunnel-client` | OpenAI tunnel client binary |

## Security

- MCP listens on **127.0.0.1 only** — not reachable from Tailscale or LAN directly.
- SQL tool enforces SELECT-only queries.
- Treat ChatGPT connector access as **full read** of PARTS9 data available to the SQL credentials.
- Rotate `SQL_TOOL_TOKEN` and tunnel API key if compromised.

## Troubleshooting

| Symptom | Check |
|---------|--------|
| MCP won't start | `journalctl --user -u parts9-mcp`; ensure `:8091` is up |
| Tunnel service inactive | `tunnel.env` missing or empty — fill secrets first |
| Tunnel not in ChatGPT | Tunnel must be linked to your ChatGPT workspace |
| `query_syp` fails | kss-pc may be offline on Tailscale |
| Cursor still works? | Yes — stdio config in `.cursor/mcp.json` is independent |
