/**
 * app/api/research/me/route.ts
 * GET → { isPlatformAdmin } for the logged-in user (shows the LookAtMe team admin link).
 */

import { handle, isPlatformAdmin, requireUser } from "@/lib/research/supabase/server";

export const GET = handle(async (req) => {
  const user = await requireUser(req);
  return Response.json({ isPlatformAdmin: await isPlatformAdmin(user.id) });
});
