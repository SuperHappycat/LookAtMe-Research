/**
 * lib/research/supabase/server.ts
 * =================================
 * Server-only helpers for API routes. Uses the service-role key, which
 * bypasses Row Level Security — so every route must check the caller first
 * (requireUser + requireOrgRole / requirePlatformAdmin).
 *
 * Never import this file from a "use client" module.
 */

import "server-only";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { MemberRole } from "../plans";

let admin: SupabaseClient | null = null;

export function getServiceClient(): SupabaseClient {
  if (admin) return admin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new HttpError(500, "Supabase is not configured on the server.");
  admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return admin;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Reads "Authorization: Bearer <access token>" and returns the Supabase user. */
export async function requireUser(req: Request): Promise<User> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token) throw new HttpError(401, "Not logged in.");
  const { data, error } = await getServiceClient().auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "Session expired. Please log in again.");
  return data.user;
}

export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const { data } = await getServiceClient().from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle();
  return !!data;
}

export async function requirePlatformAdmin(userId: string): Promise<void> {
  if (!(await isPlatformAdmin(userId))) throw new HttpError(403, "LookAtMe team only.");
}

/** Throws 403 unless the user has one of `roles` in `orgId` (platform admins always pass). */
export async function requireOrgRole(userId: string, orgId: string, roles: MemberRole[]): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(orgId)) throw new HttpError(400, "Bad organization id.");
  const { data } = await getServiceClient()
    .from("members")
    .select("role")
    .eq("user_id", userId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (data && roles.includes(data.role as MemberRole)) return;
  if (await isPlatformAdmin(userId)) return;
  throw new HttpError(403, "You don't have permission for this organization.");
}

export async function audit(orgId: string | null, userId: string, action: string, target?: string): Promise<void> {
  await getServiceClient()
    .from("audit_log")
    .insert({ org_id: orgId, user_id: userId, action, target: target ?? null });
}

/** Finds an auth user by email (small orgs: scans pages of 200). */
export async function findUserByEmail(email: string): Promise<User | null> {
  const svc = getServiceClient();
  const target = email.toLowerCase();
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await svc.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new HttpError(500, error.message);
    const hit = data.users.find((u) => u.email?.toLowerCase() === target);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

export function appUrl(req: Request): string {
  return process.env.APP_URL ?? new URL(req.url).origin;
}

/** Wraps a route handler: turns HttpError into JSON responses. */
export function handle(fn: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    try {
      return await fn(req);
    } catch (err) {
      if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status });
      console.error(err);
      return Response.json({ error: "Server error." }, { status: 500 });
    }
  };
}

export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
