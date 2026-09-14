/**
 * app/api/save-result/route.ts
 * =============================
 * Appends one full screening session (patient info + all three tests'
 * results + overall score/risk) as a row in a Google Sheet, replacing
 * the desktop app's SQLite database + PDF report. Auth is a Google
 * Cloud service account (JWT), never exposed to the browser -- only
 * this server route holds the private key, read from environment
 * variables.
 *
 * Required env vars (see README.md for how to create these):
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL
 *   GOOGLE_PRIVATE_KEY          (with literal "\n" line breaks -- see README)
 *   GOOGLE_SHEET_ID
 *   GOOGLE_SHEET_TAB            (optional, defaults to "Sheet1")
 *
 * Row layout (columns A-R): Timestamp, Name, Email, Date of Birth,
 * Province, Test1 Human%, Test1 Geometric%, Test1 Switches, Test1 Avg
 * Fixation ms, Test1 Human Side, Test2 Face%, Test2 Object%, Test3
 * Block%, Test3 Face%, Test3 Accuracy%, Test3 Latency ms, Overall
 * Score, Risk Level.
 */

import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";

interface SaveResultBody {
  patient?: { name?: string; email?: string; dateOfBirth?: string; province?: string };
  test1?: { humanPct?: number; geometricPct?: number; switches?: number; avgFixationMs?: number; humanSide?: string };
  test2?: { facePct?: number; objectPct?: number };
  test3?: { blockPct?: number; facePct?: number; accuracyPct?: number; latencyMs?: number | null };
  overallScore?: number;
  riskLevel?: string;
}

function getSheetsClient() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawPrivateKey = process.env.GOOGLE_PRIVATE_KEY;
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!clientEmail || !rawPrivateKey || !sheetId) return null;

  const privateKey = rawPrivateKey.replace(/\\n/g, "\n");
  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return { sheets: google.sheets({ version: "v4", auth }), sheetId, tab: process.env.GOOGLE_SHEET_TAB || "Sheet1" };
}

export async function POST(request: NextRequest) {
  let body: SaveResultBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const client = getSheetsClient();
  if (!client) {
    return NextResponse.json(
      {
        error:
          "Google Sheets isn't configured on the server yet. Set GOOGLE_SERVICE_ACCOUNT_EMAIL, " +
          "GOOGLE_PRIVATE_KEY, and GOOGLE_SHEET_ID (see README.md).",
      },
      { status: 500 },
    );
  }

  try {
    const { patient, test1, test2, test3 } = body;
    const row = [
      new Date().toISOString(),
      patient?.name ?? "",
      patient?.email ?? "",
      patient?.dateOfBirth ?? "",
      patient?.province ?? "",
      test1?.humanPct?.toFixed(1) ?? "",
      test1?.geometricPct?.toFixed(1) ?? "",
      test1?.switches ?? "",
      test1?.avgFixationMs?.toFixed(0) ?? "",
      test1?.humanSide ?? "",
      test2?.facePct?.toFixed(1) ?? "",
      test2?.objectPct?.toFixed(1) ?? "",
      test3?.blockPct?.toFixed(1) ?? "",
      test3?.facePct?.toFixed(1) ?? "",
      test3?.accuracyPct?.toFixed(1) ?? "",
      test3?.latencyMs != null ? test3.latencyMs.toFixed(0) : "",
      body.overallScore?.toFixed(1) ?? "",
      body.riskLevel ?? "",
    ];

    await client.sheets.spreadsheets.values.append({
      spreadsheetId: client.sheetId,
      range: `${client.tab}!A1`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [row] },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("save-result: failed to append to Google Sheet", err);
    return NextResponse.json(
      { error: "Failed to save the result to Google Sheets. Check server logs." },
      { status: 502 },
    );
  }
}
