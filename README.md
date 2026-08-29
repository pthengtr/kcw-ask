# KCW Ask

**Proof-of-concept** — read-only PARTS9 search and analyst chat for the HQ Linux box.

> Direction is not settled (standalone repo vs part of [kcw-api](https://github.com/pthengtr/kcw-api)). Treat everything here as experimental.

## What it is

Sibling **HQ service** to kcw-api (worker, Tiger Pay, stock-check, etc.) but a **separate codebase**: Node UI + `cursor-agent` ask mode, not FastAPI/uvicorn.

| Piece | Detail |
|-------|--------|
| Web UI | `http://<host>:3000` — **search** (intent slots → ICMAS SQL) and **ask** (cursor-agent) |
| Search docs | [`docs/search.md`](docs/search.md) — ACODE short names, sizes, oil queries, config |
| Agent rules | `ASK.md` |
| SQL | Local read-only tool on `:8091` (`owui-sql-tool`) |
| Docs | Symlink `kcw-docs` → `~/projects/kcw-docs` |

## HQ deployment

Canonical runbook: [kcw-docs/ops/hq-linux.md — KCW Ask POC](https://github.com/pthengtr/kcw-docs/blob/main/ops/hq-linux.md#kcw-ask-poc).

```bash
# UI
systemctl --user enable --now kcw-ask.service

# Optional: PARTS9 MCP for Cursor / ChatGPT
systemctl --user enable --now parts9-mcp.service
# ChatGPT tunnel — see mcp/CHATGPT.md
```

Unit templates: `deploy/systemd/`. Copy to `~/.config/systemd/user/` and `daemon-reload`.

## MCP (optional)

- **Cursor (stdio):** `.cursor/mcp.json` → `mcp/sql_server.py`
- **HTTP localhost:** `parts9-mcp.service` on `:8092/mcp`
- **ChatGPT:** `parts9-mcp-tunnel.service` + OpenAI Secure MCP Tunnel — see `mcp/CHATGPT.md`

Tools: `query_hq`, `query_syp`, `list_tables` (read-only SELECT).

## Setup (dev)

```bash
cd ~/projects/ask-chat
python3 -m venv .venv && .venv/bin/pip install -r mcp/requirements.txt
cp mcp/mcp.env.example mcp/mcp.env   # optional
./start.sh                             # or: node server.mjs
```

Env: project `.env` and/or `open-webui/sql-tool/.env` for `SQL_TOOL_TOKEN`, OpenAI keys, slot LLM URL.

## POC open questions

- Merge into kcw-api or keep this repo?
- Overlap with Open WebUI / existing search UIs?
- Auth in front of `:3000` for shop LAN?
- Which modes ship if any?

Update [hq-linux.md](https://github.com/pthengtr/kcw-docs/blob/main/ops/hq-linux.md) when decisions are made.
