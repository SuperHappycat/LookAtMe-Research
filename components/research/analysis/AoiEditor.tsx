"use client";

/**
 * Areas-of-interest editor: shows a paused frame of one stimulus video (seek slider),
 * lets the user draw, move and resize rectangles with the mouse (or touch), and edit
 * each box's label and optional time window. Box coordinates are fractions of the
 * video frame (0..1). Level 1 boxes are per video; see lib/research/analysis/aoi.ts.
 */

import { useRef, useState } from "react";
import styles from "@/styles/shared.module.css";
import rs from "@/styles/research.module.css";
import cs from "@/styles/research-c.module.css";
import type { AoiBox } from "@/lib/research/contracts";
import { rectFromPoints } from "@/lib/research/analysis/aoi";

type Mode = "new" | "move" | "nw" | "ne" | "sw" | "se";
interface Drag {
  mode: Mode;
  idx: number;
  px: number;
  py: number;
  orig: AoiBox;
}

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const round4 = (v: number) => Math.round(v * 10000) / 10000;

function nextLabel(boxes: AoiBox[]): string {
  let i = boxes.length + 1;
  while (boxes.some((b) => b.label === `AOI ${i}`)) i++;
  return `AOI ${i}`;
}

function activeAt(b: AoiBox, t: number): boolean {
  if (b.tStartS !== undefined && t < b.tStartS) return false;
  if (b.tEndS !== undefined && t >= b.tEndS) return false;
  return true;
}

export default function AoiEditor({
  videoId,
  boxes,
  onChange,
  readOnly,
}: {
  videoId: string;
  boxes: AoiBox[];
  onChange: (boxes: AoiBox[]) => void;
  readOnly: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [duration, setDuration] = useState(0);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);

  function point(e: React.PointerEvent): [number, number] {
    const r = overlayRef.current!.getBoundingClientRect();
    return [clamp((e.clientX - r.left) / r.width), clamp((e.clientY - r.top) / r.height)];
  }

  function begin(e: React.PointerEvent, mode: Mode, idx: number) {
    if (readOnly) return;
    e.preventDefault();
    e.stopPropagation();
    const [px, py] = point(e);
    overlayRef.current?.setPointerCapture(e.pointerId);
    if (mode === "new") {
      const b: AoiBox = { label: nextLabel(boxes), x: px, y: py, w: 0, h: 0 };
      drag.current = { mode, idx: boxes.length, px, py, orig: b };
      onChange([...boxes, b]);
      setSelected(boxes.length);
    } else {
      drag.current = { mode, idx, px, py, orig: boxes[idx] };
      setSelected(idx);
    }
  }

  /** One handler for the whole overlay: the target's data-mode / data-idx say what was grabbed. */
  function down(e: React.PointerEvent<HTMLDivElement>) {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-mode]");
    if (el && el.dataset.mode) begin(e, el.dataset.mode as Mode, Number(el.dataset.idx));
    else begin(e, "new", -1);
  }

  function move(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const [px, py] = point(e);
    const o = d.orig;
    let next: AoiBox;
    if (d.mode === "move") {
      next = { ...o, x: clamp(o.x + px - d.px, 0, 1 - o.w), y: clamp(o.y + py - d.py, 0, 1 - o.h) };
    } else if (d.mode === "new") {
      next = { ...o, ...rectFromPoints(d.px, d.py, px, py) };
    } else {
      // the corner opposite the handle stays fixed
      const fx = d.mode === "nw" || d.mode === "sw" ? o.x + o.w : o.x;
      const fy = d.mode === "nw" || d.mode === "ne" ? o.y + o.h : o.y;
      next = { ...o, ...rectFromPoints(fx, fy, px, py) };
    }
    onChange(boxes.map((b, i) => (i === d.idx ? next : b)));
  }

  function end() {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const b = boxes[d.idx];
    if (b && (b.w < 0.01 || b.h < 0.01)) {
      // a click without dragging: drop the empty box
      if (d.mode === "new") {
        onChange(boxes.filter((_, i) => i !== d.idx));
        setSelected(null);
      }
      return;
    }
    if (b) onChange(boxes.map((x, i) => (i === d.idx ? { ...x, x: round4(x.x), y: round4(x.y), w: round4(x.w), h: round4(x.h) } : x)));
  }

  function update(i: number, patch: Partial<AoiBox>) {
    onChange(boxes.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  }

  function setTime(i: number, key: "tStartS" | "tEndS", raw: string) {
    const b = { ...boxes[i] };
    if (raw.trim() === "") delete b[key];
    else {
      const v = Number(raw);
      if (!Number.isFinite(v) || v < 0) return;
      b[key] = Math.round(v * 10) / 10;
    }
    onChange(boxes.map((x, j) => (j === i ? b : x)));
  }

  function seek(v: number) {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = v;
    setT(v);
  }

  function togglePlay() {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play().catch(() => {});
      setPlaying(true);
    } else {
      el.pause();
      setPlaying(false);
    }
  }

  return (
    <div className={cs.split}>
      <div>
        <div className={cs.stage}>
          <video
            key={videoId}
            ref={videoRef}
            src={`/videos/${videoId}.mp4`}
            muted
            playsInline
            preload="auto"
            onLoadedMetadata={(e) => {
              setDuration(e.currentTarget.duration || 0);
              e.currentTarget.currentTime = 0.01;
            }}
            onTimeUpdate={(e) => setT(e.currentTarget.currentTime)}
            onPause={() => setPlaying(false)}
          />
          <div
            ref={overlayRef}
            className={cs.overlay}
            style={readOnly ? { cursor: "default" } : undefined}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          >
            {boxes.map((b, i) => (
              <div
                key={i}
                className={`${i === selected ? cs.boxSelected : cs.box} ${activeAt(b, t) ? "" : cs.boxInactive}`}
                style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}
                data-mode="move"
                data-idx={i}
              >
                <span className={cs.boxLabel}>{b.label}</span>
                {i === selected && !readOnly &&
                  (["nw", "ne", "sw", "se"] as const).map((h) => (
                    <span
                      key={h}
                      className={{ nw: cs.hNW, ne: cs.hNE, sw: cs.hSW, se: cs.hSE }[h]}
                      data-mode={h}
                      data-idx={i}
                    />
                  ))}
              </div>
            ))}
          </div>
        </div>
        <div className={cs.seek}>
          <button className={styles.secondaryButton} onClick={togglePlay} type="button">
            {playing ? "หยุด / Pause" : "เล่น / Play"}
          </button>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={Math.min(t, duration || 0)}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label="ตำแหน่งวิดีโอ / Video position"
          />
          <span className={`${rs.muted} ${cs.num}`} style={{ fontSize: 13 }}>
            {t.toFixed(1)} / {duration.toFixed(1)} s
          </span>
        </div>
        {!readOnly && (
          <p className={cs.note}>
            ลากบนภาพเพื่อวาดกรอบ ลากกรอบเพื่อย้าย ลากมุมเพื่อปรับขนาด / Drag on the frame to draw a box, drag a box to move it,
            drag a corner to resize. กรอบที่จางคือกรอบที่อยู่นอกช่วงเวลาของมัน / Faded boxes are outside their time window at
            this position.
          </p>
        )}
      </div>

      <div>
        {boxes.length === 0 && <p className={rs.muted}>ยังไม่มีกรอบ / No boxes yet.</p>}
        <div className={cs.boxList}>
          {boxes.map((b, i) => (
            <div key={i} className={i === selected ? cs.boxItemSelected : cs.boxItem} onClick={() => setSelected(i)}>
              <label className={cs.full}>
                ชื่อ / Label
                <input value={b.label} maxLength={60} disabled={readOnly} onChange={(e) => update(i, { label: e.target.value })} />
              </label>
              <label>
                เริ่ม (วินาที) / From (s)
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={b.tStartS ?? ""}
                  disabled={readOnly}
                  placeholder="0"
                  onChange={(e) => setTime(i, "tStartS", e.target.value)}
                />
              </label>
              <label>
                ถึง (วินาที) / To (s)
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={b.tEndS ?? ""}
                  disabled={readOnly}
                  placeholder={duration ? duration.toFixed(1) : "end"}
                  onChange={(e) => setTime(i, "tEndS", e.target.value)}
                />
              </label>
              {!readOnly && (
                <div className={`${cs.full} ${rs.row}`} style={{ gap: 6 }}>
                  <button type="button" className={rs.linkButton} onClick={() => update(i, { tStartS: Math.round(t * 10) / 10 })}>
                    เริ่มที่นี่ / Start here
                  </button>
                  <button type="button" className={rs.linkButton} onClick={() => update(i, { tEndS: Math.round(t * 10) / 10 })}>
                    จบที่นี่ / End here
                  </button>
                  <button
                    type="button"
                    className={rs.linkButton}
                    onClick={() => {
                      const c = { ...b };
                      delete c.tStartS;
                      delete c.tEndS;
                      onChange(boxes.map((x, j) => (j === i ? c : x)));
                    }}
                  >
                    ทั้งวิดีโอ / Whole video
                  </button>
                  <button
                    type="button"
                    className={rs.linkButton}
                    style={{ color: "var(--danger)" }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onChange(boxes.filter((_, j) => j !== i));
                      setSelected(null);
                    }}
                  >
                    ลบ / Delete
                  </button>
                </div>
              )}
              <span className={`${cs.full} ${rs.muted}`} style={{ fontSize: 12 }}>
                x {(b.x * 100).toFixed(0)}% · y {(b.y * 100).toFixed(0)}% · w {(b.w * 100).toFixed(0)}% · h {(b.h * 100).toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
