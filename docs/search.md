# KCW Ask — product search

Search mode turns a Thai/English message into PARTS9 `ICMAS` SQL, re-ranks results, and renders Thai column labels.

Flow: **rules + parse** → optional **slot LLM** → **SQL recall** → **heuristic score** → optional **embedding re-rank**.

## Query examples

| Query | What it matches |
|-------|-----------------|
| `22010585` | BCODE exact |
| `pcode:90915-YZZD1` | PCODE / MCODE |
| `ลูกปืน 6207` | CODE1 `I` + model number |
| `ลกปน นอก 72 หนา 17` | Bearing typo + labeled SIZE2/SIZE3 |
| `ซีล 31×46×7` | CODE1 `C` + size triple |
| `12 ลูกปืน 6207` | BCODE category prefix `12` |
| `นมฮ ptt` | ACODE `นมฮPT…` (hydraulic + PTT) |
| `นมค ptt` | ACODE `นมคPT…` (engine oil) |
| `นมก คาสตrol` | ACODE `นมกCT…` (gear oil + Castrol) |
| `ลป` | ACODE prefix / short name (e.g. ลูกปืน-related) |

## ICMAS fields used in search

| Field | Role in search |
|-------|----------------|
| `BCODE` | Product id; category = first 2 digits |
| `ACODE` | **Staff short name** — primary for shorthand (`นมฮPT`, `ลป`, `ยอร`, …) |
| `XCODE` | Extra spec code (e.g. viscosity `15W-40`); searched as text |
| `DESCR` | Full Thai description |
| `MODEL` | Model / pack spec |
| `BRAND` | Brand |
| `PCODE` / `MCODE` | เบอร์แท้ / เบอร์โรงงาน |
| `CODE1` | Part-type letter (ซีล, ลูกปืน, …) |
| `SIZE1`–`SIZE3` | Dimensions (meaning depends on `CODE1`) |

See [kcw-docs ICMAS dictionary](../../kcw-docs/dictionaries/kcw-icmas-data-dictionary.md) for field legends.

## ACODE short names (`lib/icmas-short-names.mjs`)

~115k HQ rows have `ACODE` populated. Staff use compact codes in POS and search:

| Pattern | Meaning | Example ACODE |
|---------|---------|---------------|
| `นมค` + brand | น้ำมันเครื่อง | `นมคPT`, `นมคBC` |
| `นมก` + brand | น้ำมันเกียร์ | `นมกCT`, `นมกPT` |
| `นมฮ` + brand | น้ำมันไฮดรอลิค | `นมฮPT`, `นมฮBC` |
| `ลป…` | ลูกปืน / related | `ลป`, `ลปก`, … |
| Other Thai prefixes | Part family shorthand | `ยอร`, `ปกฝ`, … |

Oil-type tokens also set **category `22`** (น้ำมัน/จารบี) when no other category is set.

Brand tokens map to ACODE suffixes (Latin): `ptt`→`PT`, `บางจาก`→`BC`, `คาสตrol`→`CT`, `shell`→`SH`, …

`DESCR` often repeats dotted forms (`น.ม.ฮ. ptt`) — kept as fallback when `ACODE` is empty.

## Parser (`lib/parse-query.mjs`)

- CODE1 from Thai keywords + typos (`ซล`→ซีล, `ลกปน`→ลูกปืน)
- Labeled sizes: `ใน` / `นอก` / `หนา` → SIZE1/2/3 (sparse — no inner diameter OK)
- `31×46×7`, `pcode:`, `oem:`, category prefix `12 …`

## Config (`.env`)

| Variable | Default | Purpose |
|----------|---------|---------|
| `SLOT_LLM_BASE_URL` | — | Local Ollama for slot fill |
| `SLOT_LLM_MODEL` | `qwen3.8:27b` | Slot model |
| `SLOT_LLM_ONLY` | auto | Skip OpenAI fallback when local set |
| `SEARCH_RECALL_LIMIT` | `100` | SQL TOP N |
| `SEARCH_RESULT_LIMIT` | `30` | Rows after re-rank |
| `SEARCH_EMBED_WEIGHT` | `0.35` | Hybrid embed blend |
| `SEARCH_DEBUG` | `false` | Score/slot debug in response |

## Tests

```bash
node --test lib/parse-query.test.mjs lib/icmas-short-names.test.mjs
```
