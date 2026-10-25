/**
 * app/api/research/admin/orgs/route.ts
 * ======================================
 * LookAtMe team only (platform_admins).
 * GET                                     list organizations with usage
 * POST  { name, type, expiresOn, adminEmail }   create an organization and invite its first admin
 * PATCH { id, expiresOn?, screeningQuota?, seats? }  renew / change limits
 */

import {
  audit,
  EMAIL_RE,
  getServiceClient,
  handle,
  HttpError,
  requirePlatformAdmin,
  requireUser,
} from "@/lib/research/supabase/server";
import { inviteMember } from "@/lib/research/supabase/invite";
import { PLANS, type PlanKey } from "@/lib/research/plans";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const GET = handle(async (req) => {
  const user = await requireUser(req);
  await requirePlatformAdmin(user.id);
  const { data, error } = await getServiceClient()
    .from("organizations")
    .select("id, name, type, plan, screening_quota, screenings_used, seats, expires_on, created_at")
    .order("created_at", { ascending: false });
  if (error) throw new HttpError(500, error.message);
  return Response.json({ organizations: data });
});

export const POST = handle(async (req) => {
  const user = await requireUser(req);
  await requirePlatformAdmin(user.id);
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    type?: string;
    expiresOn?: string;
    adminEmail?: string;
  };
  const name = (body.name ?? "").trim();
  const type = body.type as PlanKey;
  const expiresOn = body.expiresOn ?? "";
  const adminEmail = (body.adminEmail ?? "").trim().toLowerCase();
  if (!name || name.length > 200) throw new HttpError(400, "Organization name is required.");
  if (!(type in PLANS)) throw new HttpError(400, "Unknown plan.");
  if (!DATE_RE.test(expiresOn)) throw new HttpError(400, "Expiry date is required (YYYY-MM-DD).");
  if (!EMAIL_RE.test(adminEmail)) throw new HttpError(400, "A valid admin email is required.");

  const plan = PLANS[type];
  const svc = getServiceClient();
  const { data: org, error } = await svc
    .from("organizations")
    .insert({
      name,
      type,
      plan: type,
      screening_quota: plan.screeningQuota,
      seats: plan.seats,
      expires_on: expiresOn,
    })
    .select("id")
    .single();
  if (error || !org) throw new HttpError(500, error?.message ?? "Could not create organization.");

  await audit(org.id, user.id, "create_org", type);
  const invite = await inviteMember(req, org.id, adminEmail, "admin", user.id);
  return Response.json({ id: org.id, invite });
});

export const PATCH = handle(async (req) => {
  const user = await requireUser(req);
  await requirePlatformAdmin(user.id);
  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
    expiresOn?: string;
    screeningQuota?: number | null;
    seats?: number;
  };
  const update: Record<string, unknown> = {};
  if (body.expiresOn !== undefined) {
    if (!DATE_RE.test(body.expiresOn)) throw new HttpError(400, "Bad expiry date.");
    update.expires_on = body.expiresOn;
  }
  if (body.screeningQuota !== undefined) {
    if (body.screeningQuota !== null && (!Number.isInteger(body.screeningQuota) || body.screeningQuota < 0)) {
      throw new HttpError(400, "Bad quota.");
    }
    update.screening_quota = body.screeningQuota;
  }
  if (body.seats !== undefined) {
    if (!Number.isInteger(body.seats) || body.seats < 1) throw new HttpError(400, "Bad seats.");
    update.seats = body.seats;
  }
  if (!body.id || Object.keys(update).length === 0) throw new HttpError(400, "Nothing to update.");
  const { error } = await getServiceClient().from("organizations").update(update).eq("id", body.id);
  if (error) throw new HttpError(500, error.message);
  await audit(body.id, user.id, "update_org", Object.keys(update).join(","));
  return Response.json({ ok: true });
});
