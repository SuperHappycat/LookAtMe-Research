"use client";

/**
 * Child-friendly calibration targets: simple original animal/shape drawings that "loom"
 * (shrink from large to small) onto the calibration point, as in infant eye-tracking
 * calibrations (animated graphics shrinking into each point; Bánki et al., 2022; Dalrymple
 * et al., 2018). The small bright centre is where the child's eyes should land.
 *
 * Adult mode uses a plain pulsing dot.
 */

import rs from "@/styles/research.module.css";

export type TargetPhase = "loom" | "hold" | "reattract" | "reward";

const PALETTES = [
  ["#f59e0b", "#fde68a"],
  ["#10b981", "#a7f3d0"],
  ["#3b82f6", "#bfdbfe"],
  ["#ec4899", "#fbcfe8"],
  ["#8b5cf6", "#ddd6fe"],
  ["#ef4444", "#fecaca"],
];

function Chick({ c }: { c: string[] }) {
  return (
    <g>
      <ellipse cx="50" cy="58" rx="30" ry="27" fill={c[1]} stroke={c[0]} strokeWidth="3" />
      <circle cx="50" cy="32" r="20" fill={c[1]} stroke={c[0]} strokeWidth="3" />
      <circle cx="43" cy="29" r="3.5" fill="#1f2937" />
      <circle cx="57" cy="29" r="3.5" fill="#1f2937" />
      <path d="M44 38 L56 38 L50 46 Z" fill="#f97316" />
    </g>
  );
}

function Fish({ c }: { c: string[] }) {
  return (
    <g>
      <ellipse cx="46" cy="50" rx="30" ry="20" fill={c[1]} stroke={c[0]} strokeWidth="3" />
      <path d="M74 50 L94 34 L94 66 Z" fill={c[0]} />
      <circle cx="32" cy="45" r="4" fill="#1f2937" />
      <path d="M40 58 Q46 62 52 58" stroke={c[0]} strokeWidth="3" fill="none" />
    </g>
  );
}

function Star({ c }: { c: string[] }) {
  return (
    <g>
      <path
        d="M50 8 L61 37 L92 38 L67 57 L76 88 L50 70 L24 88 L33 57 L8 38 L39 37 Z"
        fill={c[1]}
        stroke={c[0]}
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <circle cx="43" cy="48" r="3.5" fill="#1f2937" />
      <circle cx="57" cy="48" r="3.5" fill="#1f2937" />
      <path d="M44 58 Q50 63 56 58" stroke="#1f2937" strokeWidth="2.5" fill="none" />
    </g>
  );
}

function Bug({ c }: { c: string[] }) {
  return (
    <g>
      <circle cx="50" cy="56" r="30" fill={c[0]} />
      <line x1="50" y1="28" x2="50" y2="86" stroke="#1f2937" strokeWidth="3" />
      <circle cx="38" cy="50" r="5" fill="#1f2937" />
      <circle cx="62" cy="64" r="5" fill="#1f2937" />
      <circle cx="62" cy="46" r="4" fill="#1f2937" />
      <circle cx="50" cy="24" r="12" fill="#1f2937" />
      <circle cx="45" cy="22" r="3" fill="#fff" />
      <circle cx="55" cy="22" r="3" fill="#fff" />
    </g>
  );
}

function Ball({ c }: { c: string[] }) {
  return (
    <g>
      <circle cx="50" cy="50" r="38" fill={c[1]} stroke={c[0]} strokeWidth="3" />
      <path d="M12 50 Q50 20 88 50" stroke={c[0]} strokeWidth="6" fill="none" />
      <path d="M12 50 Q50 80 88 50" stroke={c[0]} strokeWidth="6" fill="none" />
    </g>
  );
}

function Cat({ c }: { c: string[] }) {
  return (
    <g>
      <path d="M22 30 L30 6 L44 24 Z" fill={c[1]} stroke={c[0]} strokeWidth="3" />
      <path d="M78 30 L70 6 L56 24 Z" fill={c[1]} stroke={c[0]} strokeWidth="3" />
      <circle cx="50" cy="52" r="34" fill={c[1]} stroke={c[0]} strokeWidth="3" />
      <circle cx="39" cy="46" r="4" fill="#1f2937" />
      <circle cx="61" cy="46" r="4" fill="#1f2937" />
      <path d="M46 58 L54 58 L50 63 Z" fill="#f472b6" />
      <path d="M42 66 Q50 72 58 66" stroke="#1f2937" strokeWidth="2.5" fill="none" />
    </g>
  );
}

const SHAPES = [Chick, Fish, Star, Bug, Ball, Cat];

export default function AttentionTarget({
  x,
  y,
  index,
  phase,
  childMode,
  progress,
}: {
  x: number;
  y: number;
  index: number;
  phase: TargetPhase;
  childMode: boolean;
  /** 0..1 — how many fixation samples are collected; drawn as a ring for the operator. */
  progress: number;
}) {
  if (!childMode) {
    return (
      <div className={rs.targetWrap} style={{ left: x, top: y }}>
        <div className={`${rs.dot} ${phase === "hold" ? rs.dotCollecting : ""}`} style={{ margin: 0 }} />
        <Ring progress={progress} size={64} />
      </div>
    );
  }
  const Shape = SHAPES[index % SHAPES.length];
  const pal = PALETTES[index % PALETTES.length];
  const cls =
    phase === "loom" ? rs.targetLoom : phase === "reattract" ? rs.targetWiggle : phase === "reward" ? rs.targetReward : rs.targetHold;
  return (
    <div className={rs.targetWrap} style={{ left: x, top: y }}>
      <svg className={`${rs.targetSvg} ${cls}`} viewBox="0 0 100 100" width="128" height="128" aria-hidden>
        <Shape c={pal} />
        {/* bright centre: where the eyes should land */}
        <circle cx="50" cy="50" r="5" fill="#ffffff" stroke="#111827" strokeWidth="2" />
      </svg>
      <Ring progress={progress} size={156} />
    </div>
  );
}

function Ring({ progress, size }: { progress: number; size: number }) {
  if (progress <= 0) return null;
  const r = size / 2 - 4;
  const c = 2 * Math.PI * r;
  return (
    <svg className={rs.targetRing} width={size} height={size} aria-hidden>
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--success)"
        strokeWidth="4"
        strokeDasharray={`${c * Math.min(1, progress)} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        opacity="0.8"
      />
    </svg>
  );
}
