"use client";

/**
 * /r/demo — demo mode for presentations. Runs the real screening flow (camera check, calibration, Tests 1–3)
 * but the summary shows the result chosen here, marked "Demo", and nothing is saved. See lib/research/demo.ts.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import styles from "@/styles/shared.module.css";
import rs from "@/styles/research.module.css";
import { getGazeEngine } from "@/lib/research/gaze";
import { DEMO_PRESETS, demoResult, startDemoScreening, type DemoPreset } from "@/lib/research/demo";
import { useResearch } from "./ResearchShell";
import { useAssent } from "./AssentDialog";

const PRESET_TEXT: Record<DemoPreset, string> = {
  Low: "เสี่ยงต่ำ / Low risk",
  Moderate: "เสี่ยงปานกลาง / Moderate risk",
  High: "เสี่ยงสูง / High risk",
};

export default function DemoClient() {
  const router = useRouter();
  const { active } = useResearch();
  const [score, setScore] = useState<number>(DEMO_PRESETS.Low);
  const [child, setChild] = useState(true);
  const preview = demoResult(score);
  const { ask: askAssent, dialog: assentDialog } = useAssent();

  async function start() {
    if (!active) return;
    const assent = await askAssent("DEMO");
    if (!assent) return;
    startDemoScreening({ orgId: active.org.id, engine: getGazeEngine().name, ageMonths: child ? 36 : 240, score, assent });
    router.push("/r/check");
  }

  return (
    <div className={styles.pageNarrow}>
      {assentDialog}
      <h1 className={styles.titleCentered}>โหมดสาธิต / Demo mode</h1>
      <p className={styles.subtitleCentered}>
        ทดสอบได้ครบทุกขั้นตอน แต่หน้าสรุปจะแสดงผลที่เลือกไว้ และไม่บันทึกข้อมูลใด ๆ ไม่ใช้โควตา
        <br />
        Runs the full screening, but the summary shows the result you choose here. Nothing is saved and no quota is used.
      </p>

      <div className={styles.card}>
        <h3 style={{ marginTop: 0 }}>ผลที่จะแสดง / Result to show</h3>
        <div className={rs.modeToggle} style={{ marginBottom: 14 }}>
          {(Object.keys(DEMO_PRESETS) as DemoPreset[]).map((p) => (
            <button key={p} className={preview.riskLevel === p ? rs.modeOn : ""} onClick={() => setScore(DEMO_PRESETS[p])}>
              {PRESET_TEXT[p]}
            </button>
          ))}
        </div>
        <div className={rs.field}>
          <label htmlFor="demo-score">คะแนนรวม / Overall score (0–100)</label>
          <input
            id="demo-score"
            type="number"
            min={0}
            max={100}
            value={score}
            onChange={(e) => setScore(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
          />
        </div>
        <p style={{ color: "var(--muted)", fontSize: 14 }}>
          หน้าสรุปจะแสดง / The summary will show: <strong>{preview.overallScore.toFixed(0)} / 100 · {preview.riskLevel} Risk</strong> (Test 1{" "}
          {preview.sub.humanPreference.toFixed(0)}%, Test 2 {preview.sub.faceAttention.toFixed(0)}%, Test 3{" "}
          {preview.sub.jointAttention.toFixed(0)}%)
        </p>

        <h3>การปรับเทียบ / Calibration</h3>
        <div className={rs.modeToggle} style={{ marginBottom: 14 }}>
          <button className={child ? rs.modeOn : ""} onClick={() => setChild(true)}>
            เด็ก (รูปสัตว์) / Child (animals)
          </button>
          <button className={!child ? rs.modeOn : ""} onClick={() => setChild(false)}>
            ผู้ใหญ่ (จุด) / Adult (dots)
          </button>
        </div>

        <div className={styles.saveRow}>
          <button className={styles.primaryButton} onClick={start} disabled={!active}>
            เริ่มการสาธิต / Start demo →
          </button>
        </div>
      </div>
    </div>
  );
}
