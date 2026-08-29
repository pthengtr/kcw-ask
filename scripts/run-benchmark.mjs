#!/usr/bin/env node
/**
 * Run benchmark-queries.json against local kcw-ask search API.
 * Usage: node scripts/run-benchmark.mjs [--base http://127.0.0.1:3000]
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = process.argv.includes("--base")
  ? process.argv[process.argv.indexOf("--base") + 1]
  : "http://127.0.0.1:3000";

const queries = JSON.parse(readFileSync(join(ROOT, "scripts/benchmark-queries.json"), "utf8"));

async function runOne(query) {
  const start = await fetch(`${base}/api/chat/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: query, mode: "search" }),
  });
  const { jobId } = await start.json();
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    const poll = await fetch(`${base}/api/chat/job/${jobId}`);
    const data = await poll.json();
    if (data.status === "done") {
      return {
        query,
        ok: true,
        ms: data.timing?.total_ms,
        source: data.slot_source,
        rows: data.meta?.row_count ?? 0,
        recall: data.meta?.recall_count ?? 0,
      };
    }
    if (data.status === "error") {
      return { query, ok: false, error: data.error };
    }
  }
  return { query, ok: false, error: "timeout" };
}

const results = [];
for (const item of queries) {
  const q = typeof item === "string" ? item : item.query;
  process.stdout.write(`\r${results.length + 1}/${queries.length} ${q.slice(0, 40)}…`);
  results.push(await runOne(q));
}
console.log("\n");

const ok = results.filter((r) => r.ok);
const withRows = ok.filter((r) => r.rows > 0);
const avgMs = ok.length ? Math.round(ok.reduce((s, r) => s + (r.ms || 0), 0) / ok.length) : 0;

console.log(`Total: ${queries.length} | OK: ${ok.length} | With results: ${withRows.length} | Avg ms: ${avgMs}`);
console.log("No results:", results.filter((r) => r.ok && r.rows === 0).map((r) => r.query).join(", ") || "(none)");
