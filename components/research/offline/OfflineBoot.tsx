"use client";

/**
 * Rendered once in app/layout.tsx. In production it registers the service worker (public/sw.js);
 * everywhere it lazily loads the offline queue (uploaders + sync loop) when Supabase is configured.
 */

import { useEffect } from "react";

export default function OfflineBoot() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((err) => {
        console.warn("[offline] service worker registration failed", err);
      });
    }
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return;
    import("@/lib/research/offline/boot")
      .then((m) => m.bootOffline())
      .catch((err) => console.warn("[offline] boot failed", err));
  }, []);
  return null;
}
