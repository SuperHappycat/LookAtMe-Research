/**
 * app/api/list-results/route.ts
 * ================================
 * Reads back the rows /api/save-result has written, for the "Previous
 * Results" page -- the Google-Sheets-backed equivalent of the desktop
 * app's ResultsViewerPage (which lists SQLite `sessions` rows).
 * Newest first. Read-only, same service-account auth as save-result.
 */

import { NextResponse } from "next/server";
import { google } from "googleapis";

export interface ResultRow {
  timestamp: string;
  name: string;
  email: string;
  province: string;
  overallScore: string;
  riskLevel: string;
}

export async function GET() {
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const rawPrivateKey = process.env.GOOGLE_PRIVATE_KEY;
  const sheetId = process.env.GOOGLE_SHEET_ID;
  const tab = process.env.GOOGLE_SHEET_TAB || "Sheet1";

  if (!clientEmail || !rawPrivateKey || !sheetId) {
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
    const privateKey = rawPrivateKey.replace(/\\n/g, "\n");
    const auth = new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const sheets = google.sheets({ version: "v4", auth });

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${tab}!A1:R`,
    });

    const rows = res.data.values ?? [];
    // Columns: Timestamp, Name, Email, DOB, Province, ... Overall Score
    // (col Q, index 16), Risk Level (col R, index 17). See save-result
    // for the full layout.
    const results: ResultRow[] = rows
      .map((r) => ({
        timestamp: r[0] ?? "",
        name: r[1] ?? "",
        email: r[2] ?? "",
        province: r[4] ?? "",
        overallScore: r[16] ?? "",
        riskLevel: r[17] ?? "",
      }))
      // Only rows with a genuine ISO timestamp in column A -- skips a
      // header row cleanly regardless of what it says, if the sheet has one.
      .filter((r) => /^\d{4}-\d{2}-\d{2}T/.test(r.timestamp) && r.name)
      .reverse();

    return NextResponse.json({ results });
  } catch (err) {
    console.error("list-results: failed to read Google Sheet", err);
    return NextResponse.json({ error: "Failed to read results from Google Sheets." }, { status: 502 });
  }
}
