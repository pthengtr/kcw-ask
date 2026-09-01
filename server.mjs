#!/usr/bin/env node
/**
 * KCW Ask — product search on :3000
 * intent slots → PARTS9 ICMAS SQL (OpenAI for slot fill)
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, createReadStream, statSync } from "node:fs";
import { join, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import {
  parseProductQuery,
  mergeParsedIntoSlots,
  searchTokensFromSlots,
  isNumericSearchToken,
} from "./lib/parse-query.mjs";
import { scoreAndRankRows } from "./lib/score-rows.mjs";
import { buildSearchResultPayload, formatSizesCompact } from "./lib/icmas-labels.mjs";
import {
  embedConfigured,
  embedText,
  loadProductEmbedIndex,
  blendScores,
} from "./lib/embed.mjs";
import { getImageConfig, resolveProductImages } from "./lib/product-images.mjs";
import { applyShortNameHints, tokenMatchSqlParts } from "./lib/icmas-short-names.mjs";

const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)));
const PUBLIC = join(ROOT, "public");

function loadEnvFile(path, fileEnv, { override = false } = {}) {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, "");
    if (override || !(k in fileEnv)) fileEnv[k] = v;
  }
}

function loadEnv() {
  const fileEnv = {};
  loadEnvFile("/home/hqadmin/open-webui/.env", fileEnv);
  loadEnvFile("/home/hqadmin/open-webui/sql-tool/.env", fileEnv, { override: true });
  loadEnvFile(join(ROOT, ".env"), fileEnv, { override: true });
  loadEnvFile("/home/hqadmin/projects/kcw-api/.env", fileEnv, { override: true });
  if (!fileEnv.OPENAI_API_KEY && fileEnv.OPENAI_API_KEYS) {
    fileEnv.OPENAI_API_KEY = fileEnv.OPENAI_API_KEYS.split(";")[0].trim();
  }
  if (!fileEnv.OPENAI_BASE_URL && fileEnv.OPENAI_API_BASE_URLS) {
    fileEnv.OPENAI_BASE_URL = fileEnv.OPENAI_API_BASE_URLS.split(";")[0].trim();
  }
  for (const [k, v] of Object.entries(fileEnv)) {
    if (
      !(k in process.env) ||
      [
        "CURSOR_AGENT",
        "ASK_AGENT_BIN",
        "OPENAI_API_KEY",
        "SQL_TOOL_TOKEN",
        "SLOT_LLM_BASE_URL",
        "SLOT_LLM_MODEL",
      ].includes(k)
    ) {
      process.env[k] = v;
    }
  }
  return fileEnv;
}

const fileEnv = loadEnv();
const PORT = Number(process.env.PORT || 3000);
const WORKSPACE = process.env.WORKSPACE || ROOT;
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_BASE = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
const OPENAI_MODEL = process.env.ASK_MODEL || "gpt-4o-mini";
const SLOT_BASE = (process.env.SLOT_LLM_BASE_URL || "").replace(/\/$/, "");
const SLOT_MODEL = process.env.SLOT_LLM_MODEL || OPENAI_MODEL;
const SLOT_KEY = process.env.SLOT_LLM_API_KEY || OPENAI_KEY;
const SLOT_LLM_ONLY = ["1", "true", "yes", "on"].includes(
  String(process.env.SLOT_LLM_ONLY || (SLOT_BASE ? "true" : "false")).toLowerCase()
);
const SEARCH_RECALL_LIMIT = Number(process.env.SEARCH_RECALL_LIMIT || 100);
const SEARCH_RESULT_LIMIT = Number(process.env.SEARCH_RESULT_LIMIT || 30);
const SEARCH_DEBUG = ["1", "true", "yes", "on"].includes(
  String(process.env.SEARCH_DEBUG || "false").toLowerCase()
);
const SEARCH_EMBED_WEIGHT = Number(process.env.SEARCH_EMBED_WEIGHT || 0.35);
const SQL_URL = (process.env.SQL_TOOL_URL || "http://127.0.0.1:8091").replace(/\/$/, "");
const SQL_TOKEN = process.env.SQL_TOOL_TOKEN || "";
const JOB_TIMEOUT_MS = Number(process.env.ASK_JOB_TIMEOUT_MS || 180000);

/** From kcw-docs ICMAS dictionary §2.1 / §3 */
const CATEGORY_MAP = {
  "01": "TX จิ๊ป แลนด์",
  "08": "TOYOTA กระบะ เก๋ง",
  "11": "MITSUBISHI กระบะ เก๋ง",
  "21": "แบตเตอรี่ น้ำกรด น้ำกลั่น",
  "22": "น้ำมัน จารบี น้ำยา",
  "25": "ยางโอริง",
  "26": "สายอ่อน",
  "30": "รถไถ KUBOTA",
};
const CODE1_MAP = {
  C: "ซีล",
  F: "ไส้กรองอากาศ",
  I: "ลูกปืน",
  O: "โอริง",
  P: "ไส้กรองน้ำมันเครื่อง",
  L: "สายอ่อน",
};

const jobs = new Map();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
};

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      try {
        resolveBody(reqBodyParse(Buffer.concat(chunks).toString("utf8")));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function reqBodyParse(raw) {
  return raw ? JSON.parse(raw) : {};
}

function serveStatic(req, res) {
  let path = req.url?.split("?")[0] || "/";
  if (path === "/") path = "/index.html";
  const file = join(PUBLIC, path);
  if (!file.startsWith(PUBLIC) || !existsSync(file)) {
    res.writeHead(404).end("Not found");
    return;
  }
  const headers = {
    "Content-Type": MIME[extname(file)] || "application/octet-stream",
    "Cache-Control": "no-store",
  };
  if (req.method === "HEAD") {
    try {
      headers["Content-Length"] = String(statSync(file).size);
    } catch {
      /* ignore */
    }
    res.writeHead(200, headers);
    res.end();
    return;
  }
  res.writeHead(200, headers);
  createReadStream(file).pipe(res);
}

function sqlQuote(s) {
  return String(s).replace(/'/g, "''");
}

async function sqlFetch(path, body) {
  const res = await fetch(`${SQL_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(SQL_TOKEN ? { Authorization: `Bearer ${SQL_TOKEN}` } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({ raw: "bad json" }));
  if (!res.ok) throw new Error(typeof data === "object" ? JSON.stringify(data) : String(data));
  return data;
}

/* ---------------- Search: rules + slots + SQL ---------------- */

function rulesSlots(message) {
  const raw = String(message || "").trim();
  const slots = {
    intent: "product_search",
    site: "hq",
    bcode: null,
    text: null,
    brand: null,
    model: null,
    size1: null,
    size2: null,
    size3: null,
    category_code: null,
    code1: null,
    pcode_or_mcode: null,
  };

  const parsed = parseProductQuery(raw);
  mergeParsedIntoSlots(slots, parsed);

  const bcode = raw.match(/\b(\d{6,12})\b/);
  if (bcode && /^\d{6,12}$/.test(raw.trim())) {
    slots.intent = "product_by_code";
    slots.bcode = raw.trim();
    return { slots, source: "rules+parse", complete: true, parsed };
  }

  const brandHints = ["PTT", "CRR", "แท้", "แท้ห้าง", "OEM", "TOYOTA", "ISUZU", "HINO"];
  for (const b of brandHints) {
    if (raw.toUpperCase().includes(b.toUpperCase()) || raw.includes(b)) {
      slots.brand = slots.brand || b;
      break;
    }
  }

  if (!slots.text && !slots.bcode && !slots.size1 && !slots.brand && !slots.code1) {
    slots.text = parsed.raw || raw;
  }

  const complete = Boolean(slots.bcode && slots.intent === "product_by_code");
  return { slots, source: "rules+parse", complete, parsed };
}

const SLOT_SYSTEM = `คุณแยก intent/slot สำหรับค้นหาสินค้า PARTS9 (ICMAS) เท่านั้น
ตอบเป็น JSON ล้วน ไม่มี markdown
schema:
{
  "intent": "product_search"|"product_by_code"|"clarify",
  "site": "hq"|"syp",
  "bcode": string|null,
  "text": string|null,
  "brand": string|null,
  "model": string|null,
  "size1": string|null,
  "size2": string|null,
  "size3": string|null,
  "category_code": string|null,
  "code1": string|null,
  "pcode_or_mcode": string|null
}
กติกา:
- text = คำค้นชื่อใน DESCR (ไม่ใส่ตัวเลขขนาด)
- size1/size2/size3 = คอลัมน์ ICMAS SIZE1/SIZE2/SIZE3 (มิติ ตาม CODE1)
  ซีล/บู๊ช/ลูกปืน: size1=ใน size2=นอก size3=หนา
  ไส้กรอง: size1=ใน size2=นอก size3=สูง
  โอริง: size1=ใน size2=หนา
- site default hq
- CODE1: C=ซีล F=ไส้กรองอากาศ I=ลูกปืน O=โอริง P=ไส้กรองน้ำมัน L=สายอ่อน
- หมวด BCODE 2 หลัก เช่น 22=น้ำมัน`;

async function chatCompletions(base, key, model, messages, { temperature = 0, max_tokens = 400 } = {}) {
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ model, temperature, max_tokens, messages }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || JSON.stringify(data));
  return data.choices?.[0]?.message?.content || "";
}

function parseJsonLoose(text) {
  const raw = String(text || "").trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("no json object");
  return JSON.parse(body.slice(start, end + 1));
}

async function fillSlotsWithLlm(message, rules) {
  const messages = [
    { role: "system", content: SLOT_SYSTEM },
    {
      role: "user",
      content: JSON.stringify({ message, rules_guess: rules.slots }, null, 2),
    },
  ];

  const attempts = [];
  if (SLOT_BASE) {
    attempts.push({
      name: "local",
      run: () => chatCompletions(SLOT_BASE, SLOT_KEY, SLOT_MODEL, messages, { max_tokens: 350 }),
    });
  }
  if (OPENAI_KEY && !SLOT_LLM_ONLY) {
    attempts.push({
      name: "openai",
      run: () =>
        chatCompletions(OPENAI_BASE, OPENAI_KEY, OPENAI_MODEL, messages, {
          temperature: 0.1,
          max_tokens: 350,
        }),
    });
  }

  let lastErr;
  let lastLlmMs = 0;
  for (const a of attempts) {
    const t0 = Date.now();
    try {
      const content = await a.run();
      const slots = { ...rules.slots, ...parseJsonLoose(content) };
      return { slots, source: a.name, llm_ms: Date.now() - t0 };
    } catch (err) {
      lastErr = err;
      lastLlmMs = Date.now() - t0;
    }
  }
  return {
    slots: rules.slots,
    source: "rules_only",
    llm_ms: lastLlmMs,
    warning: String(lastErr?.message || lastErr || ""),
  };
}

function slotsCompleteEnough(slots) {
  if (slots.intent === "product_by_code") return true;
  return Boolean(
    slots.text ||
      slots.bcode ||
      slots.pcode_or_mcode ||
      slots.code1 ||
      slots.size1 ||
      slots.brand ||
      slots.model
  );
}

function hasStructuredFilters(slots) {
  return Boolean(
    slots.code1 ||
      slots.size1 ||
      slots.size2 ||
      slots.size3 ||
      slots.bcode ||
      slots.category_code ||
      slots.pcode_or_mcode ||
      slots.brand ||
      slots.model
  );
}

function buildSqlFromSlots(slots) {
  if (slots.intent === "product_by_code" && slots.bcode) {
    const code = sqlQuote(slots.bcode);
    return {
      sql: `SELECT TOP 20 BCODE, DESCR, MODEL, BRAND, CODE1, SIZE1, SIZE2, SIZE3, PCODE, MCODE, QTYOH2, PRICE1, LOCATION1, CANCELED
FROM dbo.ICMAS WITH (NOLOCK)
WHERE BCODE = '${code}'
ORDER BY BCODE`,
    };
  }

  const likes = [];
  const pushLike = (col, val) => {
    if (!val) return;
    const q = sqlQuote(val);
    likes.push(`${col} LIKE N'%${q}%'`);
    likes.push(`${col} LIKE '%${q}%'`);
  };

  const textTokens = searchTokensFromSlots(slots);

  const tokenMatchParts = (tok) => tokenMatchSqlParts(tok, sqlQuote);

  for (const tok of textTokens) {
    const q = sqlQuote(tok);
    likes.push(`DESCR LIKE N'%${q}%'`);
    likes.push(`MODEL LIKE N'%${q}%'`);
    likes.push(`BRAND LIKE N'%${q}%'`);
  }
  if (slots.brand) pushLike("BRAND", slots.brand);
  if (slots.model) pushLike("MODEL", slots.model);
  if (slots.bcode) pushLike("BCODE", slots.bcode);
  if (slots.pcode_or_mcode) {
    pushLike("PCODE", slots.pcode_or_mcode);
    pushLike("MCODE", slots.pcode_or_mcode);
  }

  const where = [`CANCELED = 'N'`];
  if (textTokens.length) {
    for (const tok of textTokens) {
      const parts = tokenMatchParts(tok);
      if (isNumericSearchToken(tok)) {
        const q = sqlQuote(tok);
        for (const col of ["SIZE1", "SIZE2", "SIZE3"]) {
          parts.push(`LTRIM(RTRIM(CAST(${col} AS nvarchar(50)))) LIKE N'%${q}%'`);
        }
      }
      where.push(`(${parts.join(" OR ")})`);
    }
  } else if (likes.length) {
    where.push(`(${likes.join(" OR ")})`);
  }
  if (slots.size1 != null && String(slots.size1).trim() !== "") {
    where.push(`LTRIM(RTRIM(CAST(SIZE1 AS nvarchar(50)))) = '${sqlQuote(String(slots.size1).trim())}'`);
  }
  if (slots.size2 != null && String(slots.size2).trim() !== "") {
    where.push(`LTRIM(RTRIM(CAST(SIZE2 AS nvarchar(50)))) = '${sqlQuote(String(slots.size2).trim())}'`);
  }
  if (slots.size3 != null && String(slots.size3).trim() !== "") {
    where.push(`LTRIM(RTRIM(CAST(SIZE3 AS nvarchar(50)))) = '${sqlQuote(String(slots.size3).trim())}'`);
  }
  if (slots.code1) {
    where.push(`UPPER(LTRIM(RTRIM(CODE1))) = '${sqlQuote(String(slots.code1).toUpperCase())}'`);
  }
  if (slots.category_code) {
    const cc = sqlQuote(String(slots.category_code).padStart(2, "0").slice(0, 2));
    where.push(`LEFT(BCODE, 2) = '${cc}'`);
  }

  if (!hasStructuredFilters(slots) && textTokens.length === 0) {
    return { sql: null };
  }

  if (where.length === 1) {
    return { sql: null };
  }

  const primary = sqlQuote(slots.text || slots.brand || slots.model || "");
  const recall = Math.max(SEARCH_RESULT_LIMIT, Math.min(SEARCH_RECALL_LIMIT, 200));
  const sql = `SELECT TOP ${recall} BCODE, DESCR, MODEL, BRAND, CODE1, SIZE1, SIZE2, SIZE3, PCODE, MCODE, QTYOH2, PRICE1, LOCATION1, CANCELED
FROM dbo.ICMAS WITH (NOLOCK)
WHERE ${where.join("\n  AND ")}
ORDER BY
  CASE WHEN LTRIM(RTRIM(BCODE)) = '${primary}' THEN 0
       WHEN LTRIM(RTRIM(COALESCE(PCODE,''))) = '${primary}' THEN 1
       WHEN LTRIM(RTRIM(COALESCE(MCODE,''))) = '${primary}' THEN 1
       WHEN DESCR LIKE N'%${primary}%' THEN 2 ELSE 3 END,
  BCODE`;
  return { sql };
}

function formatRowsMarkdown(message, site, sql, slots, data, scoreMeta = null) {
  const rows = data.rows || [];
  const keys = [
    "BCODE",
    "DESCR",
    "BRAND",
    "PCODE",
    "MCODE",
    "MODEL",
    "CODE1",
    "SIZES",
    "QTYOH2",
    "PRICE1",
    "LOCATION1",
  ];
  const headers = [
    "รหัสสินค้า",
    "ชื่อสินค้า",
    "ยี่ห้อ",
    "เบอร์แท้",
    "เบอร์โรงงาน",
    "รุ่น/แบบ",
    "ประเภท",
    "ขนาด",
    "คงเหลือ",
    "ราคา1",
    "ที่เก็บ",
  ];
  if (!rows.length) {
    return `ไม่พบสินค้าที่ตรงกับ「${message}」ใน **${site.toUpperCase()}**\n\n## Sources\n- \`local:${site}:PARTS9\`\n\`\`\`sql\n${sql}\n\`\`\`\n\n### slots\n\`\`\`json\n${JSON.stringify(slots, null, 2)}\n\`\`\``;
  }
  const header = `| ${headers.join(" | ")} |\n| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows
    .map((r) => {
      const cells = keys.map((c) => {
        if (c === "SIZES") {
          return formatSizesCompact(r.CODE1, r.SIZE1, r.SIZE2, r.SIZE3);
        }
        return String(r[c] ?? "");
      });
      return `| ${cells.join(" | ")} |`;
    })
    .join("\n");
  let out = `พบ **${rows.length}** รายการ สำหรับ「${message}」(${site.toUpperCase()})\n\n${header}\n${body}\n\n## Sources\n- \`local:${site}:PARTS9\` (ICMAS SIZE1/2/3 per kcw-docs)\n\`\`\`sql\n${sql}\n\`\`\``;
  if (SEARCH_DEBUG && scoreMeta) {
    out += `\n\n### debug\n\`\`\`json\n${JSON.stringify(scoreMeta, null, 2)}\n\`\`\``;
  }
  return out;
}

async function runSearchJob(job, message) {
  const timing = {
    rules_ms: 0,
    slot_llm_ms: 0,
    sql_ms: 0,
    score_ms: 0,
    embed_ms: 0,
    format_ms: 0,
    total_ms: 0,
  };
  const t0 = Date.now();

  job.phase = "slots";
  const tRules = Date.now();
  const rules = rulesSlots(message);
  timing.rules_ms = Date.now() - tRules;

  let filled = { slots: rules.slots, source: rules.source, llm_ms: 0 };
  if (!rules.complete && !slotsCompleteEnough(rules.slots)) {
    filled = await fillSlotsWithLlm(message, rules);
    timing.slot_llm_ms = filled.llm_ms || 0;
  } else if (!rules.complete) {
    filled = { slots: rules.slots, source: rules.source, llm_ms: 0 };
  }
  const slots = filled.slots;
  applyShortNameHints(slots);
  job.slots = slots;
  job.slot_source = filled.source;

  job.phase = `sql:${slots.site || "hq"}`;
  const { sql } = buildSqlFromSlots(slots);
  if (!sql) {
    job.status = "done";
    job.phase = "done";
    job.result = "ระบุชื่อสินค้าหรือรหัส BCODE ให้ชัดขึ้นอีกนิด";
    timing.total_ms = Date.now() - t0;
    job.timing = timing;
    return;
  }

  const tSql = Date.now();
  const site = slots.site === "syp" ? "syp" : "hq";
  const path = site === "syp" ? "/query_syp" : "/query_hq";
  const data = await sqlFetch(path, { sql, row_limit: SEARCH_RECALL_LIMIT });
  timing.sql_ms = Date.now() - tSql;

  job.phase = "score";
  const tScore = Date.now();
  const { rows: scoredRows, scores } = scoreAndRankRows(data.rows || [], {
    query: message,
    slots,
    limit: SEARCH_RESULT_LIMIT,
  });
  timing.score_ms = Date.now() - tScore;

  let finalRows = scoredRows;
  let embedMeta = null;
  const embedIndex = loadProductEmbedIndex();
  if (embedConfigured() && embedIndex?.items?.length) {
    job.phase = "embed";
    const tEmbed = Date.now();
    try {
      const queryEmbed = await embedText(message);
      if (queryEmbed) {
        const byBcode = new Map(
          embedIndex.items.map((it) => [String(it.bcode).trim(), it.embedding])
        );
        const blended = scoredRows.map((row) => {
          const hit = scores.find((s) => s.bcode === row.BCODE);
          const heuristic = hit?.score ?? 0;
          const emb = byBcode.get(String(row.BCODE || "").trim());
          const cosine = emb ? cosineFromEmbed(queryEmbed, emb) : 0;
          return {
            row,
            finalScore: blendScores(heuristic, cosine, SEARCH_EMBED_WEIGHT),
            heuristic,
            cosine,
          };
        });
        blended.sort(
          (a, b) => b.finalScore - a.finalScore || String(a.row.BCODE).localeCompare(String(b.row.BCODE))
        );
        finalRows = blended.slice(0, SEARCH_RESULT_LIMIT).map((b) => b.row);
        embedMeta = blended.slice(0, SEARCH_RESULT_LIMIT).map((b) => ({
          bcode: b.row.BCODE,
          heuristic: b.heuristic,
          cosine: Number(b.cosine.toFixed(4)),
          final: Number(b.finalScore.toFixed(2)),
        }));
      }
    } catch (err) {
      embedMeta = { error: String(err.message || err) };
    }
    timing.embed_ms = Date.now() - tEmbed;
  }

  job.phase = "images";
  const imageConfig = getImageConfig();
  let imageMap = new Map();
  if (imageConfig.supabaseUrl && finalRows.length) {
    try {
      imageMap = await resolveProductImages(
        finalRows.map((row) => row.BCODE),
        imageConfig
      );
    } catch (err) {
      console.warn("product image resolve failed:", err);
    }
  }

  job.phase = "format";
  const tFmt = Date.now();
  const rankedData = { ...data, rows: finalRows, row_count: finalRows.length };
  const scoreMeta = SEARCH_DEBUG ? { scores, embed: embedMeta } : null;
  const searchResults = buildSearchResultPayload(finalRows, {
    message,
    site,
    scores,
    imageMap,
  });
  job.result = formatRowsMarkdown(message, site, sql, slots, rankedData, scoreMeta);
  job.search_results = searchResults;
  timing.format_ms = Date.now() - tFmt;
  timing.total_ms = Date.now() - t0;

  job.status = "done";
  job.phase = "done";
  job.timing = timing;
  job.meta = {
    site,
    sql,
    recall_count: data.row_count,
    row_count: finalRows.length,
    slot_source: filled.source,
    scores: SEARCH_DEBUG ? scores : undefined,
    embed: embedMeta,
    search_results: searchResults,
  };
}

function cosineFromEmbed(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom ? dot / denom : 0;
}

function startJob({ message, chatId }) {
  const jobId = randomUUID();
  const job = {
    id: jobId,
    chatId: chatId || randomUUID(),
    mode: "search",
    status: "running",
    phase: "starting",
    result: "",
    error: null,
    createdAt: Date.now(),
    timing: null,
    slots: null,
  };
  jobs.set(jobId, job);

  const timer = setTimeout(() => {
    if (job.status === "running") {
      job.status = "error";
      job.phase = "timeout";
      job.error = `หมดเวลา (${Math.round(JOB_TIMEOUT_MS / 1000)} วินาที)`;
    }
  }, JOB_TIMEOUT_MS);
  timer.unref?.();

  (async () => {
    try {
      await runSearchJob(job, message);
    } catch (err) {
      if (job.status === "running") {
        job.status = "error";
        job.phase = "error";
        job.error = String(err.message || err);
      }
    }
  })();

  setTimeout(() => jobs.delete(jobId), 30 * 60 * 1000).unref?.();
  return job;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  const started = Date.now();
  res.on("finish", () => {
    console.log(
      `${new Date().toISOString()} ${req.socket.remoteAddress} ${req.method} ${url.pathname} -> ${res.statusCode} ${Date.now() - started}ms`
    );
  });

  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS,HEAD",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      return res.end();
    }

    if (req.method === "GET" && url.pathname === "/api/health") {
      return sendJson(res, 200, {
        status: "ok",
        mode: "search",
        slot_llm: SLOT_BASE ? { base: SLOT_BASE, model: SLOT_MODEL, only: SLOT_LLM_ONLY } : null,
        embed_llm: embedConfigured()
          ? { model: process.env.EMBED_LLM_MODEL || "bge-m3", index: Boolean(loadProductEmbedIndex()) }
          : null,
        search: { recall: SEARCH_RECALL_LIMIT, result: SEARCH_RESULT_LIMIT, debug: SEARCH_DEBUG },
        openai_fallback: Boolean(OPENAI_KEY) && !SLOT_LLM_ONLY,
        sql: SQL_URL,
      });
    }

    if (req.method === "POST" && url.pathname === "/api/chat/start") {
      const body = await readBody(req);
      const message = String(body.message || "").trim();
      if (!message) return sendJson(res, 400, { error: "กรุณาพิมพ์ข้อความ" });
      const chatId = String(body.chatId || randomUUID());
      const job = startJob({ message, chatId });
      console.log(`job ${job.id} msg=${message.slice(0, 60)}`);
      return sendJson(res, 200, {
        ok: true,
        jobId: job.id,
        chatId,
        mode: "search",
        status: job.status,
      });
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/chat/job/")) {
      const jobId = url.pathname.slice("/api/chat/job/".length);
      const job = jobs.get(jobId);
      if (!job) return sendJson(res, 404, { error: "ไม่พบงานนี้" });
      return sendJson(res, 200, {
        ok: true,
        jobId: job.id,
        chatId: job.chatId,
        mode: job.mode,
        status: job.status,
        phase: job.phase,
        result: job.status === "done" ? job.result : "",
        error: job.error,
        elapsed_ms: Date.now() - job.createdAt,
        timing: job.timing,
        slots: job.slots,
        slot_source: job.slot_source,
        meta: job.meta || null,
        search_results: job.search_results || job.meta?.search_results || null,
      });
    }

    if (req.method === "POST" && url.pathname === "/api/reset") {
      return sendJson(res, 200, { ok: true, chatId: randomUUID() });
    }

    if (req.method === "GET" || req.method === "HEAD") return serveStatic(req, res);
    res.writeHead(405).end("Method not allowed");
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { error: String(err.message || err) });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`KCW search :${PORT} slots→SQL localSlots=${SLOT_BASE || "off"}`);
});
