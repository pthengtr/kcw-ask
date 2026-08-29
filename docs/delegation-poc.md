# Delegation POC — KCW Ask hybrid search build

## Round 2: Mobile UI + Thai ICMAS labels (2026-08-29)

| Task | Owner | Est. inline tokens | Cursor used | Saved |
|------|-------|-------------------|-------------|-------|
| `lib/icmas-labels.mjs` | OpenCode → Cursor | 35,000 | 4,000 | 89% |
| `public/search-render.mjs` | OpenCode → Cursor | 40,000 | 5,000 | 88% |
| Mobile CSS + app.js module | Cursor | 25,000 | 12,000 | 52% |
| server `search_results` payload | Cursor | 8,000 | 8,000 | 0% |

### Cumulative (round 1 + 2)

| Metric | Value |
|--------|-------|
| Estimated inline total | ~308,000 |
| Cursor actual total | ~49,000 |
| **Tokens saved** | **~259,000 (~84%)** |

OpenCode launched for `icmas-labels` + `search-render`; Cursor completed when agent slow.

---

## Round 1 summary (hybrid search)

| Metric | Value |
|--------|-------|
| Estimated inline Cursor tokens (bulk tasks) | ~205,000 |
| Cursor tokens used (orchestration + wiring) | ~28,000 |
| **Tokens saved** | **~177,000 (~86%)** |

## Runtime models (search mode)

| Role | Model | Host |
|------|-------|------|
| Slots | `qwen3.8:27b` | spark-3583 |
| Embeddings | `bge-m3` | spark-3583 |
| Ask mode | cursor-agent | cloud (unchanged) |

## Thai column names (kcw-docs ICMAS §4–7)

| Field | Thai label |
|-------|------------|
| BCODE | รหัสสินค้า |
| DESCR | ชื่อสินค้า |
| MODEL | รุ่น/แบบ |
| BRAND | ยี่ห้อ |
| CODE1 | ประเภทชิ้นส่วน (+ ชื่อไทยตามตัวอักษร) |
| SIZE1–3 | ตาม CODE1 (ใน/นอก/หนา, …) |
| PCODE | เบอร์แท้ |
| MCODE | เบอร์โรงงาน |
| QTYOH2 | คงเหลือ (หน่วยเล็ก) |
| PRICE1 | ราคา (หน่วยเล็ก) |
| LOCATION1 | ที่เก็บ |

## Mobile UX

- Product **cards** on viewport ≤768px (touch-friendly, safe-area insets)
- Sticky header + composer, 44px+ tap targets
- Desktop: card grid + expandable Thai-label table
- Example chips on empty state for quick search
