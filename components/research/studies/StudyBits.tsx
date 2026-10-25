"use client";

/** Small pieces of the study pages: role badge, summary table and dependency-free SVG bars. */

import rs from "@/styles/research.module.css";
import ds from "@/styles/research-d.module.css";
import type { Stat, SummaryBlock } from "@/lib/research/studies/aggregate";
import type { StudyRole } from "@/lib/research/contracts";

export function RoleBadge({ role }: { role: StudyRole }) {
  return role === "lead" ? (
    <span className={`${rs.badge} ${ds.badgeLead}`}>ผู้นำ / Lead</span>
  ) : (
    <span className={`${rs.badge} ${ds.badgeSite}`}>สถานที่ร่วม / Site</span>
  );
}

const fmt = (s: Stat | null, k: "mean" | "median") => (s && s[k] !== null ? s[k]!.toFixed(1) : "—");

function Row({ b, total, minCellN }: { b: SummaryBlock; total?: boolean; minCellN: number }) {
  const hidden = b.suppressed ? `n<${minCellN}` : "—";
  return (
    <tr className={total ? ds.totalRow : undefined}>
      <td>{b.label}</td>
      <td className={ds.num}>{b.n}</td>
      <td className={ds.num}>{b.completed}</td>
      <td className={ds.num}>{b.invalid}</td>
      <td className={ds.num}>{b.risk ? b.risk.Low : hidden}</td>
      <td className={ds.num}>{b.risk ? b.risk.Moderate : hidden}</td>
      <td className={ds.num}>{b.risk ? b.risk.High : hidden}</td>
      <td className={ds.num}>{b.overall ? `${fmt(b.overall, "mean")} / ${fmt(b.overall, "median")}` : hidden}</td>
      <td className={ds.num}>{b.level1 ? `${fmt(b.level1, "mean")} / ${fmt(b.level1, "median")}` : hidden}</td>
      <td className={ds.num}>{b.level2 ? `${fmt(b.level2, "mean")} / ${fmt(b.level2, "median")}` : hidden}</td>
      <td className={ds.num}>{b.level3 ? `${fmt(b.level3, "mean")} / ${fmt(b.level3, "median")}` : hidden}</td>
      <td className={ds.num}>{b.quality ? fmt(b.quality, "mean") : hidden}</td>
    </tr>
  );
}

export function SummaryTable({ sites, total, minCellN }: { sites: SummaryBlock[]; total: SummaryBlock | null; minCellN: number }) {
  return (
    <div className={rs.tableWrap}>
      <table className={rs.table}>
        <thead>
          <tr>
            <th>สถานที่ / Site</th>
            <th className={ds.num}>n</th>
            <th className={ds.num}>เสร็จ / Done</th>
            <th className={ds.num}>ทดสอบซ้ำ / Retest</th>
            <th className={ds.num}>ต่ำ / Low</th>
            <th className={ds.num}>ปานกลาง / Mod.</th>
            <th className={ds.num}>สูง / High</th>
            <th className={ds.num}>คะแนนรวม / Overall (mean / median)</th>
            <th className={ds.num}>Test 1</th>
            <th className={ds.num}>Test 2</th>
            <th className={ds.num}>Test 3</th>
            <th className={ds.num}>คุณภาพ / Quality (mean)</th>
          </tr>
        </thead>
        <tbody>
          {sites.map((b, i) => (
            <Row key={i} b={b} minCellN={minCellN} />
          ))}
          {total && <Row b={total} total minCellN={minCellN} />}
        </tbody>
      </table>
    </div>
  );
}

const RISK_COLORS = { Low: "#16a34a", Moderate: "#d97706", High: "#dc2626" } as const;

/** One horizontal 100% bar per block: share of completed sessions by risk level (suppressed blocks are skipped). */
export function RiskBars({ blocks }: { blocks: SummaryBlock[] }) {
  const shown = blocks.filter((b) => b.risk);
  if (!shown.length) return null;
  const labelW = 170;
  const barW = 420;
  const rowH = 30;
  const height = shown.length * rowH + 6;
  return (
    <figure>
      <svg
        className={ds.chart}
        viewBox={`0 0 ${labelW + barW + 60} ${height}`}
        role="img"
        aria-label="สัดส่วนระดับความเสี่ยงต่อสถานที่ / Risk level share per site"
      >
        {shown.map((b, i) => {
          const r = b.risk!;
          const sum = r.Low + r.Moderate + r.High;
          let x = labelW;
          const y = i * rowH + 4;
          return (
            <g key={i}>
              <text x={labelW - 8} y={y + 15} textAnchor="end" className={ds.chartLabel}>
                {b.label.length > 24 ? b.label.slice(0, 23) + "…" : b.label}
              </text>
              <rect x={labelW} y={y} width={barW} height={rowH - 10} rx={4} fill="var(--surface-sunken)" />
              {(["Low", "Moderate", "High"] as const).map((k) => {
                const w = sum ? (r[k] / sum) * barW : 0;
                const rect = w > 0 && (
                  <rect key={k} x={x} y={y} width={w} height={rowH - 10} fill={RISK_COLORS[k]}>
                    <title>{`${k}: ${r[k]} (${Math.round((r[k] / sum) * 100)}%)`}</title>
                  </rect>
                );
                x += w;
                return rect;
              })}
              <text x={labelW + barW + 8} y={y + 15} className={ds.chartMuted}>
                n={sum}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className={ds.legend}>
        {(["Low", "Moderate", "High"] as const).map((k) => (
          <span key={k}>
            <span className={ds.swatch} style={{ background: RISK_COLORS[k] }} />
            {k === "Low" ? "ต่ำ / Low" : k === "Moderate" ? "ปานกลาง / Moderate" : "สูง / High"}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
