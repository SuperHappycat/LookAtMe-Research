"use client";

/**
 * components/research/ResearchShell.tsx
 * =======================================
 * Wraps every /r page: requires login, loads the user's organizations
 * (memberships) and provides them through useResearch(). Also renders the
 * top navigation.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import styles from "@/styles/shared.module.css";
import rs from "@/styles/research.module.css";
import { apiFetch, getSupabase, supabaseConfigured } from "@/lib/research/supabase/client";
import { PLANS, ROLE_LABELS, type MemberRole, type PlanKey } from "@/lib/research/plans";

export interface Organization {
  id: string;
  name: string;
  type: PlanKey;
  plan: PlanKey;
  screening_quota: number | null;
  screenings_used: number;
  seats: number;
  expires_on: string;
}

export interface Membership {
  role: MemberRole;
  org: Organization;
}

interface ResearchContextValue {
  session: Session;
  memberships: Membership[];
  active: Membership | null;
  setActiveOrg: (orgId: string) => void;
  isPlatformAdmin: boolean;
  reloadOrgs: () => Promise<void>;
}

const ResearchContext = createContext<ResearchContextValue | null>(null);
const ACTIVE_KEY = "lookatme_active_org";

export function useResearch(): ResearchContextValue {
  const ctx = useContext(ResearchContext);
  if (!ctx) throw new Error("useResearch() must be used inside <ResearchShell>");
  return ctx;
}

export function canWrite(m: Membership | null): boolean {
  return m?.role === "admin" || m?.role === "staff";
}

export default function ResearchShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [memberships, setMemberships] = useState<Membership[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const configured = supabaseConfigured();

  useEffect(() => {
    if (!configured) return;
    const sb = getSupabase();
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, [configured]);

  useEffect(() => {
    if (session === null) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [session, pathname, router]);

  const reloadOrgs = useCallback(async () => {
    if (!session) return;
    const { data, error: err } = await getSupabase()
      .from("members")
      .select("role, organizations(id, name, type, plan, screening_quota, screenings_used, seats, expires_on)")
      .eq("user_id", session.user.id);
    if (err) {
      setError(err.message);
      return;
    }
    const list = (data ?? [])
      .map((r) => ({ role: r.role as MemberRole, org: r.organizations as unknown as Organization }))
      .filter((m) => m.org)
      .sort((a, b) => a.org.name.localeCompare(b.org.name));
    setMemberships(list);
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(ACTIVE_KEY);
    } catch {
      stored = null;
    }
    setActiveId(list.find((m) => m.org.id === stored)?.org.id ?? list[0]?.org.id ?? null);
  }, [session]);

  useEffect(() => {
    if (!session) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- data load; state is set after the request resolves
    void reloadOrgs();
    apiFetch("/api/research/me")
      .then((r) => (r.ok ? r.json() : { isPlatformAdmin: false }))
      .then((d) => setIsPlatformAdmin(!!d.isPlatformAdmin))
      .catch(() => setIsPlatformAdmin(false));
  }, [session, reloadOrgs]);

  const setActiveOrg = useCallback((orgId: string) => {
    setActiveId(orgId);
    try {
      window.localStorage.setItem(ACTIVE_KEY, orgId);
    } catch {
      // ignore
    }
  }, []);

  const active = useMemo(
    () => memberships?.find((m) => m.org.id === activeId) ?? null,
    [memberships, activeId],
  );

  if (!configured) {
    return (
      <div className={styles.pageNarrow}>
        <div className={styles.card}>
          <p className={styles.errorText}>
            ยังไม่ได้ตั้งค่า Supabase / Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and
            NEXT_PUBLIC_SUPABASE_ANON_KEY (see docs/PHASE2_3_NOTES.md).
          </p>
        </div>
      </div>
    );
  }

  if (!session || memberships === null) {
    return (
      <div className={styles.pageNarrow}>
        <div className={styles.card}>{error ? <span className={styles.errorText}>{error}</span> : "กำลังโหลด… / Loading…"}</div>
      </div>
    );
  }

  const logout = async () => {
    await getSupabase().auth.signOut();
    router.replace("/login");
  };

  const nav = [
    { href: "/r", label: "เด็ก / Children" },
    { href: "/r/dashboard", label: "ผลการคัดกรอง / Results" },
    ...(active?.role === "admin" ? [{ href: "/r/team", label: "ทีม / Team" }] : []),
    ...(isPlatformAdmin ? [{ href: "/r/admin", label: "LookAtMe admin" }] : []),
  ];

  return (
    <ResearchContext.Provider
      value={{ session, memberships, active, setActiveOrg, isPlatformAdmin, reloadOrgs }}
    >
      <header className={rs.topbar}>
        <div className={rs.topbarInner}>
          <strong className={rs.brand}>LookAtMe Research</strong>
          <nav className={rs.nav}>
            {nav.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={pathname === n.href || (n.href !== "/r" && pathname.startsWith(n.href)) ? rs.navActive : rs.navLink}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className={rs.topbarRight}>
            {memberships.length > 1 && (
              <select
                className={rs.select}
                value={active?.org.id ?? ""}
                onChange={(e) => setActiveOrg(e.target.value)}
                aria-label="Organization"
              >
                {memberships.map((m) => (
                  <option key={m.org.id} value={m.org.id}>
                    {m.org.name}
                  </option>
                ))}
              </select>
            )}
            <span className={rs.muted}>{session.user.email}</span>
            <button className={rs.linkButton} onClick={logout}>
              ออกจากระบบ / Log out
            </button>
          </div>
        </div>
        {active && (
          <div className={rs.orgBar}>
            {active.org.name} · {PLANS[active.org.plan]?.labelTh} / {PLANS[active.org.plan]?.labelEn} ·{" "}
            {ROLE_LABELS[active.role]} · ใช้ไป / used {active.org.screenings_used}
            {active.org.screening_quota !== null ? ` / ${active.org.screening_quota}` : " (ไม่จำกัด / unlimited)"} ·
            หมดอายุ / expires {active.org.expires_on}
          </div>
        )}
      </header>
      {!active && !isPlatformAdmin && pathname !== "/r/admin" ? (
        <div className={styles.pageNarrow}>
          <div className={styles.card}>
            บัญชีนี้ยังไม่ได้อยู่ในองค์กรใด / This account isn&apos;t in any organization yet. Ask your admin or LookAtMe to
            invite you.
          </div>
        </div>
      ) : (
        children
      )}
    </ResearchContext.Provider>
  );
}
