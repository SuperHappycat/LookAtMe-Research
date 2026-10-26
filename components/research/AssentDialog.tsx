"use client";

/**
 * Child assent before a screening starts (in addition to the parent's consent). Shown by every start path:
 * child page, offline page and demo. The answer is stored in the screening context and saved with the
 * session (results.assent). "Not now" cancels before anything is started on the server.
 */

import { useCallback, useState } from "react";
import styles from "@/styles/shared.module.css";
import type { Assent } from "@/lib/research/screening";
import css from "./assent.module.css";

function AssentDialog({ code, onDone }: { code: string; onDone: (a: Assent | null) => void }) {
  const done = (kind: Assent["kind"]) => onDone({ kind, at: new Date().toISOString() });
  return (
    <div className={css.overlay} role="dialog" aria-modal="true" aria-labelledby="assent-title">
      <div className={css.card}>
        <div className={css.emoji} aria-hidden>
          👀
        </div>
        <h2 id="assent-title" className={css.title}>
          สวัสดี! / Hi!
        </h2>
        <p className={css.text}>
          เราจะดูวิดีโอสั้น ๆ ด้วยกัน กล้องจะดูว่าหนูมองตรงไหนบนจอ ถ้ามีการบันทึกวิดีโอ หน้าของหนูจะถูกทำให้เบลอ
          ไม่มีใครเห็นชื่อหนู และหยุดเมื่อไหร่ก็ได้นะ
        </p>
        <p className={`${css.text} ${css.en}`}>
          We will watch some short videos. The camera checks where you look on the screen. If we record, your face is
          blurred. Nobody sees your name, and you can stop any time.
        </p>
        <button className={`${styles.primaryButton} ${css.agree}`} onClick={() => done("child")} autoFocus>
          ✓ ตกลง / I agree
        </button>
        <div className={css.row}>
          <button className={styles.secondaryButton} onClick={() => done("parent_only")}>
            เด็กเล็ก: ผู้ปกครองยินยอมแล้ว / Young child: parent consent only
          </button>
          <button className={styles.secondaryButton} onClick={() => onDone(null)}>
            ไม่ทำตอนนี้ / Not now
          </button>
        </div>
        <p className={css.code}>{code}</p>
      </div>
    </div>
  );
}

/** `const { ask, dialog } = useAssent();` render `{dialog}`, then `const a = await ask(code)` (null = not now). */
export function useAssent() {
  const [req, setReq] = useState<{ code: string; resolve: (a: Assent | null) => void } | null>(null);
  const ask = useCallback((code: string) => new Promise<Assent | null>((resolve) => setReq({ code, resolve })), []);
  const dialog = req ? (
    <AssentDialog
      code={req.code}
      onDone={(a) => {
        req.resolve(a);
        setReq(null);
      }}
    />
  ) : null;
  return { ask, dialog };
}
