"use client";

/** Dependency-free SVG charts for the group summary and age comparison. */

import cs from "@/styles/research-c.module.css";

const W = 640;
const LABEL_W = 150;
const ROW = 28;
const PAD_TOP = 22;
const PAD_BOTTOM = 26;
const RIGHT = 20;
const BAR = "var(--primary)";

export const RISK_COLORS = { Low: "#16a34a", Moderate: "#d97706", High: "#dc2626" } as const;

function ticks(max: number): number[] {
  const step = max <= 10 ? 2 : max <= 50 ? 10 : 20;
  const out: number[] = [];
  for (let v = 0; v <= max + 1e-9; v += step) out.push(v);
  return out;
}

/** Horizontal bars of a mean with ±SD whiskers, on a 0..max scale. */
export function MeanBarChart({
  title,
  rows,
  max = 100,
}: {
  title: string;
  rows: { label: string; mean: number | null; sd: number | null; n: number; dim?: boolean }[];
  max?: number;
}) {
  const plotW = W - LABEL_W - RIGHT;
  const H = PAD_TOP + rows.length * ROW + PAD_BOTTOM;
  const x = (v: number) => LABEL_W + (Math.min(max, Math.max(0, v)) / max) * plotW;
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} className={cs.chart} role="img" aria-label={title}>
        <text x={0} y={14} fontSize={13} fontWeight={600} fill="var(--foreground)">
          {title}
        </text>
        {ticks(max).map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={PAD_TOP} y2={H - PAD_BOTTOM} stroke="var(--border)" />
            <text x={x(t)} y={H - 8} fontSize={11} textAnchor="middle" fill="var(--muted)">
              {t}
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const y = PAD_TOP + i * ROW;
          const cy = y + ROW / 2;
          return (
            <g key={r.label} opacity={r.dim ? 0.45 : 1}>
              <text x={LABEL_W - 8} y={cy + 4} fontSize={12} textAnchor="end" fill="var(--foreground)">
                {r.label.length > 22 ? r.label.slice(0, 21) + "…" : r.label}
              </text>
              {r.mean !== null && (
                <>
                  <rect x={LABEL_W} y={y + 6} width={Math.max(0, x(r.mean) - LABEL_W)} height={ROW - 12} rx={3} fill={BAR}>
                    <title>{`${r.label}: ${r.mean.toFixed(1)}${r.sd !== null ? ` ± ${r.sd.toFixed(1)}` : ""} (n=${r.n})`}</title>
                  </rect>
                  {r.sd !== null && (
                    <g stroke="var(--foreground)" strokeWidth={1.2}>
                      <line x1={x(r.mean - r.sd)} x2={x(r.mean + r.sd)} y1={cy} y2={cy} />
                      <line x1={x(r.mean - r.sd)} x2={x(r.mean - r.sd)} y1={cy - 5} y2={cy + 5} />
                      <line x1={x(r.mean + r.sd)} x2={x(r.mean + r.sd)} y1={cy - 5} y2={cy + 5} />
                    </g>
                  )}
                </>
              )}
              <text x={W - 2} y={cy + 4} fontSize={11} textAnchor="end" fill="var(--muted)">
                n={r.n}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className={cs.legend}>แท่ง = ค่าเฉลี่ย, เส้น = ±SD / Bar = mean, whisker = ±1 SD</figcaption>
    </figure>
  );
}

/** 100% stacked horizontal bars of the risk distribution. */
export function RiskStackChart({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; pct: { Low: number | null; Moderate: number | null; High: number | null }; n: number; dim?: boolean }[];
}) {
  const plotW = W - LABEL_W - RIGHT - 30;
  const H = PAD_TOP + rows.length * ROW + 10;
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} className={cs.chart} role="img" aria-label={title}>
        <text x={0} y={14} fontSize={13} fontWeight={600} fill="var(--foreground)">
          {title}
        </text>
        {rows.map((r, i) => {
          const y = PAD_TOP + i * ROW;
          let acc = LABEL_W;
          return (
            <g key={r.label} opacity={r.dim ? 0.45 : 1}>
              <text x={LABEL_W - 8} y={y + ROW / 2 + 4} fontSize={12} textAnchor="end" fill="var(--foreground)">
                {r.label.length > 22 ? r.label.slice(0, 21) + "…" : r.label}
              </text>
              {r.pct.Low === null ? (
                <rect x={LABEL_W} y={y + 6} width={plotW} height={ROW - 12} rx={3} fill="var(--surface-sunken)" />
              ) : (
                (["Low", "Moderate", "High"] as const).map((k) => {
                  const w = ((r.pct[k] ?? 0) / 100) * plotW;
                  const x0 = acc;
                  acc += w;
                  return w > 0 ? (
                    <rect key={k} x={x0} y={y + 6} width={w} height={ROW - 12} fill={RISK_COLORS[k]} stroke="var(--surface)" strokeWidth={1}>
                      <title>{`${r.label} · ${k}: ${(r.pct[k] ?? 0).toFixed(0)}%`}</title>
                    </rect>
                  ) : null;
                })
              )}
              <text x={W - 2} y={y + ROW / 2 + 4} fontSize={11} textAnchor="end" fill="var(--muted)">
                n={r.n}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className={cs.legend}>
        {(["Low", "Moderate", "High"] as const).map((k) => (
          <span key={k}>
            <span className={cs.swatch} style={{ background: RISK_COLORS[k] }} />
            {k}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

/** Box plots (median, IQR, min–max) per row with an optional marker value. */
export function BoxPlotChart({
  title,
  rows,
  marker,
  max = 100,
}: {
  title: string;
  rows: { label: string; min: number | null; q1: number | null; median: number | null; q3: number | null; max: number | null; dim?: boolean }[];
  marker?: { row: number; value: number; label: string } | null;
  max?: number;
}) {
  const plotW = W - LABEL_W - RIGHT;
  const H = PAD_TOP + rows.length * ROW + PAD_BOTTOM;
  const x = (v: number) => LABEL_W + (Math.min(max, Math.max(0, v)) / max) * plotW;
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} className={cs.chart} role="img" aria-label={title}>
        <text x={0} y={14} fontSize={13} fontWeight={600} fill="var(--foreground)">
          {title}
        </text>
        {ticks(max).map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={PAD_TOP} y2={H - PAD_BOTTOM} stroke="var(--border)" />
            <text x={x(t)} y={H - 8} fontSize={11} textAnchor="middle" fill="var(--muted)">
              {t}
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const y = PAD_TOP + i * ROW;
          const cy = y + ROW / 2;
          const ok = !r.dim && r.q1 !== null && r.q3 !== null && r.median !== null && r.min !== null && r.max !== null;
          return (
            <g key={r.label}>
              <text x={LABEL_W - 8} y={cy + 4} fontSize={12} textAnchor="end" fill="var(--foreground)">
                {r.label}
              </text>
              {ok ? (
                <g>
                  <line x1={x(r.min!)} x2={x(r.max!)} y1={cy} y2={cy} stroke="var(--muted)" />
                  <rect x={x(r.q1!)} y={y + 6} width={Math.max(1, x(r.q3!) - x(r.q1!))} height={ROW - 12} fill="var(--primary-soft)" stroke={BAR} />
                  <line x1={x(r.median!)} x2={x(r.median!)} y1={y + 6} y2={y + ROW - 6} stroke={BAR} strokeWidth={2.5} />
                </g>
              ) : (
                <text x={LABEL_W + 6} y={cy + 4} fontSize={11} fill="var(--muted)">
                  ข้อมูลยังไม่พอ / not enough data
                </text>
              )}
              {marker && marker.row === i && (
                <g>
                  <circle cx={x(marker.value)} cy={cy} r={6} fill="#facc15" stroke="var(--ink-dark)" strokeWidth={1.5}>
                    <title>{marker.label}</title>
                  </circle>
                </g>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className={cs.legend}>
        <span>
          <span className={cs.swatch} style={{ background: "var(--primary-soft)", border: `1px solid ${BAR}` }} />
          IQR (Q1–Q3), เส้นกลาง = มัธยฐาน / line = median, เส้นยาว = ต่ำสุด–สูงสุด / whisker = min–max
        </span>
        {marker && (
          <span>
            <span className={cs.swatch} style={{ background: "#facc15", borderRadius: 99 }} />
            {marker.label}
          </span>
        )}
      </figcaption>
    </figure>
  );
}
