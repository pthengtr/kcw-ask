#!/usr/bin/env python3
"""Read-only MCP bridge to local PARTS9 SQL tool (http://127.0.0.1:8091)."""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Literal

import httpx
from mcp.server.mcpserver import MCPServer

ENV_CANDIDATES = [
    Path(__file__).resolve().parent.parent / ".env",
    Path("/home/hqadmin/open-webui/sql-tool/.env"),
    Path("/home/hqadmin/open-webui/.env"),
]


def load_env() -> None:
    for path in ENV_CANDIDATES:
        if not path.exists():
            continue
        for line in path.read_text().splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


load_env()

BASE = os.getenv("SQL_TOOL_URL", "http://127.0.0.1:8091").rstrip("/")
TOKEN = os.getenv("SQL_TOOL_TOKEN", "")

mcp = MCPServer(
    name="parts9-sql",
    version="1.0.0",
    instructions=(
        "Read-only live PARTS9 SQL. Prefer query_hq (HQ/KSS) unless user asks for SYP. "
        "Only SELECT/WITH. Always cite source local:hq:PARTS9 or local:syp:PARTS9."
    ),
)


def _headers() -> dict[str, str]:
    h = {"Content-Type": "application/json"}
    if TOKEN:
        h["Authorization"] = f"Bearer {TOKEN}"
    return h


def _post(path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    with httpx.Client(timeout=45.0) as client:
        res = client.post(f"{BASE}{path}", headers=_headers(), json=body or {})
        try:
            data = res.json()
        except Exception:
            data = {"raw": res.text}
        if res.is_error:
            raise RuntimeError(json.dumps(data))
        return data if isinstance(data, dict) else {"data": data}


@mcp.tool()
def query_hq(sql: str, row_limit: int = 100) -> str:
    """Run a read-only SELECT/WITH on HQ PARTS9 (KSS). Prefer TOP N. Source: local:hq:PARTS9."""
    data = _post("/query_hq", {"sql": sql, "row_limit": row_limit})
    return json.dumps({"source": "local:hq:PARTS9", "tool": "query_hq", **data}, indent=2)


@mcp.tool()
def query_syp(sql: str, row_limit: int = 100) -> str:
    """Run a read-only SELECT/WITH on SYP PARTS9 (kss-pc). Prefer TOP N. Source: local:syp:PARTS9."""
    data = _post("/query_syp", {"sql": sql, "row_limit": row_limit})
    return json.dumps({"source": "local:syp:PARTS9", "tool": "query_syp", **data}, indent=2)


@mcp.tool()
def list_tables(site: Literal["hq", "syp"] = "hq", row_limit: int = 200) -> str:
    """List dbo user tables on hq or syp PARTS9 for schema discovery."""
    with httpx.Client(timeout=45.0) as client:
        res = client.post(
            f"{BASE}/list_tables",
            headers=_headers(),
            params={"site": site, "row_limit": row_limit},
            json={},
        )
        data = res.json()
        if res.is_error:
            raise RuntimeError(json.dumps(data))
    return json.dumps(
        {"source": f"local:{site}:PARTS9", "tool": "list_tables", **data},
        indent=2,
    )


def main() -> None:
    transport = os.getenv("MCP_TRANSPORT", "stdio").strip().lower()
    if transport == "stdio":
        mcp.run()
        return
    if transport == "streamable-http":
        host = os.getenv("MCP_HOST", "127.0.0.1")
        port = int(os.getenv("MCP_PORT", "8092"))
        mcp.run(
            transport="streamable-http",
            host=host,
            port=port,
            streamable_http_path="/mcp",
            stateless_http=True,
        )
        return
    raise SystemExit(f"Unsupported MCP_TRANSPORT={transport!r} (use stdio or streamable-http)")


if __name__ == "__main__":
    main()
