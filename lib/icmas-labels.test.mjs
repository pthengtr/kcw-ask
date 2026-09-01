import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  formatSizeLine,
  formatSizesCompact,
  getSizeLabels,
} from "./icmas-labels.mjs";

describe("icmas-labels size display", () => {
  it("labels seal sizes by CODE1 C", () => {
    assert.equal(formatSizesCompact("C", "31", "46", "7"), "ใน 31 | นอก 46 | หนา 7");
    assert.equal(formatSizeLine("C", "31", "46", "7"), "ขนาด: ใน 31 | นอก 46 | หนา 7");
  });

  it("labels o-ring with two slots", () => {
    assert.equal(formatSizesCompact("O", "35", "3", ""), "ใน 35 | หนา 3");
  });

  it("labels bearing with sparse sizes", () => {
    assert.equal(formatSizesCompact("I", "", "72", "17"), "นอก 72 | หนา 17");
  });

  it("returns empty when no sizes", () => {
    assert.equal(formatSizesCompact("C", "", "", ""), "");
  });

  it("falls back for unknown CODE1", () => {
    assert.equal(formatSizesCompact("Z", "10", "20", ""), "10 / 20");
  });

  it("getSizeLabels matches docs dictionary", () => {
    assert.deepEqual(getSizeLabels("C"), ["ใน", "นอก", "หนา"]);
    assert.deepEqual(getSizeLabels("F"), ["ใน", "นอก", "สูง"]);
    assert.deepEqual(getSizeLabels("Q"), ["เตเปอร์", "แกนโต", null]);
  });
});
