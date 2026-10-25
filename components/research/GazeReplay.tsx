"use client";

/**
 * Replay with gaze dot (spec §4.7 / §5): plays the original stimulus video(s)
 * of a level and draws the child's gaze from the stored gaze CSV. Needs no
 * recording. Positions are relative to the stimulus area, so the replay is
 * approximate when the screen layout differs from the one used in the test.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "@/styles/shared.module.css";
import rs from "@/styles/research.module.css";
import type { GazeRow } from "@/lib/research/gazeLog";

const LEVEL_VIDEOS: Record<number, { label: string; srcs: string[] }> = {
  1: { label: "Test 1: Human vs Geometric", srcs: ["/videos/human.mp4", "/videos/geometric.mp4"] },
  2: { label: "Test 2: Face vs Object", srcs: ["/videos/talking.mp4"] },
  3: { label: "Test 3: Joint attention", srcs: ["/videos/rja.mp4"] },
};

export default function GazeReplay({ rows, humanSide }: { rows: GazeRow[]; humanSide: "left" | "right" | null }) {
  const [level, setLevel] = useState<1 | 2 | 3>(1);
  const [playing, setPlaying] = useState(false);
  const [dot, setDot] = useState<{ x: number; y: number } | null>(null);
  const [tSec, setTSec] = useState(0);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const raf = useRef<number | null>(null);
  const t0 = useRef(0);

  const levelRows = useMemo(() => rows.filter((r) => r.level === level).sort((a, b) => a.t_ms - b.t_ms), [rows, level]);
  const hasPoints = levelRows.some((r) => r.x_norm !== null);
  const durationMs = levelRows.length ? levelRows[levelRows.length - 1].t_ms : 0;

  let srcs = LEVEL_VIDEOS[level].srcs;
  if (level === 1 && humanSide === "right") srcs = [...srcs].reverse();

  const stop = useCallback(() => {
    if (raf.current !== null) cancelAnimationFrame(raf.current);
    raf.current = null;
    videoRefs.current.forEach((v) => v?.pause());
    setPlaying(false);
  }, []);

  useEffect(() => stop, [stop]);

  // Kept in a ref (assigned in an effect) so the requestAnimationFrame loop can call itself.
  const tickRef = useRef<() => void>(() => {});
  useEffect(() => {
    tickRef.current = () => {
      const t = performance.now() - t0.current;
      setTSec(t / 1000);
      // last sample at or before t (binary search)
      let lo = 0;
      let hi = levelRows.length - 1;
      let idx = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (levelRows[mid].t_ms <= t) {
          idx = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      const r = idx >= 0 ? levelRows[idx] : null;
      const box = boxRef.current?.getBoundingClientRect();
      const stage = stageRef.current?.getBoundingClientRect();
      if (r && r.x_norm !== null && r.y_norm !== null && box && stage) {
        setDot({ x: box.left - stage.left + r.x_norm * box.width, y: box.top - stage.top + r.y_norm * box.height });
      } else {
        setDot(null);
      }
      if (t >= durationMs) {
        stop();
        return;
      }
      raf.current = requestAnimationFrame(tickRef.current);
    };
  }, [levelRows, durationMs, stop]);

  function play() {
    stop();
    videoRefs.current.forEach((v) => {
      if (!v) return;
      v.currentTime = 0;
      void v.play().catch(() => {});
    });
    t0.current = performance.now();
    setPlaying(true);
    raf.current = requestAnimationFrame(tickRef.current);
  }

  return (
    <div className={styles.card}>
      <div className={rs.row} style={{ marginBottom: 12 }}>
        {[1, 2, 3].map((l) => (
          <button
            key={l}
            className={l === level ? styles.primaryButton : styles.secondaryButton}
            onClick={() => {
              stop();
              setDot(null);
              setLevel(l as 1 | 2 | 3);
            }}
          >
            {LEVEL_VIDEOS[l].label}
          </button>
        ))}
      </div>
      {!hasPoints ? (
        <p className={rs.muted}>
          ระดับนี้ไม่มีพิกัดการมอง (เช่น ใช้ระบบ OpenCV หรือไม่ได้ปรับเทียบ) / No gaze positions for this level (e.g. OpenCV
          engine or no calibration).
        </p>
      ) : (
        <>
          <div ref={stageRef} className={rs.replayStage}>
            <div ref={boxRef} style={{ display: "flex", gap: 16, width: "100%", justifyContent: "center" }}>
              {srcs.map((src, i) => (
                <video
                  key={`${level}-${src}`}
                  ref={(el) => {
                    videoRefs.current[i] = el;
                  }}
                  src={src}
                  muted
                  loop
                  playsInline
                  style={{ flex: "1 1 0", minWidth: 0 }}
                />
              ))}
            </div>
            {dot && <div className={rs.replayDot} style={{ left: dot.x, top: dot.y }} />}
          </div>
          <div className={styles.saveRow} style={{ marginTop: 12 }}>
            <button className={styles.primaryButton} onClick={playing ? stop : play}>
              {playing ? "หยุด / Stop" : "เล่นซ้ำ / Play replay"}
            </button>
            <span className={rs.muted}>
              {tSec.toFixed(1)} / {(durationMs / 1000).toFixed(1)} s · {levelRows.length} samples
            </span>
          </div>
        </>
      )}
    </div>
  );
}
