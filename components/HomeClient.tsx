"use client";

/**
 * components/HomeClient.tsx
 * ============================
 * Web port of gui/home.py: logo, disclaimer subtitle, and the two nav
 * actions that make sense for a stateless web deployment (Start
 * Screening -> Intake, Previous Results -> the Google-Sheets-backed
 * results list). The desktop app's camera-status card and
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
        <Link href="/results" className={`${styles.navButton} ${styles.navButtonSecondary}`}>
          Previous Results
        </Link>
      </div>
    </div>
  );
}
