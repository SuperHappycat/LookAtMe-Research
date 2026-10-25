"use client";

/**
 * lib/research/supabase/client.ts
 * =================================
 * Browser Supabase client (anon key; Row Level Security protects the data).
 * The session lives in localStorage, and API routes receive the access token
 * as "Authorization: Bearer <token>".
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function supabaseConfigured(): boolean {
  return !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
}

export function getSupabase(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error("Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY).");
  }
  client = createClient(url, anon, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Invite and password-reset links arrive with tokens in the URL.
      detectSessionInUrl: true,
      flowType: "implicit",
    },
  });
  return client;
}

/** fetch() to our own API routes with the user's access token attached. */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  return fetch(path, { ...init, headers });
}

/** Turns RPC/database errors into a short Thai + English message. */
export function friendlyError(err: unknown): string {
  const msg = err && typeof err === "object" && "message" in err ? String((err as { message: unknown }).message) : String(err);
  if (msg.includes("quota_reached"))
    return "ใช้จำนวนการคัดกรองครบแล้ว ติดต่อ LookAtMe เพื่อเพิ่มจำนวน / Screening quota used up — contact LookAtMe to add screenings.";
  if (msg.includes("plan_expired"))
    return "แผนการใช้งานหมดอายุ ติดต่อ LookAtMe เพื่อต่ออายุ / Plan expired — contact LookAtMe to renew.";
  if (msg.includes("no_consent"))
    return "ยังไม่มีใบยินยอมจากผู้ปกครอง / No parent consent recorded for this child.";
  if (msg.includes("not_allowed") || msg.includes("row-level security"))
    return "ไม่มีสิทธิ์ทำรายการนี้ / You don't have permission for this.";
  if (msg.includes("duplicate key") && msg.includes("children"))
    return "รหัสเด็กนี้มีอยู่แล้ว / This child code already exists.";
  return msg;
}
