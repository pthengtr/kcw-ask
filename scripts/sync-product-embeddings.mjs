#!/usr/bin/env node
/**
 * Nightly ICMAS product embedding sync.
 *
 * Env:
 *   SQL_TOOL_URL, SQL_TOOL_TOKEN
 *   EMBED_LLM_BASE_URL, EMBED_LLM_MODEL, EMBED_LLM_API_KEY
 *   PRODUCT_EMBED_BATCH (default 500), PRODUCT_EMBED_INDEX (output path)
 *
 * Usage: node scripts/sync-product-embeddings.mjs [--site hq|syp] [--limit N]
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { embedText, INDEX_PATH } from "../lib/embed.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!(k in process.env)) process.env[k] = v;
  }
}

loadEnvFile(join(ROOT, ".env"));
loadEnvFile("/home/hqadmin/projects/kcw-api/.env");
const SQL_URL = (process.env.SQL_TOOL_URL || "http://127.0.0.1:8091").replace(/\/$/, "");
const SQL_TOKEN = process.env.SQL_TOOL_TOKEN || "";
const BATCH = Number(process.env.PRODUCT_EMBED_BATCH || 500);

function parseArgs() {
  const args = process.argv.slice(2);
  let site = "hq";
  let limit = BATCH;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--site" && args[i + 1]) site = args[++i];
    if (args[i] === "--limit" && args[i + 1]) limit = Number(args[++i]);
  }
  return { site, limit };
}

function buildEmbedText(row) {
  return [row.DESCR, row.BRAND, row.MODEL, row.PCODE, row.MCODE]
    .map((v) => String(v ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

async function sqlFetch(path, sql, rowLimit) {
  const res = await fetch(`${SQL_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(SQL_TOKEN ? { Authorization: `Bearer ${SQL_TOKEN}` } : {}),
    },
    body: JSON.stringify({ sql, row_limit: rowLimit }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(data));
  return data;
}

async function main() {
  if (!process.env.EMBED_LLM_BASE_URL) {
    console.error("EMBED_LLM_BASE_URL not set — configure .env");
    process.exit(1);
  }
  if (!process.env.EMBED_LLM_API_KEY && !process.env.OPENAI_API_KEY) {
    console.error("Set OPENAI_API_KEY (kcw-api/.env) or EMBED_LLM_API_KEY");
    process.exit(1);
  }

  const { site, limit } = parseArgs();
  const path = site === "syp" ? "/query_syp" : "/query_hq";
  const sql = `SELECT TOP ${limit} BCODE, DESCR, MODEL, BRAND, PCODE, MCODE, CODE1
FROM dbo.ICMAS WITH (NOLOCK)
WHERE CANCELED = 'N'
ORDER BY BCODE`;

  console.log(`Fetching ${limit} products from ${site.toUpperCase()}…`);
  const data = await sqlFetch(path, sql, limit);
  const rows = data.rows || [];
  const items = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const text = buildEmbedText(row);
    if (!text) continue;
    process.stdout.write(`\rEmbedding ${i + 1}/${rows.length} ${row.BCODE}…`);
    const embedding = await embedText(text);
    if (embedding) {
      items.push({ bcode: row.BCODE, text, embedding });
    }
  }
  console.log(`\nWrote ${items.length} embeddings`);

  const out = {
    site,
    model: process.env.EMBED_LLM_MODEL || "bge-m3",
    updated_at: new Date().toISOString(),
    count: items.length,
    items,
  };

  const outPath = process.env.PRODUCT_EMBED_INDEX || INDEX_PATH;
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(out));
  console.log(`Index: ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
