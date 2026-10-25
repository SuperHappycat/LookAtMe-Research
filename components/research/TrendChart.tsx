"use client";

/**
 * components/research/TrendChart.tsx
 * ====================================
 * Repeat-screening trend for one child (plans: behavioral_dev, hospital): overall and level scores over the
 * child's completed sessions, as a dependency-free SVG line chart with a hover tooltip and a table view.
 */

import { useMemo, useRef, useState } from "react";
import rs from "@/styles/research.module.css";
import b from "@/styles/research-b.module.css";
import { pathD, TREND_SERIES, trendLayout, type TrendSession } from "@/lib/research/followup/trend";

const W = 640;
const H = 260;
const fmtDate = (d: Date) => d.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "2-digit" });
const fmt = (v: number | null) => (v === null || v === undefined ? "—" : String(Math.round(Number(v))));

function Marker({ shape, x, y, color }: { shape: string; x: number; y: number; color: string }) {
  const r = 4.5;
  if (shape === "square") return <rect className={b.marker} x={x - r} y={y - r} width={2 * r} height={2 * r} rx={1} fill={color} />;
  if (shape === "diamond")
    return <path className={b.marker} d={`M${x},${y - r - 1} L${x + r + 1},${y} L${x},${y + r + 1} L${x - r - 1},${y} Z`} fill={color} />;
  if (shape === "triangle")
    return <path className={b.marker} d={`M${x},${y - r - 1} L${x + r + 1},${y + r} L${x - r - 1},${y + r} Z`} fill={color} />;
  return <circle className={b.marker} cx={x} cy={y} r={r} fill={color} />;
}

export default function TrendChart({ sessions }: { sessions: TrendSession[] }) {
  const L = useMemo(() => trendLayout(sessions, W, H, fmtDate), [sessions]);
  const [view, setView] = useState<"chart" | "table">("chart");
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  if (L.sessions.length === 0) {
    return <span className={rs.muted}>ยังไม่มีการคัดกรองที่สมบูรณ์ / No completed screenings yet.</span>;
  }

  const xs = L.xs;

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    const x = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    xs.forEach((v, i) => {
      if (Math.abs(v - x) < Math.abs(xs[best] - x)) best = i;
    });
    setHover(best);
  }

  const hs = hover !== null ? L.sessions[hover] : null;

  return (
    <div>
      <div className={b.toggleRow}>
        <div className={b.legend} aria-hidden={view === "table"}>
          {TREND_SERIES.map((s) => (
            <span key={s.key} className={b.legendItem}>
              <svg width="18" height="12" aria-hidden>
                <line x1="0" y1="6" x2="18" y2="6" stroke={s.color} strokeWidth="2" />
                <Marker shape={s.marker} x={9} y={6} color={s.color} />
              </svg>
              {s.label}
            </span>
          ))}
        </div>
        <button className={rs.linkButton} onClick={() => setView(view === "chart" ? "table" : "chart")}>
          {view === "chart" ? "ดูเป็นตาราง / Show table" : "ดูเป็นกราฟ / Show chart"}
        </button>
      </div>

      {view === "chart" ? (
        <div className={b.chartWrap}>
          <svg
            ref={svgRef}
            className={b.chartSvg}
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={`กราฟคะแนน ${L.sessions.length} ครั้ง / Score trend over ${L.sessions.length} screenings`}
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          >
            {L.yTicks.map((t) => (
              <g key={t.label}>
                <line className={b.gridLine} x1={L.pad.left} x2={W - L.pad.right} y1={t.y} y2={t.y} />
                <text className={b.axisText} x={L.pad.left - 8} y={t.y + 4} textAnchor="end">
                  {t.label}
                </text>
              </g>
            ))}
            {L.xTicks.map((t, i) => (
              <text key={i} className={b.axisText} x={t.x} y={H - 10} textAnchor="middle">
                {t.label}
              </text>
            ))}
            {hover !== null && <line className={b.crosshair} x1={xs[hover]} x2={xs[hover]} y1={L.pad.top} y2={H - L.pad.bottom} />}
            {TREND_SERIES.map((s) => (
              <g key={s.key}>
                {L.series[s.key].length > 1 && <path className={b.seriesLine} d={pathD(L.series[s.key])} stroke={s.color} />}
                {L.series[s.key].map((p) => (
                  <Marker key={p.sessionId} shape={s.marker} x={p.x} y={p.y} color={s.color} />
                ))}
              </g>
            ))}
            {/* transparent hit area so hovering anywhere in the plot works */}
            <rect x={L.pad.left} y={L.pad.top} width={W - L.pad.left - L.pad.right} height={H - L.pad.top - L.pad.bottom} fill="transparent" />
          </svg>
          {hs && hover !== null && (
            <div
              className={b.tooltip}
              style={xs[hover] > W / 2 ? { right: `${((W - xs[hover]) / W) * 100 + 2}%` } : { left: `${(xs[hover] / W) * 100 + 2}%` }}
            >
              <strong>{new Date(hs.started_at).toLocaleDateString("th-TH")}</strong>
              {TREND_SERIES.map((s) => (
                <div key={s.key}>
                  {s.label}: <strong>{fmt(hs[s.key])}</strong>
                </div>
              ))}
              {hs.risk_level && <div>ความเสี่ยง / Risk: {hs.risk_level}</div>}
            </div>
          )}
        </div>
      ) : (
        <div className={rs.tableWrap}>
          <table className={rs.table}>
            <thead>
              <tr>
                <th>วันที่ / Date</th>
                {TREND_SERIES.map((s) => (
                  <th key={s.key}>{s.label}</th>
                ))}
                <th>ความเสี่ยง / Risk</th>
              </tr>
            </thead>
            <tbody>
              {L.sessions.map((s) => (
                <tr key={s.id}>
                  <td>{new Date(s.started_at).toLocaleDateString("th-TH")}</td>
                  {TREND_SERIES.map((k) => (
                    <td key={k.key}>{fmt(s[k.key])}</td>
                  ))}
                  <td>{s.risk_level ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
