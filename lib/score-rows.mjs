/**
 * Heuristic product row scorer — post-SQL re-rank.
 */

import { searchTokensFromSlots, isNumericSearchToken } from "./parse-query.mjs";
import { tokenMatchesRow as tokenMatchesRowByAcode } from "./icmas-short-names.mjs";

function norm(s) {
  return String(s ?? "")
    .trim()
    .toLowerCase();
}

function numQty(v) {
  const n = parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function fieldContains(hay, needle) {
  if (!needle) return false;
  return norm(hay).includes(norm(needle));
}

function allTokensIn(text, tokens) {
  if (!tokens?.length) return false;
  const t = norm(text);
  return tokens.every((tok) => t.includes(norm(tok)));
}

function tokenMatchesRow(tok, row) {
  if (tokenMatchesRowByAcode(tok, row)) return true;
  if (isNumericSearchToken(tok)) {
    for (const col of ["SIZE1", "SIZE2", "SIZE3"]) {
      if (fieldContains(row[col], tok)) return true;
    }
  }
  return false;
}

/**
 * @param {object[]} rows
 * @param {{ query?: string, slots?: object, limit?: number }} opts
 */
export function scoreAndRankRows(rows, opts = {}) {
  const { query = "", slots = {}, limit = 30 } = opts;
  const q = norm(query);
  let textTokens = searchTokensFromSlots(slots);
  if (!textTokens.length && query) {
    textTokens = query
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((tok) => tok && !/^(hq|syp|ค้นหา|หา)$/i.test(tok));
  }

  const scored = (rows || []).map((row) => {
    let score = 0;
    const reasons = [];
    const bcode = norm(row.BCODE);
    const pcode = norm(row.PCODE);
    const mcode = norm(row.MCODE);
    const qCompact = q.replace(/\s+/g, "");

    if (slots.bcode && bcode === norm(slots.bcode)) {
      score += 100;
      reasons.push("bcode_exact");
    } else if (qCompact && bcode === qCompact) {
      score += 100;
      reasons.push("bcode_exact_query");
    }

    if (slots.pcode_or_mcode) {
      const pm = norm(slots.pcode_or_mcode);
      if (pcode === pm || mcode === pm) {
        score += 80;
        reasons.push("pcode_mcode_exact");
      }
    }

    if (slots.bcode && bcode.startsWith(norm(slots.bcode))) {
      score += 60;
      reasons.push("bcode_prefix");
    } else if (qCompact && bcode.startsWith(qCompact)) {
      score += 60;
      reasons.push("bcode_prefix_query");
    }

    if (textTokens.length && allTokensIn(row.DESCR, textTokens)) {
      score += 40;
      reasons.push("descr_all_tokens");
    } else if (textTokens.some((t) => fieldContains(row.DESCR, t))) {
      score += 20;
      reasons.push("descr_partial");
    }

    const modelHits = textTokens.filter((t) => fieldContains(row.MODEL, t));
    if (modelHits.length) {
      const numericModel = modelHits.some((t) => isNumericSearchToken(t));
      score += numericModel ? 45 : 20;
      reasons.push(numericModel ? "model_numeric" : "model_match");
    }

    const pcodeHits = textTokens.filter((t) => fieldContains(row.PCODE, t) || fieldContains(row.MCODE, t));
    if (pcodeHits.length) {
      score += 15;
      reasons.push("pcode_mcode_partial");
    }

    if (textTokens.length && textTokens.every((t) => tokenMatchesRow(t, row))) {
      score += 35;
      reasons.push("all_tokens_match");
    }
    if (slots.model && fieldContains(row.MODEL, slots.model)) {
      score += 20;
      reasons.push("model_slot");
    }

    if (slots.brand && fieldContains(row.BRAND, slots.brand)) {
      score += 20;
      reasons.push("brand_slot");
    } else if (textTokens.some((t) => fieldContains(row.BRAND, t))) {
      score += 15;
      reasons.push("brand_partial");
    }

    for (const [slotKey, col] of [
      ["size1", "SIZE1"],
      ["size2", "SIZE2"],
      ["size3", "SIZE3"],
    ]) {
      if (slots[slotKey] != null && String(slots[slotKey]).trim() !== "") {
        if (norm(row[col]) === norm(slots[slotKey])) {
          score += 30;
          reasons.push(`${col}_exact`);
        }
      }
    }

    if (slots.code1 && norm(row.CODE1) === norm(slots.code1)) {
      score += 25;
      reasons.push("code1_match");
    }

    if (numQty(row.QTYOH2) > 0) {
      score += 10;
      reasons.push("in_stock");
    }

    return { row, score, reasons };
  });

  scored.sort((a, b) => b.score - a.score || norm(a.row.BCODE).localeCompare(norm(b.row.BCODE)));

  const top = scored.slice(0, limit);
  return {
    rows: top.map((s) => s.row),
    scores: top.map((s) => ({ bcode: s.row.BCODE, score: s.score, reasons: s.reasons })),
  };
}
