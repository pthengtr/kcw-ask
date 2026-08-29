/**
 * ICMAS short names — primarily stored in ACODE (alias code).
 * Examples: นมฮPT, นมคBC, นมกCT, ลป, ยอร
 * DESCR often repeats dotted forms (น.ม.ฮ.) — kept as fallback.
 */

/** Oil/fluid type prefix in ACODE + DESCR. */
export const ICMAS_OIL_TYPES = {
  นมค: {
    label: "น้ำมันเครื่อง",
    descrPatterns: ["น.ม.ค", "นมค", "น้ำมันเครื่อง"],
    categoryCode: "22",
  },
  นมก: {
    label: "น้ำมันเกียร์",
    descrPatterns: ["น.ม.ก", "นมก", "น้ำมันเกียร์"],
    categoryCode: "22",
  },
  นมฮ: {
    label: "น้ำมันไฮดรอลิค",
    descrPatterns: ["น.ม.ฮ", "นมฮ", "ไฮดรอลิค", "น้ำมันไฮ"],
    categoryCode: "22",
  },
  นมเบรค: {
    label: "น้ำมันเบรค",
    descrPatterns: ["น.ม.เบรค", "นมเบรค", "น้ำมันเบรค"],
    categoryCode: "22",
  },
  นมฟ: {
    label: "น้ำมันเบรค",
    descrPatterns: ["น.ม.ฟ", "นมฟ"],
    categoryCode: "22",
  },
};

/** Brand token → suffix used at end of oil ACODE (Latin letters). */
const BRAND_ACODE_SUFFIX = {
  ptt: "PT",
  pt: "PT",
  พีทีที: "PT",
  บางจาก: "BC",
  bangchak: "BC",
  bc: "BC",
  castrol: "CT",
  คาสตrol: "CT",
  คาสตอล: "CT",
  คาสตรอล: "CT",
  shell: "SH",
  เชลล์: "SH",
  valvoline: "VV",
  วาโวลีน: "VV",
  caltex: "CA",
  เดโล่: "CA",
  bp: "BP",
  pasar: "PZ",
  เพาซ่าร์: "PZ",
  pz: "PZ",
  trane: "T",
  เทรน: "T",
  pn: "PN",
  ptn: "PN",
};

export const ICMAS_TEXT_SEARCH_COLS = [
  "DESCR",
  "MODEL",
  "BRAND",
  "PCODE",
  "MCODE",
  "BCODE",
  "ACODE",
  "XCODE",
];

export function normalizeShortNameToken(tok) {
  return String(tok || "")
    .trim()
    .replace(/\./g, "")
    .toLowerCase();
}

/** @returns {typeof ICMAS_OIL_TYPES[string] | null} */
export function matchOilType(tok) {
  const key = normalizeShortNameToken(tok);
  return ICMAS_OIL_TYPES[key] || null;
}

/** @deprecated use matchOilType */
export function matchShortName(tok) {
  return matchOilType(tok);
}

/** @deprecated use expandTokenSearch */
export function descrPatternsForShortName(tok) {
  const hit = matchOilType(tok);
  if (!hit) return null;
  return [...new Set([hit.label, ...hit.descrPatterns])];
}

export function brandAcodeSuffix(tok) {
  const key = normalizeShortNameToken(tok);
  return BRAND_ACODE_SUFFIX[key] || null;
}

/**
 * Search expansion for one token — ACODE-first, DESCR fallback for oil types.
 * @returns {{ literal: string, acodePrefix?: string, acodeContains?: string[], descr?: string[] }}
 */
export function expandTokenSearch(tok) {
  const raw = String(tok || "").trim();
  if (!raw) return { literal: raw };

  const out = { literal: raw };
  const oil = matchOilType(raw);
  if (oil) {
    out.acodePrefix = normalizeShortNameToken(raw);
    out.descr = [...new Set([oil.label, ...oil.descrPatterns])];
  }

  const brandSuffix = brandAcodeSuffix(raw);
  if (brandSuffix) {
    out.acodeContains = [brandSuffix];
  }

  return out;
}

/**
 * @param {string} tok
 * @param {(s: string) => string} quote
 * @returns {string[]}
 */
export function tokenMatchSqlParts(tok, quote) {
  const exp = expandTokenSearch(tok);
  const parts = [];
  const q = quote(exp.literal);

  for (const col of ICMAS_TEXT_SEARCH_COLS) {
    parts.push(`${col} LIKE N'%${q}%'`);
  }

  if (exp.acodePrefix) {
    const p = quote(exp.acodePrefix);
    parts.push(`LTRIM(RTRIM(COALESCE(ACODE,''))) LIKE N'${p}%'`);
  }

  for (const frag of exp.acodeContains || []) {
    const f = quote(frag);
    parts.push(`LTRIM(RTRIM(COALESCE(ACODE,''))) LIKE N'%${f}%'`);
    parts.push(`UPPER(LTRIM(RTRIM(COALESCE(ACODE,'')))) LIKE N'%${f}%'`);
  }

  for (const d of exp.descr || []) {
    parts.push(`DESCR LIKE N'%${quote(d)}%'`);
  }

  return [...new Set(parts)];
}

/** @param {string} tok @param {object} row */
export function tokenMatchesRow(tok, row) {
  const exp = expandTokenSearch(tok);
  const lit = exp.literal.toLowerCase();

  for (const col of ICMAS_TEXT_SEARCH_COLS) {
    if (String(row[col] ?? "")
      .toLowerCase()
      .includes(lit)) {
      return true;
    }
  }

  const acode = String(row.ACODE ?? "").trim();
  if (exp.acodePrefix && acode.toLowerCase().startsWith(exp.acodePrefix)) return true;

  const acodeUp = acode.toUpperCase();
  for (const frag of exp.acodeContains || []) {
    if (acodeUp.includes(String(frag).toUpperCase())) return true;
  }

  for (const d of exp.descr || []) {
    if (String(row.DESCR ?? "")
      .toLowerCase()
      .includes(d.toLowerCase())) {
      return true;
    }
  }

  return false;
}

/** Apply category hint when an oil ACODE prefix is used. */
export function applyShortNameHints(slots) {
  if (!slots?.text) return slots;
  const tokens = String(slots.text).split(/\s+/).filter(Boolean);
  for (const tok of tokens) {
    const hit = matchOilType(tok);
    if (hit?.categoryCode && !slots.category_code) {
      slots.category_code = hit.categoryCode;
    }
  }
  return slots;
}
