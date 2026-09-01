/**
 * Mobile-friendly search result HTML (browser) — card layout, DOM-safe strings.
 */

const DEFAULT_LABELS = {
  BCODE: "รหัสสินค้า",
  DESCR: "ชื่อสินค้า",
  MODEL: "รุ่น/แบบ",
  BRAND: "ยี่ห้อ",
  CODE1: "ประเภทชิ้นส่วน",
  SIZE1: "ขนาด 1",
  SIZE2: "ขนาด 2",
  SIZE3: "ขนาด 3",
  PCODE: "เบอร์แท้",
  MCODE: "เบอร์โรงงาน",
  QTYOH2: "คงเหลือ",
  PRICE1: "ราคา1",
  LOCATION1: "ที่เก็บ",
};

const CODE1_TH = {
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

const SIZE_BY_CODE1 = {
  A: ["สูง", "กว้าง", null],
  C: ["ใน", "นอก", "หนา"],
  D: ["ใน", "นอก", "หนา"],
  E: ["ใน", "นอก", "หนา"],
  F: ["ใน", "นอก", "สูง"],
  G: ["ปลอก", "ยาว", null],
  I: ["ใน", "นอก", "หนา"],
  K: ["ยาว(นิ้ว)", "ฟัน", "ขนาดรูเฟือง"],
  L: ["หัวสาย 1", "หัวสาย 2", "ยาว"],
  O: ["ใน", "หนา", null],
  P: ["ใน", "นอก", "สูง"],
};

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function hasValue(v) {
  return v != null && String(v).trim() !== "";
}

function formatPrice(v) {
  const n = parseFloat(String(v || "").replace(/,/g, ""));
  if (!Number.isFinite(n)) return esc(v || "");
  return esc(n.toLocaleString("th-TH", { maximumFractionDigits: 2 }));
}

function columnMap(columns) {
  const map = new Map();
  for (const col of columns || []) {
    if (col?.key) map.set(col.key, col);
  }
  return map;
}

function labelFor(key, code1, cols) {
  const hit = cols?.get(key);
  if (hit?.shortTh) return hit.shortTh;
  if (hit?.labelTh) return hit.labelTh;
  if (key === "SIZE1" || key === "SIZE2" || key === "SIZE3") {
    const idx = Number(key.slice(-1)) - 1;
    const letter = String(code1 || "")
      .trim()
      .toUpperCase();
    const sizes = SIZE_BY_CODE1[letter];
    if (sizes?.[idx]) return sizes[idx];
  }
  return DEFAULT_LABELS[key] || key;
}

function rowValue(row, key) {
  if (row.fields?.[key]?.value != null) return row.fields[key].value;
  return row[key];
}

function scoreFor(scores, bcode) {
  if (!scores?.length || !bcode) return null;
  const hit = scores.find((s) => String(s.bcode) === String(bcode));
  return hit?.score ?? null;
}

function chip(label, value) {
  if (!hasValue(value)) return "";
  return `<span class="search-chip"><span class="search-chip-label">${esc(label)}</span> ${esc(value)}</span>`;
}

function normalizeRow(row, scores) {
  const bcode = row.bcode ?? row.BCODE ?? "";
  const code1 = row.code1 ?? row.CODE1 ?? "";
  const code1Th = row.code1Label ?? CODE1_TH[String(code1).trim().toUpperCase()] ?? "";
  return {
    bcode,
    descr: row.descr ?? row.DESCR ?? "",
    brand: row.brand ?? rowValue(row, "BRAND"),
    pcode: row.pcode ?? rowValue(row, "PCODE"),
    mcode: row.mcode ?? rowValue(row, "MCODE"),
    imageUrl: row.imageUrl ?? null,
    code1: String(code1).trim(),
    code1Th,
    model: rowValue(row, "MODEL"),
    size1: rowValue(row, "SIZE1"),
    size2: rowValue(row, "SIZE2"),
    size3: rowValue(row, "SIZE3"),
    sizeDisplay: row.sizeDisplay ?? "",
    qty: rowValue(row, "QTYOH2") ?? rowValue(row, "QTYOH1"),
    price: rowValue(row, "PRICE1"),
    location: rowValue(row, "LOCATION1"),
    score: row.score ?? scoreFor(scores, bcode),
    rowColumns: row.columns,
  };
}

function columnsForRow(row, globalColumns) {
  if (row.rowColumns?.length) return columnMap(row.rowColumns);
  return globalColumns;
}

function codeRow(label, value, mono = false) {
  if (!hasValue(value)) return "";
  const cls = mono ? " search-code-value mono" : " search-code-value";
  return `<div class="search-code-row"><dt>${esc(label)}</dt><dd class="${cls.trim()}">${esc(value)}</dd></div>`;
}

function renderCodes(item, cols) {
  const code1 = item.code1;
  const rows = [
    codeRow(labelFor("BRAND", code1, cols), item.brand),
    codeRow(labelFor("PCODE", code1, cols), item.pcode, true),
    codeRow(labelFor("MCODE", code1, cols), item.mcode, true),
  ].filter(Boolean);
  if (!rows.length) return "";
  return `<dl class="search-codes">${rows.join("")}</dl>`;
}

function renderImage(url, descr) {
  if (!hasValue(url)) return "";
  const alt = hasValue(descr) ? esc(descr) : "";
  return `<figure class="search-thumb"><img src="${esc(url)}" alt="${alt}" loading="lazy" decoding="async" /></figure>`;
}

function renderCard(item, globalColumns) {
  const cols = columnsForRow(item, globalColumns);
  const code1 = item.code1;

  const chips = [
    chip(labelFor("MODEL", code1, cols), item.model),
    item.code1
      ? chip(
          labelFor("CODE1", code1, cols),
          item.code1Th ? `${item.code1} · ${item.code1Th}` : item.code1
        )
      : "",
    item.sizeDisplay
      ? chip("ขนาด", item.sizeDisplay)
      : [
          chip(labelFor("SIZE1", code1, cols), item.size1),
          chip(labelFor("SIZE2", code1, cols), item.size2),
          chip(labelFor("SIZE3", code1, cols), item.size3),
        ].join(""),
  ]
    .filter(Boolean)
    .join("");

  const codes = renderCodes(item, cols);

  const footer = [
    hasValue(item.qty)
      ? `<span class="search-foot-qty">${esc(labelFor("QTYOH2", code1, cols))}: <strong>${esc(item.qty)}</strong></span>`
      : "",
    hasValue(item.price)
      ? `<span class="search-foot-price">${esc(labelFor("PRICE1", code1, cols))}: ${formatPrice(item.price)}</span>`
      : "",
    hasValue(item.location)
      ? `<span class="search-foot-loc">${esc(labelFor("LOCATION1", code1, cols))}: ${esc(item.location)}</span>`
      : "",
  ]
    .filter(Boolean)
    .join('<span class="search-foot-sep" aria-hidden="true"> · </span>');

  const scoreBadge =
    item.score != null
      ? `<span class="search-score" title="คะแนนจัดอันดับ">${esc(item.score)}</span>`
      : "";

  return `<article class="search-card" data-bcode="${esc(item.bcode)}">
  <header class="search-card-head">
    <span class="search-bcode">${esc(item.bcode)}</span>
    ${scoreBadge}
  </header>
  <div class="search-card-body">
    ${renderImage(item.imageUrl, item.descr)}
    <div class="search-card-main">
      <p class="search-descr">${esc(item.descr || "—")}</p>
      ${codes}
      ${chips ? `<div class="search-chips">${chips}</div>` : ""}
      ${footer ? `<footer class="search-card-foot">${footer}</footer>` : ""}
    </div>
  </div>
</article>`;
}

/**
 * @param {{ rows?: object[], message?: string, site?: string, columns?: object[], scores?: object[] }} opts
 * @returns {string}
 */
export function renderSearchResults({ rows, message, site, columns, scores } = {}) {
  const list = rows || [];
  const globalColumns = columnMap(columns);

  if (!list.length) {
    const q = esc(message || "");
    const branch = site ? ` (${esc(String(site).toUpperCase())})` : "";
    return `<p class="search-empty">ไม่พบสินค้าที่ตรงกับ「${q}」${branch}</p>`;
  }

  const siteLabel = site ? esc(String(site).toUpperCase()) : "";
  const head = `<div class="search-summary">
  <p class="search-count">พบ <strong>${list.length}</strong> รายการ</p>
  ${message ? `<p class="search-query">「${esc(message)}」${siteLabel ? ` · ${siteLabel}` : ""}</p>` : ""}
</div>`;

  const cards = list
    .map((row) => renderCard(normalizeRow(row, scores), globalColumns))
    .join("\n");

  return `${head}<div class="search-list">${cards}</div>`;
}
