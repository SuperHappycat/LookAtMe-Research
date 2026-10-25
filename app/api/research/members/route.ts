/**
 * app/api/research/members/route.ts
 * ===================================
 * GET    ?orgId=…                       list members with emails      (org admin)
 * POST   { orgId, email, role }         invite / add a member          (org admin)
 * DELETE { orgId, userId }              remove a member                (org admin; not the last admin)
 */

import {
  audit,
  EMAIL_RE,
  getServiceClient,
  handle,
  HttpError,
  requireOrgRole,
  requireUser,
} from "@/lib/research/supabase/server";
import { inviteMember } from "@/lib/research/supabase/invite";
import type { MemberRole } from "@/lib/research/plans";

const ROLES: MemberRole[] = ["admin", "staff", "viewer"];

export const GET = handle(async (req) => {
  const user = await requireUser(req);
  const orgId = new URL(req.url).searchParams.get("orgId") ?? "";
  await requireOrgRole(user.id, orgId, ["admin"]);
  const svc = getServiceClient();
  const { data, error } = await svc.from("members").select("user_id, role, created_at").eq("org_id", orgId);
  if (error) throw new HttpError(500, error.message);
  const members = await Promise.all(
    (data ?? []).map(async (m) => {
      const { data: u } = await svc.auth.admin.getUserById(m.user_id);
      return {
        userId: m.user_id,
        role: m.role,
        email: u.user?.email ?? "",
        joined: !!u.user?.last_sign_in_at,
        createdAt: m.created_at,
      };
    }),
  );
  return Response.json({ members });
});

export const POST = handle(async (req) => {
  const user = await requireUser(req);
  const body = (await req.json().catch(() => ({}))) as { orgId?: string; email?: string; role?: string };
  const orgId = body.orgId ?? "";
  const email = (body.email ?? "").trim().toLowerCase();
  const role = (body.role ?? "staff") as MemberRole;
  await requireOrgRole(user.id, orgId, ["admin"]);
  if (!EMAIL_RE.test(email)) throw new HttpError(400, "Please enter a valid email address.");
  if (!ROLES.includes(role)) throw new HttpError(400, "Unknown role.");
  const result = await inviteMember(req, orgId, email, role, user.id);
  return Response.json(result);
});

export const DELETE = handle(async (req) => {
  const user = await requireUser(req);
  const body = (await req.json().catch(() => ({}))) as { orgId?: string; userId?: string };
  const orgId = body.orgId ?? "";
  const userId = body.userId ?? "";
  await requireOrgRole(user.id, orgId, ["admin"]);
  const svc = getServiceClient();
  const { data: admins } = await svc.from("members").select("user_id").eq("org_id", orgId).eq("role", "admin");
  if ((admins ?? []).length === 1 && admins?.[0].user_id === userId) {
    throw new HttpError(409, "ต้องมีผู้ดูแลอย่างน้อย 1 คน / An organization needs at least one admin.");
  }
  const { error } = await svc.from("members").delete().eq("org_id", orgId).eq("user_id", userId);
  if (error) throw new HttpError(500, error.message);
  await audit(orgId, user.id, "remove_member");
  return Response.json({ ok: true });
});
