/**
 * app/api/dev/drive-spike/route.ts
 * ==================================
 * DEV-ONLY (spec §4.4 "CORS spike"). Starts a Google Drive resumable upload
 * session on the server, so the browser can test whether it is allowed to
 * PUT the file bytes straight to Google.
 *
 * Disabled unless ENABLE_DEV_TOOLS=1. Never enable it in production.
 *
 * Body: { accessToken: string, size: number }
 *   accessToken: a short-lived OAuth token with the drive.file scope (e.g. from
 *   Google's OAuth 2.0 Playground). It is used once and not stored or logged.
 */

import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  if (process.env.ENABLE_DEV_TOOLS !== "1") {
    return NextResponse.json({ error: "dev tools disabled" }, { status: 404 });
  }

  let body: { accessToken?: unknown; size?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const accessToken = typeof body.accessToken === "string" ? body.accessToken.trim() : "";
  const size = typeof body.size === "number" && Number.isInteger(body.size) && body.size > 0 ? body.size : 0;
  if (!accessToken || !size || size > 20 * 1024 * 1024) {
    return NextResponse.json({ error: "accessToken and size (1 B – 20 MB) are required" }, { status: 400 });
  }

  // The Origin of the page that will PUT the bytes; Google uses it to allow CORS on the session URL.
  const origin = req.headers.get("origin") ?? new URL(req.url).origin;

  const res = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": "application/octet-stream",
      "X-Upload-Content-Length": String(size),
      Origin: origin,
    },
    body: JSON.stringify({
      name: `lookatme-cors-test-${new Date().toISOString().replace(/[:.]/g, "-")}.bin`,
      appProperties: { lookatme_test: "cors_spike" },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json(
      { error: `Google refused to start the upload: HTTP ${res.status}`, detail: text.slice(0, 500) },
      { status: 502 },
    );
  }
  const location = res.headers.get("location");
  if (!location) {
    return NextResponse.json({ error: "Google did not return an upload session URL" }, { status: 502 });
  }
  return NextResponse.json({ uploadUrl: location, origin });
}
