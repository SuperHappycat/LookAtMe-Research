/**
 * app/api/drive/callback/route.ts (spec §4.3 step 3)
 * GET ?code&state from Google → verify state + nonce cookie, exchange the code, store the
 * encrypted refresh token, create the root folder, then redirect to /r/settings?drive=…
 */

import { audit, getServiceClient, requireOrgRole } from "@/lib/research/supabase/server";
import { NONCE_COOKIE } from "@/lib/research/drive/config";
import { handleCallback } from "@/lib/research/drive/callback";
import { oauthClientFromEnv } from "@/lib/research/drive/google";
import { uploadOrigin } from "@/lib/research/drive/http";

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=") || null;
  }
  return null;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  let base: string;
  try {
    base = uploadOrigin(req);
  } catch {
    return new Response("APP_URL is not configured on the server.", { status: 500 });
  }
  const done = (q: string) =>
    new Response(null, {
      status: 303,
      headers: {
        Location: `${base}/r/settings?${q}`,
        // One-time nonce: clear it.
        "Set-Cookie": `${NONCE_COOKIE}=; Path=/api/drive/callback; HttpOnly; SameSite=Lax; Max-Age=0`,
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });

  try {
    const out = await handleCallback(
      {
        code: url.searchParams.get("code"),
        state: url.searchParams.get("state"),
        error: url.searchParams.get("error"),
        nonceCookie: readCookie(req, NONCE_COOKIE),
      },
      {
        svc: getServiceClient(),
        f: fetch,
        client: oauthClientFromEnv(),
        checkAdmin: (userId, orgId) => requireOrgRole(userId, orgId, ["admin"]),
      },
    );
    if (out.ok) {
      await audit(out.orgId, out.userId, "drive_connect");
      return done("drive=connected");
    }
    return done(`drive=error&reason=${encodeURIComponent(out.reason)}`);
  } catch (err) {
    console.error("drive callback failed:", err instanceof Error ? err.message : "unknown");
    return done("drive=error&reason=server_error");
  }
}
