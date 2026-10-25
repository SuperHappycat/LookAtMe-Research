import rs from "@/styles/research.module.css";

const TH: Record<string, string> = { Low: "ต่ำ", Moderate: "ปานกลาง", High: "สูง" };

/** Risk level chip; sessions flagged for retest or still running show that instead. */
export default function RiskBadge({ risk, status }: { risk: string | null; status?: string }) {
  if (status === "invalid") return <span className={`${rs.badge} ${rs.badgeMuted}`}>ควรทดสอบซ้ำ / Retest</span>;
  if (status === "started") return <span className={`${rs.badge} ${rs.badgeMuted}`}>ไม่เสร็จ / Not finished</span>;
  if (!risk) return <span className={`${rs.badge} ${rs.badgeMuted}`}>—</span>;
  const cls = risk === "High" ? rs.badgeHigh : risk === "Moderate" ? rs.badgeModerate : rs.badgeLow;
  return (
    <span className={`${rs.badge} ${cls}`}>
      {TH[risk] ?? risk} / {risk}
    </span>
  );
}
