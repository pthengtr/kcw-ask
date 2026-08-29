/**
 * ICMAS column labels — from kcw-docs/dictionaries/kcw-icmas-data-dictionary.md
 */

export const CODE1_LABELS = {
  A: "ถ่าน",
  C: "ซีล",
  D: "บู๊ช",
  E: "ลูกปืนเข็ม/กรงนก",
  F: "ไส้กรองอากาศ",
  G: "ยอยกากบาท",
  I: "ลูกปืนตลับ / ลูกปืน",
  K: "จานคลัช",
  L: "สายอ่อน",
  O: "โอริง",
  P: "ไส้กรองน้ำมันเครื่อง",
  Q: "ลูกหมาก",
  R: "ลูกยาง",
};

/** SIZE slot labels by CODE1 — docs §7 */
export const SIZE_LABELS_BY_CODE1 = {
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
  Q: ["ขนาด 1", "ขนาด 2", "ขนาด 3"],
  R: ["ขนาด 1", "ขนาด 2", "ขนาด 3"],
};

const BASE_COLUMNS = {
  BCODE: { key: "BCODE", labelTh: "รหัสสินค้า", labelEn: "BCODE", shortTh: "รหัส" },
  DESCR: { key: "DESCR", labelTh: "ชื่อสินค้า", labelEn: "DESCR", shortTh: "ชื่อ" },
  MODEL: { key: "MODEL", labelTh: "รุ่น/แบบ", labelEn: "MODEL", shortTh: "รุ่น" },
  BRAND: { key: "BRAND", labelTh: "ยี่ห้อ", labelEn: "BRAND", shortTh: "ยี่ห้อ" },
  CODE1: { key: "CODE1", labelTh: "ประเภทชิ้นส่วน", labelEn: "CODE1", shortTh: "ประเภท" },
  SIZE1: { key: "SIZE1", labelTh: "ขนาด 1", labelEn: "SIZE1", shortTh: "ขนาด 1" },
  SIZE2: { key: "SIZE2", labelTh: "ขนาด 2", labelEn: "SIZE2", shortTh: "ขนาด 2" },
  SIZE3: { key: "SIZE3", labelTh: "ขนาด 3", labelEn: "SIZE3", shortTh: "ขนาด 3" },
  PCODE: { key: "PCODE", labelTh: "เบอร์แท้", labelEn: "PCODE", shortTh: "เบอร์แท้" },
  MCODE: { key: "MCODE", labelTh: "เบอร์โรงงาน", labelEn: "MCODE", shortTh: "เบอร์โรงงาน" },
  QTYOH2: { key: "QTYOH2", labelTh: "คงเหลือ", labelEn: "QTYOH2", shortTh: "คงเหลือ" },
  PRICE1: { key: "PRICE1", labelTh: "ราคา1", labelEn: "PRICE1", shortTh: "ราคา" },
  LOCATION1: { key: "LOCATION1", labelTh: "ที่เก็บ", labelEn: "LOCATION1", shortTh: "ที่เก็บ" },
};

export const SEARCH_RESULT_COLUMNS = [
  "BCODE",
  "DESCR",
  "MODEL",
  "BRAND",
  "CODE1",
  "SIZE1",
  "SIZE2",
  "SIZE3",
  "PCODE",
  "MCODE",
  "QTYOH2",
  "PRICE1",
  "LOCATION1",
].map((k) => ({ ...BASE_COLUMNS[k] }));

export function getSizeLabels(code1) {
  const letter = String(code1 || "")
    .trim()
    .toUpperCase();
  const labels = SIZE_LABELS_BY_CODE1[letter] || ["ขนาด 1", "ขนาด 2", "ขนาด 3"];
  return labels;
}

export function formatColumnHeader(key, code1) {
  const base = BASE_COLUMNS[key];
  if (!base) return key;
  if (key === "SIZE1") {
    const [a] = getSizeLabels(code1);
    return a ? `${a} (${key})` : base.labelTh;
  }
  if (key === "SIZE2") {
    const [, b] = getSizeLabels(code1);
    return b ? `${b} (${key})` : base.labelTh;
  }
  if (key === "SIZE3") {
    const [, , c] = getSizeLabels(code1);
    return c ? `${c} (${key})` : base.labelTh;
  }
  return base.labelTh;
}

export function getColumnsForRow(code1) {
  const sizeLabels = getSizeLabels(code1);
  return SEARCH_RESULT_COLUMNS.map((col) => {
    if (col.key === "SIZE1" && sizeLabels[0]) return { ...col, labelTh: sizeLabels[0], shortTh: sizeLabels[0] };
    if (col.key === "SIZE2" && sizeLabels[1]) return { ...col, labelTh: sizeLabels[1], shortTh: sizeLabels[1] };
    if (col.key === "SIZE3" && sizeLabels[2]) return { ...col, labelTh: sizeLabels[2], shortTh: sizeLabels[2] };
    if (col.key === "CODE1") {
      const letter = String(code1 || "").trim().toUpperCase();
      const thai = CODE1_LABELS[letter];
      return thai ? { ...col, labelTh: `ประเภท (${thai})` } : col;
    }
    return { ...col };
  });
}

export function code1Label(code1) {
  const letter = String(code1 || "")
    .trim()
    .toUpperCase();
  return CODE1_LABELS[letter] || letter || "";
}

export function buildSearchResultPayload(rows, { message, site, scores, imageMap } = {}) {
  const scoreMap = new Map((scores || []).map((s) => [s.bcode, s]));
  const images = imageMap instanceof Map ? imageMap : new Map();
  return {
    message,
    site,
    count: rows.length,
    rows: rows.map((row) => {
      const code1 = row.CODE1;
      const columns = getColumnsForRow(code1);
      const scoreHit = scoreMap.get(row.BCODE);
      const bcode = String(row.BCODE || "").trim();
      const brand = String(row.BRAND || "").trim();
      const pcode = String(row.PCODE || "").trim();
      const mcode = String(row.MCODE || "").trim();
      const fields = {};
      for (const col of columns) {
        const val = row[col.key];
        if (val != null && String(val).trim() !== "") {
          fields[col.key] = {
            value: String(val).trim(),
            labelTh: col.labelTh,
            shortTh: col.shortTh,
          };
        }
      }
      return {
        bcode,
        descr: row.DESCR || "",
        brand,
        pcode,
        mcode,
        imageUrl: images.get(bcode) || null,
        code1: code1 || "",
        code1Label: code1Label(code1),
        fields,
        columns: columns.map((c) => ({ key: c.key, labelTh: c.labelTh, shortTh: c.shortTh })),
        score: scoreHit?.score,
        scoreReasons: scoreHit?.reasons,
      };
    }),
  };
}
