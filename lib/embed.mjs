/**
 * Local embedding client (OpenAI-compatible /v1/embeddings).
 */

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const _ROOT = dirname(fileURLToPath(import.meta.url));

const INDEX_PATH =
  process.env.PRODUCT_EMBED_INDEX ||
  join(dirname(fileURLToPath(import.meta.url)), "..", "data", "product-embeddings.json");

let indexCache = null;

function embedBase() {
  return (process.env.EMBED_LLM_BASE_URL || "").replace(/\/$/, "");
}

function embedModel() {
  return process.env.EMBED_LLM_MODEL || "text-embedding-3-small";
}

function embedKey() {
  return process.env.EMBED_LLM_API_KEY || process.env.OPENAI_API_KEY || "";
}

export function embedConfigured() {
  return Boolean(embedBase());
}

export async function embedText(text) {
  const base = embedBase();
  if (!base || !String(text || "").trim()) return null;
  const res = await fetch(`${base}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${embedKey()}`,
    },
    body: JSON.stringify({ model: embedModel(), input: String(text).trim() }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || JSON.stringify(data));
  const vec = data?.data?.[0]?.embedding;
  return Array.isArray(vec) ? vec : null;
}

export function cosineSimilarity(a, b) {
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

export function blendScores(heuristic, cosine, weight = 0.35) {
  const w = Math.max(0, Math.min(1, weight));
  return heuristic * (1 - w) + cosine * 100 * w;
}

export function loadProductEmbedIndex() {
  if (indexCache) return indexCache;
  if (!existsSync(INDEX_PATH)) return null;
  try {
    indexCache = JSON.parse(readFileSync(INDEX_PATH, "utf8"));
    return indexCache;
  } catch {
    return null;
  }
}

/**
 * Re-rank rows using precomputed embeddings when index + query embed available.
 * @param {object[]} rows
 * @param {number[]|null} queryEmbed
 * @param {{ weight?: number, index?: object }} opts
 */
export function rerankWithEmbeddings(rows, queryEmbed, opts = {}) {
  if (!queryEmbed?.length) {
    return { rows, embedScores: [] };
  }
  const index = opts.index || loadProductEmbedIndex();
  if (!index?.items?.length) {
    return { rows, embedScores: [] };
  }
  const byBcode = new Map(index.items.map((it) => [String(it.bcode).trim(), it.embedding]));
  const weight = opts.weight ?? Number(process.env.SEARCH_EMBED_WEIGHT || 0.35);

  const scored = rows.map((row) => {
    const emb = byBcode.get(String(row.BCODE || "").trim());
    const cosine = emb ? cosineSimilarity(queryEmbed, emb) : 0;
    return { row, cosine, embedScore: cosine * 100 };
  });

  return {
    rows: scored
      .sort((a, b) => b.cosine - a.cosine)
      .map((s) => s.row),
    embedScores: scored.map((s) => ({
      bcode: s.row.BCODE,
      cosine: s.cosine,
      weight,
    })),
    blend: (heuristicScore, bcode) => {
      const hit = scored.find((s) => s.row.BCODE === bcode);
      return blendScores(heuristicScore, hit?.cosine ?? 0, weight);
    },
  };
}

export { INDEX_PATH };
