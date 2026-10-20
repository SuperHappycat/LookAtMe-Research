/**
 * app/api/send-report/route.ts
 * ==============================
 * Emails the finished screening summary to the patient's address (the
 * one they entered on the Intake page, before any test started) via
 * Gmail SMTP -- see lib/mailer.ts. Triggered by the "Email Report"
 * button on the Summary page, separate from "Save to Google Sheet".
 *
 * Required env vars: GMAIL_USER, GMAIL_APP_PASSWORD (see README.md
 * "Email setup").
 */

import { NextRequest, NextResponse } from "next/server";
import { sendReportEmail } from "@/lib/mailer";

interface SendReportBody {
  patient?: { name?: string; email?: string };
  test1?: { humanPct?: number; geometricPct?: number; switches?: number; avgFixationMs?: number };
  test2?: { facePct?: number; objectPct?: number };
  test3?: { blockPct?: number; facePct?: number; accuracyPct?: number; latencyMs?: number | null };
  overallScore?: number;
  riskLevel?: string;
}

export async function POST(request: NextRequest) {
  let body: SendReportBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  if (!body.patient?.email) {
    return NextResponse.json({ error: "No patient email found for this session." }, { status: 400 });
  }

  try {
    await sendReportEmail({
      patientName: body.patient.name ?? "",
      patientEmail: body.patient.email,
      overallScore: body.overallScore ?? 0,
      riskLevel: body.riskLevel ?? "Unknown",
      test1:
        body.test1?.humanPct != null
          ? {
              humanPct: body.test1.humanPct,
              geometricPct: body.test1.geometricPct ?? 0,
              switches: body.test1.switches ?? 0,
              avgFixationMs: body.test1.avgFixationMs ?? 0,
            }
          : undefined,
      test2:
        body.test2?.facePct != null
          ? { facePct: body.test2.facePct, objectPct: body.test2.objectPct ?? 0 }
          : undefined,
      test3:
        body.test3?.accuracyPct != null
          ? {
              blockPct: body.test3.blockPct ?? 0,
              facePct: body.test3.facePct ?? 0,
              accuracyPct: body.test3.accuracyPct,
              latencyMs: body.test3.latencyMs ?? null,
            }
          : undefined,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("send-report: failed to send email", err);
    const message = err instanceof Error ? err.message : "Failed to send the report email.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
