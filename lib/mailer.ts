/**
 * lib/mailer.ts
 * ==============
 * Sends the finished screening report by email via Gmail SMTP
 * (nodemailer), using a Gmail account's App Password -- not OAuth, not
 * the Gmail API, and NOT the same thing as a claude.ai Gmail connector
 * (that's for Claude sending mail in chat; this is the deployed app's
 * own sender, configured independently). See README.md "Email setup".
 *
 * Required env vars:
 *   GMAIL_USER         the Gmail address to send FROM
 *   GMAIL_APP_PASSWORD a 16-character App Password for that account
 *                       (requires 2-Step Verification -- see README.md)
 */

import nodemailer from "nodemailer";

export interface ReportEmailData {
  patientName: string;
  patientEmail: string;
  overallScore: number;
  riskLevel: string;
  test1?: { humanPct: number; geometricPct: number; switches: number; avgFixationMs: number };
  test2?: { facePct: number; objectPct: number };
  test3?: { blockPct: number; facePct: number; accuracyPct: number; latencyMs: number | null };
}

function getTransport() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  return nodemailer.createTransport({ service: "gmail", auth: { user, pass } });
}

function renderHtml(data: ReportEmailData): string {
  const row = (label: string, value: string) =>
    `<tr><td style="padding:4px 12px;color:#607D8B">${label}</td><td style="padding:4px 12px;font-weight:600">${value}</td></tr>`;

  const test1Rows = data.test1
    ? row("Test 1 — Human / Geometric", `${data.test1.humanPct.toFixed(0)}% / ${data.test1.geometricPct.toFixed(0)}%`)
    : "";
  const test2Rows = data.test2
    ? row("Test 2 — Face / Object", `${data.test2.facePct.toFixed(0)}% / ${data.test2.objectPct.toFixed(0)}%`)
    : "";
  const test3Rows = data.test3
    ? row("Test 3 — Accuracy", `${data.test3.accuracyPct.toFixed(0)}%`)
    : "";

  return `
    <div style="font-family:Segoe UI,system-ui,sans-serif;color:#1a1a1a;max-width:480px;margin:0 auto">
      <h2 style="color:#1565c0">LookAtMe Screening Summary</h2>
      <p>Hi ${data.patientName || "there"},</p>
      <p>Here is the screening summary for your recent session.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        ${row("Overall Score", `${data.overallScore.toFixed(0)} / 100`)}
        ${row("Risk Level", data.riskLevel)}
        ${test1Rows}
        ${test2Rows}
        ${test3Rows}
      </table>
      <p style="color:#607D8B;font-size:13px">
        This is a preliminary screening tool, not a diagnostic instrument.
        Discuss results with a qualified healthcare professional.
      </p>
    </div>
  `;
}

export async function sendReportEmail(data: ReportEmailData): Promise<void> {
  const transport = getTransport();
  if (!transport) {
    throw new Error(
      "Email isn't configured on the server yet. Set GMAIL_USER and GMAIL_APP_PASSWORD (see README.md).",
    );
  }
  if (!data.patientEmail) {
    throw new Error("No patient email on file for this session.");
  }

  await transport.sendMail({
    from: `"LookAtMe Screening" <${process.env.GMAIL_USER}>`,
    to: data.patientEmail,
    subject: "Your LookAtMe Screening Summary",
    html: renderHtml(data),
  });
}
