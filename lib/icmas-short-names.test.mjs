import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  matchOilType,
  brandAcodeSuffix,
  expandTokenSearch,
  applyShortNameHints,
  normalizeShortNameToken,
  tokenMatchSqlParts,
  tokenMatchesRow,
} from "./icmas-short-names.mjs";

describe("icmas ACODE short names", () => {
  it("matches oil type tokens", () => {
    assert.ok(matchOilType("นมฮ"));
    assert.ok(matchOilType("น.ม.ก."));
  });

  it("expands oil token with ACODE prefix", () => {
    const exp = expandTokenSearch("นมฮ");
    assert.equal(exp.acodePrefix, "นมฮ");
    assert.ok(exp.descr?.includes("น.ม.ฮ"));
  });

  it("maps brand tokens to ACODE suffix", () => {
    assert.equal(brandAcodeSuffix("ptt"), "PT");
    assert.equal(brandAcodeSuffix("คาสตrol"), "CT");
  });

  it("SQL parts include ACODE for oil and brand", () => {
    const oilSql = tokenMatchSqlParts("นมฮ", (s) => s);
    assert.ok(oilSql.some((p) => p.includes("ACODE") && p.includes("นมฮ%")));

    const brandSql = tokenMatchSqlParts("ptt", (s) => s);
    assert.ok(brandSql.some((p) => p.includes("ACODE") && p.includes("%PT%")));
  });

  it("tokenMatchesRow hits ACODE column", () => {
    assert.ok(
      tokenMatchesRow("นมฮ", {
        ACODE: "นมฮPT",
        DESCR: "x",
        BRAND: "PTT",
      })
    );
    assert.ok(
      tokenMatchesRow("ptt", {
        ACODE: "นมฮPT",
        DESCR: "x",
        BRAND: "PTT",
      })
    );
  });

  it("applyShortNameHints sets category 22 for oil shorthand", () => {
    const slots = { text: "นมฮ ptt", category_code: null };
    applyShortNameHints(slots);
    assert.equal(slots.category_code, "22");
  });

  it("normalizes dotted oil shorthand", () => {
    assert.equal(normalizeShortNameToken("น.ม.ฮ."), "นมฮ");
  });
});
