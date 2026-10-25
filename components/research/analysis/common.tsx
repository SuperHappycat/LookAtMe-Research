"use client";

/** Shared bits of the /r/analysis tabs: plan gate, ethics note, filter bar, CSV download with audit log. */

import styles from "@/styles/shared.module.css";
import rs from "@/styles/research.module.css";
import cs from "@/styles/research-c.module.css";
import { getSupabase } from "@/lib/research/supabase/client";
import { downloadText } from "@/lib/research/exportCsv";
import type { Risk } from "@/lib/research/analysis/sessions";

export function PlanGate() {
  return (
    <div className={cs.gate}>
      ฟังก์ชันนี้มีในแพ็กเกจโรงพยาบาล / Available on the Hospital plan.
    </div>
  );
}

/** Same wording as the dashboard export note. */
export function EthicsNote() {
  return (
    <p className={rs.muted} style={{ fontSize: 13, marginBottom: 0 }}>
      การนำข้อมูลไปใช้ในงานวิจัยต้องได้รับอนุมัติจากคณะกรรมการจริยธรรมของหน่วยงาน · Using this data in research needs your
      institution&apos;s ethics committee approval. Exports contain coded IDs only and are logged.
    </p>
  );
}

export const today = () => new Date().toISOString().slice(0, 10);

/** Writes the audit log entry first, then downloads. If logging fails, nothing is downloaded (the error is thrown). */
export async function loggedDownload(orgId: string, target: string, filename: string, text: string, type?: string) {
  const { error } = await getSupabase().rpc("log_action", { p_org: orgId, p_action: "export_analysis_csv", p_target: target });
  if (error) throw error;
  downloadText(filename, text, type);
}

export interface Filters {
  from: string;
  to: string;
  risk: "all" | Risk;
  code: string;
  includeInvalid: boolean;
  researchConsentOnly: boolean;
}

export const DEFAULT_FILTERS: Filters = {
  from: "",
  to: "",
  risk: "all",
  code: "",
  includeInvalid: false,
  researchConsentOnly: true,
};

export function FilterBar({ value, onChange, count }: { value: Filters; onChange: (f: Filters) => void; count: number }) {
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => onChange({ ...value, [k]: v });
  return (
    <div className={styles.card} style={{ marginBottom: 16 }}>
      <div className={rs.row}>
        <div className={rs.field}>
          <label htmlFor="a-from">ตั้งแต่ / From</label>
          <input id="a-from" type="date" value={value.from} onChange={(e) => set("from", e.target.value)} />
        </div>
        <div className={rs.field}>
          <label htmlFor="a-to">ถึง / To</label>
          <input id="a-to" type="date" value={value.to} onChange={(e) => set("to", e.target.value)} />
        </div>
        <div className={rs.field}>
          <label htmlFor="a-risk">ความเสี่ยง / Risk</label>
          <select id="a-risk" value={value.risk} onChange={(e) => set("risk", e.target.value as Filters["risk"])}>
            <option value="all">ทั้งหมด / All</option>
            <option value="Low">Low</option>
            <option value="Moderate">Moderate</option>
            <option value="High">High</option>
          </select>
        </div>
        <div className={rs.field}>
          <label htmlFor="a-code">รหัส / Code</label>
          <input id="a-code" value={value.code} onChange={(e) => set("code", e.target.value)} />
        </div>
      </div>
      <div className={rs.row} style={{ marginTop: 10, gap: 18 }}>
        <label className={cs.checkbox}>
          <input type="checkbox" checked={value.includeInvalid} onChange={(e) => set("includeInvalid", e.target.checked)} />
          รวมครั้งที่ต้องทดสอบซ้ำ / Include retest (invalid) sessions
        </label>
        <label className={cs.checkbox}>
          <input
            type="checkbox"
            checked={value.researchConsentOnly}
            onChange={(e) => set("researchConsentOnly", e.target.checked)}
          />
          เฉพาะเด็กที่ยินยอมให้ใช้ในงานวิจัย / Only children with research consent
        </label>
        <span className={rs.muted} style={{ fontSize: 13 }}>
          {count} ครั้ง / sessions
        </span>
      </div>
    </div>
  );
}
