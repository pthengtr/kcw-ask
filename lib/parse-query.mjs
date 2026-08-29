/**
 * Product query parser — ported from kcw-api/src/parts9_explorer/query.py (product path only).
 */

const CODE1_LABELS = {
  A: "ถ่าน",
  C: "ซีล",
  D: "บู๊ช",
  E: "ลูกปืนเข็ม/กรงนก",
  F: "ไส้กรองอากาศ",
  G: "ยอยกากบาท",
  I: "ลูกปืนตลับ",
  K: "จานคลัช",
  L: "สายอ่อน",
  O: "โอริง",
  P: "ไส้กรองน้ำมันเครื่อง",
  Q: "ลูกหมาก",
  R: "ลูกยาง",
};

const CODE1_FROM_THAI = {
  ถ่าน: "A",
  ซีล: "C",
  ซีลยาง: "C",
  บู๊ช: "D",
  บุช: "D",
  "ลูกปืนเข็ม": "E",
  กรงนก: "E",
  ไส้กรองอากาศ: "F",
  ยอย: "G",
  ยอยกากบาท: "G",
  ลูกปืน: "I",
  ลูกปืนตลับ: "I",
  จานคลัช: "K",
  สายอ่อน: "L",
  โอริง: "O",
  "o-ring": "O",
  oring: "O",
  ไส้กรองน้ำมัน: "P",
  ลูกหมาก: "Q",
  ลูกยาง: "R",
};

const FIELD_PREFIX = /^(oem|pcode|mcode|เบอร์แท้|เบอร์โรงงาน|code1|ประเภท)[:\s]+/i;
const BCODE_LIKE = /^[0-9]{4,}[A-Za-z0-9]*$/;
const CODE1_TOKEN = /^[A-Za-z]$/;

function detectSite(raw) {
  if (/syp|สาขา|ร้าน/i.test(raw)) return "syp";
  if (/hq|สำนักงาน|ออฟฟิศ/i.test(raw)) return "hq";
  return "hq";
}

function extractCategoryPrefix(raw) {
  const m = raw.match(/^\s*(\d{2})(?!\d)/);
  if (!m) return { categoryCode: null, rest: raw };
  return {
    categoryCode: m[1],
    rest: raw.slice(m.index + m[0].length).trim(),
  };
}

/** Common Thai typos for CODE1 keywords */
const CODE1_TYPOS = {
  ซล: "C",
  ซี: "C",
  โอ: "O",
  บุช: "D",
  บูช: "D",
};

/** Numbers that are ICMAS dimensions (mm) vs model/tractor codes */
function isLikelyDimension(tok, code1) {
  if (!/^\d+(?:\.\d+)?$/.test(tok)) return false;
  const n = parseFloat(tok);
  if (!Number.isFinite(n)) return false;
  // Tractor / part model numbers: 6640, 6610, 6207 (when not bearing-only query)
  if (code1 !== "I" && n >= 1000 && Number.isInteger(n)) return false;
  // Typical seal/bearing dimensions
  if (code1 && n > 0 && n < 1000) return true;
  // Bare small number without code1 — may be size
  if (!code1 && n > 0 && n < 500) return true;
  return false;
}

function stripSizePatterns(text) {
  return String(text || "")
    .replace(/(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/gi, " ")
    .replace(/(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/gi, " ")
    .replace(/(?:size[123]|ใน|นอก|หนา|สูง|ยาว)\s*[:=]?\s*\d+(?:\.\d+)?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSizes(raw) {
  const sizes = [];
  let text = raw;

  const labeled = {
    size1: text.match(/(?:size1|ใน|id|i\.?d\.?)\s*[:=]?\s*(\d+(?:\.\d+)?)/i),
    size2: text.match(/(?:size2|นอก|od|o\.?d\.?)\s*[:=]?\s*(\d+(?:\.\d+)?)/i),
    size3: text.match(/(?:size3|หนา|สูง|ยาว|width|thick)\s*[:=]?\s*(\d+(?:\.\d+)?)/i),
  };
  if (labeled.size1) sizes[0] = labeled.size1[1];
  if (labeled.size2) sizes[1] = labeled.size2[1];
  if (labeled.size3) sizes[2] = labeled.size3[1];

  if (!sizes.length) {
    const triple = text.match(/(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/i);
    const pair = text.match(/(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/i);
    if (triple) {
      sizes.push(triple[1], triple[2], triple[3]);
    } else if (pair) {
      sizes.push(pair[1], pair[2]);
    }
  }

  return sizes.filter(Boolean).slice(0, 3);
}

/**
 * @param {string} raw
 * @returns {{
 *   raw: string,
 *   kind: string,
 *   site: string,
 *   bcodePrefix: string|null,
 *   code1: string|null,
 *   sizes: string[],
 *   textTerms: string[],
 *   categoryCode: string|null,
 *   pcodeOrMcode: string|null,
 * }}
 */
export function parseProductQuery(rawInput) {
  const site = detectSite(rawInput);
  let q = String(rawInput || "").trim();
  if (!q) {
    return {
      raw: "",
      kind: "product",
      site,
      bcodePrefix: null,
      code1: null,
      sizes: [],
      textTerms: [],
      categoryCode: null,
      pcodeOrMcode: null,
    };
  }

  let field = null;
  const fm = q.match(FIELD_PREFIX);
  if (fm) {
    field = fm[1].toLowerCase();
    q = q.slice(fm[0].length).trim();
  }

  const { categoryCode, rest: afterCategory } = extractCategoryPrefix(q);
  q = afterCategory || q;

  const compact = q.replace(/\s+/g, "");
  if (field && ["oem", "pcode", "mcode", "เบอร์แท้", "เบอร์โรงงาน"].includes(field) && q) {
    return {
      raw: q,
      kind: "product",
      site,
      bcodePrefix: null,
      code1: null,
      sizes: [],
      textTerms: [q],
      categoryCode,
      pcodeOrMcode: q,
    };
  }

  if (field === "code1" || field === "ประเภท") {
    const letter = q.trim().toUpperCase().charAt(0);
    if (CODE1_LABELS[letter]) {
      return {
        raw: q,
        kind: "product",
        site,
        bcodePrefix: null,
        code1: letter,
        sizes: [],
        textTerms: [],
        categoryCode,
        pcodeOrMcode: null,
      };
    }
  }

  if (BCODE_LIKE.test(compact)) {
    return {
      raw: q,
      kind: "product",
      site,
      bcodePrefix: compact,
      code1: null,
      sizes: [],
      textTerms: [],
      categoryCode,
      pcodeOrMcode: null,
    };
  }

  const sizesFromPattern = extractSizes(q);
  q = stripSizePatterns(q);
  const tokens = q.split(/\s+/).filter(Boolean);
  let code1 = null;
  const sizes = [...sizesFromPattern];
  const textTerms = [];

  const thaiKeys = Object.keys(CODE1_FROM_THAI).sort((a, b) => b.length - a.length);
  for (const tok of tokens) {
    const low = tok.toLowerCase();
    if (low === "ขนาด" || low === "size") continue;

    let matchedThai = false;
    if (CODE1_TYPOS[tok]) {
      code1 = CODE1_TYPOS[tok];
      if (tok === "ซล") textTerms.push("ซีล");
      matchedThai = true;
    }
    for (const kw of thaiKeys) {
      if (!matchedThai && (tok === kw || low === kw.toLowerCase())) {
        code1 = CODE1_FROM_THAI[kw];
        matchedThai = true;
        break;
      }
    }
    if (matchedThai) continue;

    if (CODE1_TOKEN.test(tok) && CODE1_LABELS[tok.toUpperCase()]) {
      code1 = tok.toUpperCase();
      continue;
    }
    if (/^-?\d+(?:\.\d+)?$/.test(tok)) {
      if (code1 === "I" && /^\d{3,5}$/.test(tok)) {
        textTerms.push(tok);
        continue;
      }
      // "วาวไอ 6640" — model number after a keyword, not SIZE1
      if (textTerms.length > 0) {
        textTerms.push(tok);
        continue;
      }
      if (/^\d{4,6}$/.test(tok)) {
        textTerms.push(tok);
        continue;
      }
      if (isLikelyDimension(tok, code1)) {
        if (!sizes.includes(tok)) sizes.push(tok);
        continue;
      }
      textTerms.push(tok);
      continue;
    }
    textTerms.push(tok);
  }

  return {
    raw: q,
    kind: "product",
    site,
    bcodePrefix: compact && /^\d+$/.test(compact) && compact.length >= 4 ? compact : null,
    code1,
    sizes: sizes.slice(0, 3),
    textTerms,
    categoryCode,
    pcodeOrMcode: null,
  };
}

/**
 * Merge parsed query into kcw-ask slot object.
 * @param {object} slots
 * @param {ReturnType<typeof parseProductQuery>} parsed
 */
/**
 * Tokens to AND in SQL/scoring — keeps model numbers (6640, 6207) but drops
 * size triples already in size1/2/3 slots.
 */
export function searchTokensFromSlots(slots) {
  const raw = String(slots?.text || "").trim();
  if (!raw) return [];
  const sizeVals = new Set(
    [slots?.size1, slots?.size2, slots?.size3]
      .filter((v) => v != null && String(v).trim() !== "")
      .map((v) => String(v).trim())
  );
  return raw
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => {
      if (!t) return false;
      if (/[x×*]/i.test(t) && /^\d+(?:\.\d+)?(?:[x×*]\d+)+$/i.test(t)) return false;
      if (sizeVals.has(t)) return false;
      return true;
    });
}

export function isNumericSearchToken(tok) {
  return /^\d+(?:\.\d+)?$/.test(String(tok || "").trim());
}

export function mergeParsedIntoSlots(slots, parsed) {
  if (!parsed) return slots;
  if (parsed.site) slots.site = parsed.site;
  if (parsed.bcodePrefix) {
    if (/^\d{6,12}$/.test(parsed.bcodePrefix)) {
      slots.intent = "product_by_code";
      slots.bcode = parsed.bcodePrefix;
    } else {
      slots.bcode = parsed.bcodePrefix;
    }
  }
  if (parsed.code1) slots.code1 = parsed.code1;
  if (parsed.categoryCode) slots.category_code = parsed.categoryCode;
  if (parsed.pcodeOrMcode) slots.pcode_or_mcode = parsed.pcodeOrMcode;
  if (parsed.sizes[0] != null) slots.size1 = parsed.sizes[0];
  if (parsed.sizes[1] != null) slots.size2 = parsed.sizes[1];
  if (parsed.sizes[2] != null) slots.size3 = parsed.sizes[2];
  if (parsed.textTerms.length) {
    slots.text = parsed.textTerms.join(" ");
  } else if (parsed.sizes.length || parsed.code1) {
    slots.text = null;
  }
  return slots;
}

export { CODE1_FROM_THAI, CODE1_LABELS };
