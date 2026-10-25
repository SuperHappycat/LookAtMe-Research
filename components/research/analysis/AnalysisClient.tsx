"use client";

/**
 * /r/analysis — research analysis tools in one page with tabs:
 * areas of interest, age comparison, group summary, export for SPSS / R.
 * Tabs the plan lacks stay visible and show "available on the Hospital plan".
 * Sessions hidden by RLS (blind mode for non-admins) are simply never loaded.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "@/styles/shared.module.css";
import rs from "@/styles/research.module.css";
import cs from "@/styles/research-c.module.css";
import { friendlyError, getSupabase } from "@/lib/research/supabase/client";
import { planHas, type PlanFeature } from "@/lib/research/plans";
import { ANALYSIS_SELECT, filterSessions, type AnalysisSession } from "@/lib/research/analysis/sessions";
import { canWrite, useResearch } from "../ResearchShell";
import { DEFAULT_FILTERS, EthicsNote, FilterBar, PlanGate, type Filters } from "./common";
import AoiTab from "./AoiTab";
import AgeTab from "./AgeTab";
import GroupTab from "./GroupTab";
import ExportTab from "./ExportTab";

type TabKey = "aoi" | "age" | "groups" | "export";

const TABS: { key: TabKey; label: string; feature: PlanFeature; filtered: boolean }[] = [
  { key: "aoi", label: "พื้นที่ที่สนใจ / Areas of interest", feature: "areas_of_interest", filtered: true },
  { key: "age", label: "เทียบตามอายุ / Age comparison", feature: "age_comparison", filtered: false },
  { key: "groups", label: "สรุปตามกลุ่ม / Group summary", feature: "group_summary", filtered: true },
  { key: "export", label: "ส่งออก SPSS/R / Export for SPSS/R", feature: "raw_export", filtered: true },
];

const TAB_KEY = "lookatme_analysis_tab";

export default function AnalysisClient() {
  const { active } = useResearch();
  const orgId = active?.org.id;
  const plan = active?.org.plan;
  const isAdmin = active?.role === "admin";
  const [tab, setTab] = useState<TabKey>("age");
  const [sessions, setSessions] = useState<AnalysisSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(TAB_KEY) as TabKey | null;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restore a per-viewer preference after mount
      if (saved && TABS.some((t) => t.key === saved)) setTab(saved);
    } catch {
      // storage unavailable: keep the default tab
    }
  }, []);

  function choose(k: TabKey) {
    setTab(k);
    try {
      window.localStorage.setItem(TAB_KEY, k);
    } catch {
      // ignore
    }
  }

  const load = useCallback(async () => {
    if (!orgId) return;
    setSessions(null);
    const { data, error: err } = await getSupabase()
      .from("sessions")
      .select(ANALYSIS_SELECT)
      .eq("org_id", orgId)
      .in("status", ["completed", "invalid"])
      .order("started_at", { ascending: false })
      .limit(5000);
    if (err) return setError(friendlyError(err));
    setSessions((data ?? []) as unknown as AnalysisSession[]);
  }, [orgId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data load; state is set after the request resolves
    void load();
  }, [load]);

  const filtered = useMemo(
    () =>
      filterSessions(sessions ?? [], {
        from: filters.from,
        to: filters.to,
        risk: filters.risk,
        code: filters.code,
        statuses: filters.includeInvalid ? ["completed", "invalid"] : ["completed"],
        researchConsentOnly: filters.researchConsentOnly,
      }),
    [sessions, filters],
  );

  if (!active || !orgId || !plan) return <div className={rs.wide}>…</div>;
  const current = TABS.find((t) => t.key === tab)!;
  const allowed = planHas(plan, current.feature);

  return (
    <div className={rs.wide}>
      <h1 className={styles.title}>วิเคราะห์ / Analysis</h1>
      <EthicsNote />

      <div className={cs.tabs} role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={t.key === tab}
            className={t.key === tab ? cs.tabActive : cs.tab}
            onClick={() => choose(t.key)}
          >
            {t.label}
            {!planHas(plan, t.feature) && <span className={cs.lock}>Hospital</span>}
          </button>
        ))}
      </div>

      {error && <p className={styles.errorText}>{error}</p>}

      {!allowed ? (
        <PlanGate />
      ) : sessions === null && !error ? (
        <div className={styles.card}>กำลังโหลด… / Loading…</div>
      ) : (
        <>
          {current.filtered && <FilterBar value={filters} onChange={setFilters} count={filtered.length} />}
          {tab === "aoi" && <AoiTab orgId={orgId} canEdit={canWrite(active)} isAdmin={isAdmin} sessions={filtered} />}
          {tab === "age" && <AgeTab sessions={sessions ?? []} />}
          {tab === "groups" && <GroupTab orgId={orgId} isAdmin={isAdmin} sessions={filtered} />}
          {tab === "export" && <ExportTab orgId={orgId} isAdmin={isAdmin} sessions={filtered} />}
        </>
      )}

      <p className={rs.muted} style={{ fontSize: 13, marginTop: 20 }}>
        ใช้คัดกรองเบื้องต้น ไม่ใช่การวินิจฉัย / Screening only, not a diagnosis.
      </p>
    </div>
  );
}
