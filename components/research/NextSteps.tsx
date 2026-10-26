"use client";

/** "What to do next" block for the summary and the printed report (text: lib/research/nextSteps.ts). */

import type { RiskLevel } from "@/lib/scoring";
import { HELP_CONTACT, NEXT_STEPS, SEE_A_DOCTOR_IF } from "@/lib/research/nextSteps";
import css from "./report.module.css";

export default function NextSteps({ risk }: { risk: RiskLevel }) {
  const t = NEXT_STEPS[risk];
  return (
    <section className={css.nextSteps} data-risk={risk}>
      <h2 className={css.h2}>ควรทำอะไรต่อ / What to do next</h2>
      <p className={css.headline}>
        {t.headline.th}
        <br />
        <span className={css.en}>{t.headline.en}</span>
      </p>
      <ol className={css.steps}>
        {t.steps.map((s) => (
          <li key={s.en}>
            {s.th}
            <br />
            <span className={css.en}>{s.en}</span>
          </li>
        ))}
      </ol>
      <h3 className={css.h3}>พบแพทย์ได้ทุกเมื่อ ถ้าเด็ก… / See a doctor at any time if your child…</h3>
      <ul className={css.flags}>
        {SEE_A_DOCTOR_IF.map((s) => (
          <li key={s.en}>
            {s.th} <span className={css.en}>· {s.en}</span>
          </li>
        ))}
      </ul>
      <p className={css.contact}>
        {HELP_CONTACT.th} <span className={css.en}>· {HELP_CONTACT.en}</span>
      </p>
    </section>
  );
}
