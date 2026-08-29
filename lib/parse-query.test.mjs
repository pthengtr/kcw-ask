import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseProductQuery,
  mergeParsedIntoSlots,
  searchTokensFromSlots,
  isNumericSearchToken,
} from "./parse-query.mjs";

describe("parseProductQuery", () => {
  it("detects bare BCODE", () => {
    const p = parseProductQuery("22010585");
    assert.equal(p.bcodePrefix, "22010585");
  });

  it("detects site syp", () => {
    const p = parseProductQuery("syp ซีล ใน31 นอก46 หนา7");
    assert.equal(p.site, "syp");
    assert.equal(p.code1, "C");
  });

  it("parses CODE1 from Thai", () => {
    const p = parseProductQuery("ลูกปืน 6207");
    assert.equal(p.code1, "I");
    assert.ok(p.sizes.includes("6207") || p.textTerms.includes("6207"));
  });

  it("parses size triple", () => {
    const p = parseProductQuery("ซีล 31x46x7");
    assert.equal(p.code1, "C");
    assert.deepEqual(p.sizes, ["31", "46", "7"]);
  });

  it("parses labeled sizes", () => {
    const p = parseProductQuery("โอริง ใน35 หนา3");
    assert.equal(p.code1, "O");
    assert.equal(p.sizes[0], "35");
    assert.equal(p.sizes[1], "3");
  });

  it("parses category prefix", () => {
    const p = parseProductQuery("12 ลูกปืน 6207");
    assert.equal(p.categoryCode, "12");
    assert.equal(p.code1, "I");
  });

  it("parses pcode field prefix", () => {
    const p = parseProductQuery("pcode:90915-YZZD1");
    assert.equal(p.pcodeOrMcode, "90915-YZZD1");
  });

  it("parses oem prefix", () => {
    const p = parseProductQuery("oem 90915-YZZD1");
    assert.equal(p.pcodeOrMcode, "90915-YZZD1");
  });

  it("mergeParsedIntoSlots sets product_by_code", () => {
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
    const parsed = parseProductQuery("22010585");
    mergeParsedIntoSlots(slots, parsed);
    assert.equal(slots.intent, "product_by_code");
    assert.equal(slots.bcode, "22010585");
  });

  it("mergeParsedIntoSlots merges text terms", () => {
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
    const parsed = parseProductQuery("ฝาวาล์ว 18 ลิตร PTT");
    mergeParsedIntoSlots(slots, parsed);
    assert.ok(slots.text?.includes("ฝาวาล์ว"));
  });

  it("parses typo ซล as seal CODE1", () => {
    const p = parseProductQuery("ซล 31×46×7");
    assert.equal(p.code1, "C");
    assert.deepEqual(p.sizes, ["31", "46", "7"]);
    assert.ok(p.textTerms.includes("ซีล"));
  });

  it("parses วาวไอ 6640 as text+model not SIZE1", () => {
    const p = parseProductQuery("วาวไอ 6640");
    assert.equal(p.code1, null);
    assert.deepEqual(p.sizes, []);
    assert.ok(p.textTerms.includes("วาวไอ"));
    assert.ok(p.textTerms.includes("6640"));
  });

  it("bare ซล maps to seal with ซีล text hint", () => {
    const p = parseProductQuery("ซล");
    assert.equal(p.code1, "C");
    assert.ok(p.textTerms.includes("ซีล"));
  });

  it("searchTokensFromSlots keeps model numbers like 6640", () => {
    const slots = {
      text: "วาวไอดี 6640",
      size1: null,
      size2: null,
      size3: null,
    };
    assert.deepEqual(searchTokensFromSlots(slots), ["วาวไอดี", "6640"]);
    assert.ok(isNumericSearchToken("6640"));
    assert.ok(!isNumericSearchToken("วาวไอดี"));
  });

  it("searchTokensFromSlots drops size numbers already in slots", () => {
    const slots = {
      text: "ซีล 31 46 7",
      size1: "31",
      size2: "46",
      size3: "7",
    };
    assert.deepEqual(searchTokensFromSlots(slots), ["ซีล"]);
  });
});
