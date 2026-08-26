#!/usr/bin/env node
/**
 * KCW Ask — two modes on :3000
 *  - search: intent slots → flexible PARTS9 ICMAS SQL (local LLM for slots, OpenAI fallback)
 *  - ask: warm cursor-agent --mode ask (started on mode enter, then --resume)
 */
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFileSync, existsSync, createReadStream, statSync } from "node:fs";
import { join, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

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
const DOCS_DIR = process.env.DOCS_DIR || "/home/hqadmin/projects/kcw-docs";
const AGENT_BIN = fileEnv.ASK_AGENT_BIN || "/home/hqadmin/.local/bin/cursor-agent";
const OPENAI_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_BASE = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
const OPENAI_MODEL = process.env.ASK_MODEL || "gpt-4o-mini";
const SLOT_BASE = (process.env.SLOT_LLM_BASE_URL || "").replace(/\/$/, "");
const SLOT_MODEL = process.env.SLOT_LLM_MODEL || "qwen2.5:32b";
const SLOT_KEY = process.env.SLOT_LLM_API_KEY || "ollama";
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

  if (/syp|สาขา|ร้าน/i.test(raw)) slots.site = "syp";
  if (/hq|สำนักงาน|ออฟฟิศ/i.test(raw)) slots.site = "hq";

  const bcode = raw.match(/\b(\d{6,12})\b/);
  if (bcode && /^\d{6,12}$/.test(raw.trim())) {
    slots.intent = "product_by_code";
    slots.bcode = raw.trim();
    return { slots, source: "rules", complete: true };
  }
  if (bcode) slots.bcode = bcode[1];

  // ICMAS SIZE1/SIZE2/SIZE3 (docs §7) — e.g. ซีล ใน31 นอก46 หนา7 / 31x46x7 / 31*46*7
  const labeled = {
    size1: raw.match(/(?:size1|ใน|id|i\.?d\.?)\s*[:=]?\s*(\d+(?:\.\d+)?)/i),
    size2: raw.match(/(?:size2|นอก|od|o\.?d\.?)\s*[:=]?\s*(\d+(?:\.\d+)?)/i),
    size3: raw.match(/(?:size3|หนา|สูง|ยาว|width|thick)\s*[:=]?\s*(\d+(?:\.\d+)?)/i),
  };
  if (labeled.size1) slots.size1 = labeled.size1[1];
  if (labeled.size2) slots.size2 = labeled.size2[1];
  if (labeled.size3) slots.size3 = labeled.size3[1];

  if (!slots.size1 && !slots.size2) {
    const triple = raw.match(/(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/i);
    const pair = raw.match(/(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/i);
    if (triple) {
      slots.size1 = triple[1];
      slots.size2 = triple[2];
      slots.size3 = triple[3];
    } else if (pair) {
      slots.size1 = pair[1];
      slots.size2 = pair[2];
    }
  }

  for (const [letter, name] of Object.entries(CODE1_MAP)) {
    if (raw.includes(name)) slots.code1 = letter;
  }

  let text = raw
    .replace(/\b(hq|syp|ค้นหา|หา|สินค้า|ขอ|ดู)\b/gi, " ")
    .replace(/\d{6,12}/g, " ")
    .replace(/(?:size[123]|ใน|นอก|หนา|สูง|ยาว)\s*[:=]?\s*\d+(?:\.\d+)?/gi, " ")
    .replace(/\d+(?:\.\d+)?\s*[x×*]\s*\d+(?:\.\d+)?(?:\s*[x×*]\s*\d+(?:\.\d+)?)?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  slots.text = text || null;

  const brandHints = ["PTT", "CRR", "แท้", "แท้ห้าง", "OEM", "TOYOTA", "ISUZU", "HINO"];
  for (const b of brandHints) {
    if (raw.toUpperCase().includes(b.toUpperCase()) || raw.includes(b)) {
      slots.brand = b;
      break;
    }
  }

  if (!slots.text && !slots.bcode && !slots.size1 && !slots.brand && !slots.code1) {
    slots.text = raw;
  }

  const complete = Boolean(slots.bcode && slots.intent === "product_by_code");
  return { slots, source: "rules", complete };
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
  if (OPENAI_KEY) {
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
  for (const a of attempts) {
    const t0 = Date.now();
    try {
      const content = await a.run();
      const slots = { ...rules.slots, ...parseJsonLoose(content) };
      return { slots, source: a.name, llm_ms: Date.now() - t0 };
    } catch (err) {
      lastErr = err;
    }
  }
  return {
    slots: rules.slots,
    source: "rules_only",
    llm_ms: 0,
    warning: String(lastErr?.message || lastErr || ""),
  };
}

function buildSqlFromSlots(slots) {
  if (slots.intent === "product_by_code" && slots.bcode) {
    const code = sqlQuote(slots.bcode);
    return {
      sql: `SELECT TOP 20 BCODE, DESCR, MODEL, BRAND, CODE1, SIZE1, SIZE2, SIZE3, PCODE, MCODE, QTYOH1, PRICE1, LOCATION1, CANCELED
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

  if (slots.text) {
    pushLike("DESCR", slots.text);
    pushLike("MODEL", slots.text);
  }
  if (slots.brand) pushLike("BRAND", slots.brand);
  if (slots.model) pushLike("MODEL", slots.model);
  if (slots.bcode) pushLike("BCODE", slots.bcode);
  if (slots.pcode_or_mcode) {
    pushLike("PCODE", slots.pcode_or_mcode);
    pushLike("MCODE", slots.pcode_or_mcode);
  }

  const where = [`CANCELED = 'N'`];
  if (likes.length) where.push(`(${likes.join(" OR ")})`);
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

  if (where.length === 1) {
    return { sql: null };
  }

  const primary = sqlQuote(slots.text || slots.brand || slots.model || "");
  const sql = `SELECT TOP 30 BCODE, DESCR, MODEL, BRAND, CODE1, SIZE1, SIZE2, SIZE3, PCODE, MCODE, QTYOH1, PRICE1, LOCATION1, CANCELED
FROM dbo.ICMAS WITH (NOLOCK)
WHERE ${where.join("\n  AND ")}
ORDER BY
  CASE WHEN DESCR LIKE N'%${primary}%' THEN 0 ELSE 1 END,
  BCODE`;
  return { sql };
}

function formatRowsMarkdown(message, site, sql, slots, data) {
  const rows = data.rows || [];
  const cols = ["BCODE", "DESCR", "MODEL", "BRAND", "CODE1", "SIZE1", "SIZE2", "SIZE3", "QTYOH1", "PRICE1", "LOCATION1"];
  if (!rows.length) {
    return `ไม่พบสินค้าที่ตรงกับ「${message}」ใน **${site.toUpperCase()}**\n\n## Sources\n- \`local:${site}:PARTS9\`\n\`\`\`sql\n${sql}\n\`\`\`\n\n### slots\n\`\`\`json\n${JSON.stringify(slots, null, 2)}\n\`\`\``;
  }
  const header = `| ${cols.join(" | ")} |\n| ${cols.map(() => "---").join(" | ")} |`;
  const body = rows
    .map((r) => `| ${cols.map((c) => String(r[c] ?? "")).join(" | ")} |`)
    .join("\n");
  return `พบ **${rows.length}** รายการ สำหรับ「${message}」(${site.toUpperCase()})\n\n${header}\n${body}\n\n## Sources\n- \`local:${site}:PARTS9\` (ICMAS SIZE1/2/3 per kcw-docs)\n\`\`\`sql\n${sql}\n\`\`\``;
}

async function runSearchJob(job, message) {
  const timing = { rules_ms: 0, slot_llm_ms: 0, sql_ms: 0, format_ms: 0, total_ms: 0 };
  const t0 = Date.now();

  job.phase = "slots";
  const tRules = Date.now();
  const rules = rulesSlots(message);
  timing.rules_ms = Date.now() - tRules;

  let filled = { slots: rules.slots, source: "rules", llm_ms: 0 };
  if (!rules.complete) {
    filled = await fillSlotsWithLlm(message, rules);
    timing.slot_llm_ms = filled.llm_ms || 0;
  }
  const slots = filled.slots;
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
  const data = await sqlFetch(path, { sql, row_limit: 30 });
  timing.sql_ms = Date.now() - tSql;

  job.phase = "format";
  const tFmt = Date.now();
  job.result = formatRowsMarkdown(message, site, sql, slots, data);
  timing.format_ms = Date.now() - tFmt;
  timing.total_ms = Date.now() - t0;

  job.status = "done";
  job.phase = "done";
  job.timing = timing;
  job.meta = { site, sql, row_count: data.row_count, slot_source: filled.source };
}

/* ---------------- Ask: warm Cursor agent ---------------- */

class WarmCursorAsk {
  constructor() {
    this.sessionId = null;
    this.warming = null;
    this.lastError = null;
  }

  async ensureWarm(job) {
    if (this.sessionId) return this.sessionId;
    if (this.warming) return this.warming;
    this.warming = this._warmup(job);
    try {
      this.sessionId = await this.warming;
      return this.sessionId;
    } finally {
      this.warming = null;
    }
  }

  _runAgent(args, onLine) {
    return new Promise((resolve, reject) => {
      const child = spawn(AGENT_BIN, args, {
        cwd: WORKSPACE,
        env: { ...process.env, NO_OPEN_BROWSER: "1", CURSOR_AGENT: undefined },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let buf = "";
      let err = "";
      let sessionId = null;
      let resultText = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        buf += chunk;
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          const t = line.trim();
          if (!t) continue;
          let evt;
          try {
            evt = JSON.parse(t);
          } catch {
            continue;
          }
          if (evt.session_id) sessionId = evt.session_id;
          if (evt.type === "result" && evt.result) resultText = evt.result;
          if (onLine) onLine(evt);
        }
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (c) => {
        err += c;
      });
      child.on("error", reject);
      child.on("close", (code) => {
        if (buf.trim()) {
          try {
            const evt = JSON.parse(buf.trim());
            if (evt.session_id) sessionId = evt.session_id;
            if (evt.type === "result" && evt.result) resultText = evt.result;
          } catch {
            /* ignore */
          }
        }
        if (code !== 0 && !resultText) {
          reject(new Error(err.trim() || `cursor-agent exited ${code}`));
          return;
        }
        resolve({ sessionId, resultText });
      });
    });
  }

  async _warmup(job) {
    if (job) job.phase = "warmup";
    const args = [
      "--mode",
      "ask",
      "-p",
      "--output-format",
      "stream-json",
      "--model",
      process.env.ASK_CURSOR_MODEL || "auto",
      "--trust",
      "--approve-mcps",
      "--workspace",
      WORKSPACE,
      "--add-dir",
      DOCS_DIR,
      "Reply with exactly: ready",
    ];
    const { sessionId } = await this._runAgent(args);
    if (!sessionId) throw new Error("warmup ได้ไม่มี session_id");
    return sessionId;
  }

  reset() {
    this.sessionId = null;
    this.lastError = null;
  }

  async ask(message, job) {
    const t0 = Date.now();
    let warm_ms = 0;
    if (!this.sessionId) {
      const tw = Date.now();
      await this.ensureWarm(job);
      warm_ms = Date.now() - tw;
    }
    if (job) job.phase = "agent";
    const prompt = [
      "You are KCW Agent (ask mode) (read-only). Prefer live PARTS9 via MCP parts9-sql (query_hq/query_syp).",
      "Use kcw-docs for schema meanings (ICMAS BCODE/CODE1/PCODE/MCODE).",
      "Answer in Thai. End with ## Sources.",
      "",
      message,
    ].join("\n");

    const args = [
      "--mode",
      "ask",
      "-p",
      "--output-format",
      "stream-json",
      "--stream-partial-output",
      "--model",
      process.env.ASK_CURSOR_MODEL || "auto",
      "--trust",
      "--approve-mcps",
      "--workspace",
      WORKSPACE,
      "--add-dir",
      DOCS_DIR,
      "--resume",
      this.sessionId,
      prompt,
    ];

    const ta = Date.now();
    try {
      const { sessionId, resultText } = await this._runAgent(args, (evt) => {
        if (job && evt.type === "tool_call") job.phase = "tools";
        if (job && evt.type === "assistant") job.phase = "generating";
      });
      if (sessionId) this.sessionId = sessionId;
      return {
        text: resultText,
        timing: {
          warm_ms,
          agent_ms: Date.now() - ta,
          total_ms: Date.now() - t0,
        },
      };
    } catch (err) {
      // session may be stale — reset and retry once with fresh warm
      this.sessionId = null;
      throw err;
    }
  }
}

const warmAsk = new WarmCursorAsk();

function startJob({ mode, message, chatId }) {
  const jobId = randomUUID();
  const job = {
    id: jobId,
    chatId: chatId || randomUUID(),
    mode,
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
      if (mode === "ask") {
        const out = await warmAsk.ask(message, job);
        job.result = out.text || "(ว่าง)";
        job.timing = out.timing;
        job.status = "done";
        job.phase = "done";
      } else {
        await runSearchJob(job, message);
      }
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
        modes: ["search", "ask"],
        slot_llm: SLOT_BASE ? { base: SLOT_BASE, model: SLOT_MODEL } : null,
        openai_fallback: Boolean(OPENAI_KEY),
        ask_warm: Boolean(warmAsk.sessionId),
        sql: SQL_URL,
      });
    }

    if (req.method === "POST" && url.pathname === "/api/ask/warmup") {
      try {
        const t0 = Date.now();
        const sid = await warmAsk.ensureWarm();
        return sendJson(res, 200, {
          ok: true,
          sessionId: sid,
          warm_ms: Date.now() - t0,
        });
      } catch (err) {
        return sendJson(res, 500, { ok: false, error: String(err.message || err) });
      }
    }

    if (req.method === "POST" && url.pathname === "/api/ask/reset") {
      warmAsk.reset();
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/chat/start") {
      const body = await readBody(req);
      const message = String(body.message || "").trim();
      const mode = body.mode === "ask" ? "ask" : "search";
      if (!message) return sendJson(res, 400, { error: "กรุณาพิมพ์ข้อความ" });
      const chatId = String(body.chatId || randomUUID());
      const job = startJob({ mode, message, chatId });
      console.log(`job ${job.id} mode=${mode} msg=${message.slice(0, 60)}`);
      return sendJson(res, 200, {
        ok: true,
        jobId: job.id,
        chatId,
        mode,
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
  console.log(
    `KCW dual-mode :${PORT} search(slots→SQL) ask(warm agent) localSlots=${SLOT_BASE || "off"}`
  );
});
