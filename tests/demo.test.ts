/** Demo mode result presets (lib/research/demo.ts). Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMO_PRESETS, demoResult, demoSubScores } from "../lib/research/demo.ts";

test("demo presets land in their risk band", () => {
  for (const [level, score] of Object.entries(DEMO_PRESETS)) {
    assert.equal(demoResult(score).riskLevel, level);
  }
});

test("demo sub-scores reproduce the chosen overall score and stay within 0–100", () => {
  for (const t of [0, 1, 3, 22, 39, 40, 55, 69, 70, 84, 99, 100]) {
    const sub = demoSubScores(t);
    for (const v of Object.values(sub)) assert.ok(v >= 0 && v <= 100, `${t}: ${v}`);
    assert.ok(Math.abs(demoResult(t).overallScore - t) < 1e-9, `overall for ${t}`);
  }
});
