"use client";

/**
 * components/HomeClient.tsx
 * ============================
 * Web port of gui/home.py: logo, disclaimer subtitle, and the Start
 * Screening nav action. The desktop app's Previous Results page isn't
 * ported: saved results hold patient names/emails, and this app has no
 * login, so they're only viewable in the (access-controlled) Google
 * Sheet itself. The desktop app's camera-status card and
 * Settings/Exit buttons aren't ported -- camera access is checked when
 * a test actually starts, and there's no local app to "exit" or a
 * Settings page in this pass.
 */

import Image from "next/image";
import Link from "next/link";
import styles from "@/styles/shared.module.css";

export default function HomeClient() {
  return (
    <div className={styles.pageFull}>
      <div className={styles.header}>
        <Image src="/logo.png" alt="LookAtMe" width={420} height={149} className={styles.logoBig} priority />
        <p className={styles.subtitleCentered} style={{ fontSize: 18 }}>
          Eye-Tracking Screening • Preliminary screening only, not a diagnostic tool
        </p>
      </div>

      <div className={styles.navRow}>
        <Link href="/intake" className={styles.navButton}>
          Start Screening
        </Link>
      </div>
    </div>
  );
}
