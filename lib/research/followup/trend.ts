/**
 * lib/research/followup/trend.ts
 * ================================
 * Repeat-screening trend (spec §5, "Repeat screening trend"): the child's completed sessions as points on a
 * time axis, with scores 0–100. Pure layout maths for components/research/TrendChart.tsx (unit-tested).
 */

export interface TrendSession {
  id: string;
  started_at: string;
  status: string;
  overall_score: number | null;
  level1_score: number | null;
  level2_score: number | null;
  level3_score: number | null;
  risk_level: string | null;
}

export const TREND_SERIES = [
  { key: "overall_score", label: "คะแนนรวม / Overall", color: "#2a78d6", marker: "circle" },
  { key: "level1_score", label: "ระดับ 1 / Level 1", color: "#eb6834", marker: "square" },
  { key: "level2_score", label: "ระดับ 2 / Level 2", color: "#1baf7a", marker: "diamond" },
  { key: "level3_score", label: "ระดับ 3 / Level 3", color: "#eda100", marker: "triangle" },
] as const;
export type TrendKey = (typeof TREND_SERIES)[number]["key"];

export interface TrendPoint {
  sessionId: string;
  t: number;
  x: number;
  y: number;
  value: number;
}

export interface TrendLayout {
  width: number;
  height: number;
  pad: { left: number; right: number; top: number; bottom: number };
  sessions: TrendSession[];
  /** x position of each session in `sessions`. */
  xs: number[];
  series: Record<TrendKey, TrendPoint[]>;
  xTicks: { x: number; label: string }[];
  yTicks: { y: number; label: string }[];
}

/** Completed sessions only, oldest first. */
export function trendSessions(sessions: TrendSession[]): TrendSession[] {
  return sessions
    .filter((s) => s.status === "completed")
    .sort((a, b) => (a.started_at < b.started_at ? -1 : a.started_at > b.started_at ? 1 : 0));
}

export function trendLayout(
  all: TrendSession[],
  width = 640,
  height = 260,
  formatDate: (d: Date) => string = (d) => d.toISOString().slice(0, 10),
): TrendLayout {
  const pad = { left: 40, right: 16, top: 12, bottom: 32 };
  const sessions = trendSessions(all);
  const ts = sessions.map((s) => new Date(s.started_at).getTime());
  const tMin = ts.length ? Math.min(...ts) : 0;
  const tMax = ts.length ? Math.max(...ts) : 0;
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  // A single session (or several on the same instant) sits in the middle.
  const xOf = (t: number) => (tMax === tMin ? pad.left + plotW / 2 : pad.left + ((t - tMin) / (tMax - tMin)) * plotW);
  const yOf = (v: number) => pad.top + (1 - Math.min(100, Math.max(0, v)) / 100) * plotH;

  const series = {} as Record<TrendKey, TrendPoint[]>;
  for (const s of TREND_SERIES) {
    series[s.key] = [];
    sessions.forEach((sess, i) => {
      const v = sess[s.key];
      if (v === null || v === undefined || !Number.isFinite(Number(v))) return;
      const value = Number(v);
      series[s.key].push({ sessionId: sess.id, t: ts[i], x: xOf(ts[i]), y: yOf(value), value });
    });
  }

  // At most 5 date labels, at session positions (dates of real visits read better than even ticks).
  const xTicks: TrendLayout["xTicks"] = [];
  const step = Math.max(1, Math.ceil(sessions.length / 5));
  for (let i = 0; i < sessions.length; i += step) xTicks.push({ x: xOf(ts[i]), label: formatDate(new Date(ts[i])) });
  if (sessions.length > 1 && (sessions.length - 1) % step !== 0) {
    const last = { x: xOf(ts[ts.length - 1]), label: formatDate(new Date(ts[ts.length - 1])) };
    if (last.x - xTicks[xTicks.length - 1].x < 70) xTicks.pop(); // keep labels apart
    xTicks.push(last);
  }
  const yTicks = [0, 25, 50, 75, 100].map((v) => ({ y: yOf(v), label: String(v) }));
  return { width, height, pad, sessions, xs: ts.map(xOf), series, xTicks, yTicks };
}

export function pathD(points: TrendPoint[]): string {
  return points.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}
