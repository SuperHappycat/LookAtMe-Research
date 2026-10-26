/**
 * lib/research/exports/statsExport.ts
 * =====================================
 * "Export for SPSS · Stata · REDCap": the dashboard's session rows written as
 * a numerically coded data file plus the syntax / dictionary files each
 * program needs to label it, and a human-readable codebook.
 *
 * One list of variables (STATS_VARIABLES) drives every file, so the data,
 * SPSS syntax, Stata do-file, REDCap dictionary and codebook never disagree.
 *
 * Coded IDs only: the session UUID and the child code (children have no names
 * in this system). Blind sessions are dropped unless the caller is an org admin,
 * mirroring the RLS rule the dashboard relies on.
 *
 * Pure module (no DOM): unit-tested in tests/stats-export.test.ts.
 */

import { RISK_THRESHOLDS, SCORING_WEIGHTS } from "../../scoring";
import { QUALITY_CONFIG } from "../quality";
import { ageInMonths } from "../screening";
import type { ExportSession } from "../exportCsv";
import { zipStore } from "./zip";

export type StatsKind = "string" | "integer" | "number" | "date" | "coded" | "binary";

export interface StatsCode {
  code: number;
  en: string;
  th: string;
}

export interface StatsVariable {
  /** Lowercase, letters/digits/underscore, starts with a letter, at most 26 chars (REDCap's advice; SPSS/Stata allow 32). */
  name: string;
  labelEn: string;
  labelTh: string;
  kind: StatsKind;
  /** Value labels for coded/binary variables. */
  codes?: readonly StatsCode[];
  units?: string;
  min?: number;
  max?: number;
  /** How the value is computed (codebook only). */
  note?: string;
  value: (s: ExportSession, ctx: StatsContext) => string | number | null;
}

export interface StatsContext {
  /** Minutes east of UTC used to turn timestamps into calendar dates (Thailand = +420). */
  tzOffsetMinutes: number;
}

export interface StatsExportOptions {
  /** Blind sessions are kept only for org admins (as the sessions RLS policy does). */
  viewerIsAdmin: boolean;
  /** Default 420 (Asia/Bangkok, UTC+7, no daylight saving). */
  tzOffsetMinutes?: number;
  generatedAt?: Date;
  /** Free text describing the dashboard filters in force, written into the codebook. */
  filterNote?: string;
}

export interface StatsExportFiles {
  "data.csv": string;
  "labels.sps": string;
  "labels.do": string;
  "redcap_dictionary.csv": string;
  "redcap_data.csv": string;
  "codebook.md": string;
}

// ---------------------------------------------------------------------------
// Code lists
// ---------------------------------------------------------------------------

const YES_NO: readonly StatsCode[] = [
  { code: 1, en: "Yes", th: "ใช่" },
  { code: 0, en: "No", th: "ไม่ใช่" },
];

export const SEX_CODES: readonly StatsCode[] = [
  { code: 1, en: "Male", th: "ชาย" },
  { code: 2, en: "Female", th: "หญิง" },
  { code: 9, en: "Unknown", th: "ไม่ทราบ" },
];
const SEX_MAP: Record<string, number> = { M: 1, F: 2, U: 9 };

export const STATUS_CODES: readonly StatsCode[] = [
  { code: 1, en: "Completed", th: "สมบูรณ์" },
  { code: 2, en: "Invalid - retest needed", th: "ไม่สมบูรณ์ ต้องทดสอบซ้ำ" },
  { code: 3, en: "Started - not finished", th: "เริ่มแล้วแต่ไม่เสร็จ" },
];
const STATUS_MAP: Record<string, number> = { completed: 1, invalid: 2, started: 3 };

export const RISK_CODES: readonly StatsCode[] = [
  { code: 1, en: "Low", th: "ต่ำ" },
  { code: 2, en: "Moderate", th: "ปานกลาง" },
  { code: 3, en: "High", th: "สูง" },
];
const RISK_MAP: Record<string, number> = { Low: 1, Moderate: 2, High: 3 };

export const ENGINE_CODES: readonly StatsCode[] = [
  { code: 1, en: "MediaPipe", th: "MediaPipe" },
  { code: 2, en: "OpenCV", th: "OpenCV" },
  { code: 9, en: "Other", th: "อื่น ๆ" },
];
const ENGINE_MAP: Record<string, number> = { mediapipe: 1, opencv: 2 };

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

const num = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

const bool01 = (v: boolean | null | undefined): number | null => (v === true ? 1 : v === false ? 0 : null);

/** Calendar date (YYYY-MM-DD) of an ISO timestamp at a fixed UTC offset. */
export function isoDate(ts: string | null, tzOffsetMinutes: number): string | null {
  if (!ts) return null;
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

const pct = { units: "%", min: 0, max: 100 } as const;
const w = SCORING_WEIGHTS;
const fmtW = (x: number) => x.toFixed(2);

// ---------------------------------------------------------------------------
// The variables (single source of truth)
// ---------------------------------------------------------------------------

export const STATS_VARIABLES: readonly StatsVariable[] = [
  {
    name: "session_id",
    labelEn: "Session ID (coded UUID; REDCap record ID)",
    labelTh: "รหัสการตรวจ (UUID)",
    kind: "string",
    note: "Unique per screening session. First field, so REDCap uses it as the record ID.",
    value: (s) => s.id,
  },
  {
    name: "child_code",
    labelEn: "Child code (coded ID set by the site)",
    labelTh: "รหัสเด็ก",
    kind: "string",
    note: "Coded identifier only; the system stores no names. Read as text so leading zeros are kept.",
    value: (s) => s.child?.code ?? null,
  },
  {
    name: "age_months",
    labelEn: "Age at the session (months)",
    labelTh: "อายุ ณ วันที่ตรวจ (เดือน)",
    kind: "integer",
    units: "months",
    min: 0,
    max: 240,
    note: "Whole months from the birth month to the month of the session (birth day is not recorded, so +/- 1 month).",
    value: (s) => ageInMonths(s.child?.birth_month ?? null, new Date(s.started_at)),
  },
  {
    name: "sex",
    labelEn: "Sex",
    labelTh: "เพศ",
    kind: "coded",
    codes: SEX_CODES,
    note: "9 = recorded as unknown; empty = not recorded. Treat 9 as missing if appropriate.",
    value: (s) => (s.child?.sex ? (SEX_MAP[s.child.sex] ?? null) : null),
  },
  {
    name: "session_date",
    labelEn: "Session date",
    labelTh: "วันที่ตรวจ",
    kind: "date",
    note: "Date the session started, in Thailand time (UTC+7).",
    value: (s, c) => isoDate(s.started_at, c.tzOffsetMinutes),
  },
  {
    name: "completed_date",
    labelEn: "Date the session was completed",
    labelTh: "วันที่ตรวจเสร็จ",
    kind: "date",
    note: "Thailand time (UTC+7). Empty if the session did not finish.",
    value: (s, c) => isoDate(s.completed_at, c.tzOffsetMinutes),
  },
  {
    name: "duration_min",
    labelEn: "Session duration (minutes)",
    labelTh: "ระยะเวลาการตรวจ (นาที)",
    kind: "number",
    units: "minutes",
    min: 0,
    note: "completed_at minus started_at, in minutes (1 decimal). Empty if not completed.",
    value: (s) => {
      if (!s.completed_at) return null;
      const d = (Date.parse(s.completed_at) - Date.parse(s.started_at)) / 60_000;
      return Number.isFinite(d) && d >= 0 ? Math.round(d * 10) / 10 : null;
    },
  },
  {
    name: "status",
    labelEn: "Session status",
    labelTh: "สถานะการตรวจ",
    kind: "coded",
    codes: STATUS_CODES,
    note: "Invalid = quality too low for a valid result (retest recommended).",
    value: (s) => STATUS_MAP[s.status] ?? null,
  },
  {
    name: "engine",
    labelEn: "Gaze-tracking engine",
    labelTh: "ระบบติดตามการมอง",
    kind: "coded",
    codes: ENGINE_CODES,
    value: (s) => (s.engine ? (ENGINE_MAP[s.engine] ?? 9) : null),
  },
  {
    name: "overall_score",
    labelEn: "Overall screening score (0-100)",
    labelTh: "คะแนนรวมการคัดกรอง (0-100)",
    kind: "number",
    units: "points (0-100)",
    min: 0,
    max: 100,
    note:
      `overall = ${fmtW(w.humanPreference)} x level1_human_pct + ${fmtW(w.faceAttention)} x level2_face_pct + ` +
      `${fmtW(w.jointAttention)} x level3_accuracy_pct (weights ${Math.round(w.humanPreference * 100)}/` +
      `${Math.round(w.faceAttention * 100)}/${Math.round(w.jointAttention * 100)}, lib/scoring.ts), clamped to 0-100.`,
    value: (s) => num(s.overall_score),
  },
  {
    name: "risk_level",
    labelEn: "Screening risk level (not a diagnosis)",
    labelTh: "ระดับความเสี่ยงจากการคัดกรอง (ไม่ใช่การวินิจฉัย)",
    kind: "coded",
    codes: RISK_CODES,
    note:
      `From overall_score: Low <= ${RISK_THRESHOLDS.lowMax}; Moderate > ${RISK_THRESHOLDS.lowMax} and <= ` +
      `${RISK_THRESHOLDS.moderateMax}; High > ${RISK_THRESHOLDS.moderateMax}. Research thresholds, not validated clinical cut-offs.`,
    value: (s) => (s.risk_level ? (RISK_MAP[s.risk_level] ?? null) : null),
  },
  {
    name: "level1_human_pct",
    labelEn: "Test 1: % looking at the human video",
    labelTh: "แบบทดสอบที่ 1: ร้อยละการมองวิดีโอคน",
    kind: "number",
    ...pct,
    note: "Human vs geometric video (social preference). Higher = more looking at the human video.",
    value: (s) => num(s.level1_score),
  },
  {
    name: "level2_face_pct",
    labelEn: "Test 2: % looking at the face",
    labelTh: "แบบทดสอบที่ 2: ร้อยละการมองใบหน้า",
    kind: "number",
    ...pct,
    note: "Face vs object.",
    value: (s) => num(s.level2_score),
  },
  {
    name: "level3_accuracy_pct",
    labelEn: "Test 3: joint attention accuracy (%)",
    labelTh: "แบบทดสอบที่ 3: ร้อยละความแม่นยำการมองตาม",
    kind: "number",
    ...pct,
    note: "% of samples on the target during the joint-attention test.",
    value: (s) => num(s.level3_score),
  },
  {
    name: "quality_score",
    labelEn: "Session quality score (0-100)",
    labelTh: "คะแนนคุณภาพการตรวจ (0-100)",
    kind: "number",
    units: "points (0-100)",
    min: 0,
    max: 100,
    note:
      `Weighted: face found ${QUALITY_CONFIG.weights.face}, lighting ${QUALITY_CONFIG.weights.lighting}, ` +
      `distance ${QUALITY_CONFIG.weights.distance} (lib/research/quality.ts; provisional, not a clinical cut-off).`,
    value: (s) => num(s.quality_score),
  },
  {
    name: "face_found_pct",
    labelEn: "% of samples with the face found",
    labelTh: "ร้อยละของเฟรมที่ตรวจพบใบหน้า",
    kind: "number",
    ...pct,
    note: `Below ${QUALITY_CONFIG.minFaceFoundPct}% the session is flagged for retest.`,
    value: (s) => num(s.face_found_pct),
  },
  {
    name: "retest_needed",
    labelEn: "Retest recommended",
    labelTh: "แนะนำให้ทดสอบซ้ำ",
    kind: "binary",
    codes: YES_NO,
    value: (s) => bool01(s.retest_needed),
  },
  {
    name: "calibration_error_px",
    labelEn: "Calibration mean error (pixels)",
    labelTh: "ค่าคลาดเคลื่อนเฉลี่ยของการปรับเทียบ (พิกเซล)",
    kind: "number",
    units: "pixels",
    min: 0,
    note: "Mean distance between calibration targets and estimated gaze; depends on screen size.",
    value: (s) => num(s.calibration_error_px),
  },
  {
    name: "low_accuracy",
    labelEn: "Calibration accuracy was low",
    labelTh: "ความแม่นยำการปรับเทียบต่ำ",
    kind: "binary",
    codes: YES_NO,
    value: (s) => bool01(s.low_accuracy),
  },
  {
    name: "blind",
    labelEn: "Blind session (result hidden from non-admin staff)",
    labelTh: "การตรวจแบบปกปิดผล",
    kind: "binary",
    codes: YES_NO,
    note: "Only org admins can export blind sessions.",
    value: (s) => bool01(s.blind),
  },
];

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** RFC 4180 cell: quoted when it contains a comma, quote, CR or LF; quotes doubled. */
export function csvField(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(Math.round(v * 1000) / 1000) : "";
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

const csvLine = (cells: readonly (string | number | null | undefined)[]) => cells.map(csvField).join(",");

/**
 * Data values, one array per session. Line breaks inside text are replaced by a
 * space: SPSS reads one case per line and would split the row.
 */
export function statsRows(sessions: readonly ExportSession[], opts: StatsExportOptions): (string | number | null)[][] {
  const ctx: StatsContext = { tzOffsetMinutes: opts.tzOffsetMinutes ?? 420 };
  return visibleSessions(sessions, opts).map((s) =>
    STATS_VARIABLES.map((v) => {
      const x = v.value(s, ctx);
      return typeof x === "string" ? x.replace(/\r\n|\r|\n/g, " ") : x;
    }),
  );
}

export function visibleSessions(sessions: readonly ExportSession[], opts: StatsExportOptions): ExportSession[] {
  return sessions.filter((s) => opts.viewerIsAdmin || s.blind !== true);
}

/** data.csv / redcap_data.csv: UTF-8 without BOM (a BOM can end up in the first variable name in Stata/SPSS). */
export function dataCsv(sessions: readonly ExportSession[], opts: StatsExportOptions): string {
  const lines = [csvLine(STATS_VARIABLES.map((v) => v.name)), ...statsRows(sessions, opts).map(csvLine)];
  return lines.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

const utf8Len = (s: string) => new TextEncoder().encode(s).length;
const both = (en: string, th: string) => (en === th ? en : `${en} / ${th}`);

/** Variable label, bilingual when it fits the program's limit. */
function varLabel(v: StatsVariable, fits: (s: string) => boolean): string {
  const b = both(v.labelEn, v.labelTh);
  return fits(b) ? b : v.labelEn;
}

const spssQ = (s: string) => `"${s.replace(/"/g, '""')}"`;
/** Stata: plain double quotes; strip characters Stata would treat as macro or quote syntax. */
const stataQ = (s: string) => `"${s.replace(/["`$\\]/g, "'")}"`;

function spssWidth(rows: readonly (string | number | null)[][], col: number): number {
  let max = 8;
  for (const r of rows) {
    const x = r[col];
    if (typeof x === "string") max = Math.max(max, utf8Len(x));
  }
  return Math.min(32767, max);
}

export function spssSyntax(sessions: readonly ExportSession[], opts: StatsExportOptions): string {
  const rows = statsRows(sessions, opts);
  const out: string[] = [];
  out.push(
    "* Encoding: UTF-8.",
    "* LookAtMe Research - SPSS syntax for data.csv (research screening data, not diagnostic).",
    "* 1) Unzip all files into one folder. 2) Put that folder in the CD command below and remove the asterisk.",
    "* 3) Run all (Run > All). Works in Unicode mode (default since SPSS 21).",
    "* CD 'C:\\path\\to\\unzipped\\folder'.",
    "",
    "GET DATA",
    "  /TYPE=TXT",
    "  /FILE='data.csv'",
    "  /ENCODING='UTF8'",
    "  /DELCASE=LINE",
    "  /DELIMITERS=\",\"",
    "  /QUALIFIER='\"'",
    "  /ARRANGEMENT=DELIMITED",
    "  /FIRSTCASE=2",
    "  /VARIABLES=",
  );
  STATS_VARIABLES.forEach((v, i) => {
    // Numbers are read with F*.0 (no implied decimals); display formats are set below.
    const fmt =
      v.kind === "string" ? `A${spssWidth(rows, i)}` : v.kind === "date" ? "SDATE10" : v.kind === "number" ? "F12.0" : "F8.0";
    out.push(`    ${v.name} ${fmt}`);
  });
  out.push(".", "CACHE.", "EXECUTE.", "DATASET NAME lookatme WINDOW=FRONT.", "");

  const numbers = STATS_VARIABLES.filter((v) => v.kind === "number").map((v) => v.name);
  const ints = STATS_VARIABLES.filter((v) => v.kind === "integer" || v.kind === "coded" || v.kind === "binary").map((v) => v.name);
  const dates = STATS_VARIABLES.filter((v) => v.kind === "date").map((v) => v.name);
  if (numbers.length) out.push(`FORMATS ${numbers.join(" ")} (F8.2).`);
  if (ints.length) out.push(`FORMATS ${ints.join(" ")} (F8.0).`);
  if (dates.length) out.push(`FORMATS ${dates.join(" ")} (SDATE10).`);
  out.push("");

  out.push("VARIABLE LABELS");
  STATS_VARIABLES.forEach((v, i) => {
    const sep = i === STATS_VARIABLES.length - 1 ? "." : "";
    out.push(`  ${v.name} ${spssQ(varLabel(v, (s) => utf8Len(s) <= 250))}${sep}`);
  });
  out.push("");

  const coded = STATS_VARIABLES.filter((v) => v.codes);
  if (coded.length) {
    out.push("VALUE LABELS");
    coded.forEach((v, i) => {
      out.push(`  ${i === 0 ? "" : "/"}${v.name}`);
      for (const c of v.codes!) out.push(`    ${c.code} ${spssQ(both(c.en, c.th))}`);
    });
    out.push(".", "");
  }

  const nominal = STATS_VARIABLES.filter((v) => v.kind === "coded" || v.kind === "binary" || v.kind === "string").map((v) => v.name);
  const scale = STATS_VARIABLES.filter((v) => v.kind === "number" || v.kind === "integer" || v.kind === "date").map((v) => v.name);
  const ordinal = ["risk_level"].filter((n) => nominal.includes(n));
  const nominalOnly = nominal.filter((n) => !ordinal.includes(n));
  out.push(`VARIABLE LEVEL ${nominalOnly.join(" ")} (NOMINAL)`);
  if (ordinal.length) out.push(`  /${ordinal.join(" ")} (ORDINAL)`);
  out.push(`  /${scale.join(" ")} (SCALE).`, "", "EXECUTE.", "");
  return out.join("\r\n");
}

export function stataDo(): string {
  const idx = (pred: (v: StatsVariable) => boolean) =>
    STATS_VARIABLES.map((v, i) => (pred(v) ? i + 1 : 0)).filter((i) => i > 0).join(" ");
  const strCols = idx((v) => v.kind === "string" || v.kind === "date");
  const numCols = idx((v) => v.kind !== "string" && v.kind !== "date");
  const out: string[] = [];
  out.push(
    "* LookAtMe Research - Stata do-file for data.csv (research screening data, not diagnostic).",
    "* Encoding: UTF-8. Needs Stata 14 or later (Unicode).",
    "* Unzip all files into one folder, then:  cd \"path/to/unzipped/folder\"  and  do labels.do",
    "",
    "version 14",
    "clear",
    `import delimited using "data.csv", encoding("utf-8") varnames(1) delimiters(",") bindquote(strict) ` +
      `stringcols(${strCols}) numericcols(${numCols}) clear`,
    "",
    "* Dates: YYYY-MM-DD text -> Stata daily dates",
  );
  for (const v of STATS_VARIABLES.filter((x) => x.kind === "date")) {
    out.push(
      `generate double ${v.name}_d = date(${v.name}, "YMD")`,
      `format ${v.name}_d %tdCCYY-NN-DD`,
      `order ${v.name}_d, after(${v.name})`,
      `drop ${v.name}`,
      `rename ${v.name}_d ${v.name}`,
    );
  }
  out.push("", "* Variable labels");
  for (const v of STATS_VARIABLES) out.push(`label variable ${v.name} ${stataQ(varLabel(v, (s) => [...s].length <= 80))}`);
  out.push("", "* Value labels");
  for (const v of STATS_VARIABLES.filter((x) => x.codes)) {
    const lbl = `${v.name}_l`;
    out.push(`label define ${lbl} ${v.codes!.map((c) => `${c.code} ${stataQ(both(c.en, c.th))}`).join(" ")}, replace`);
    out.push(`label values ${v.name} ${lbl}`);
  }
  out.push("", "compress", "describe", "");
  return out.join("\r\n");
}

// ---------------------------------------------------------------------------
// REDCap
// ---------------------------------------------------------------------------

export const REDCAP_HEADERS = [
  "Variable / Field Name",
  "Form Name",
  "Section Header",
  "Field Type",
  "Field Label",
  "Choices, Calculations, OR Slider Labels",
  "Field Note",
  "Text Validation Type OR Show Slider Number",
  "Text Validation Min",
  "Text Validation Max",
  "Identifier?",
  "Branching Logic (Show field only if...)",
  "Required Field?",
  "Custom Alignment",
  "Question Number (surveys only)",
  "Matrix Group Name",
  "Matrix Ranking?",
  "Field Annotation",
] as const;

export const REDCAP_FORM = "lookatme_session";

export function redcapDictionary(): string {
  const lines = [csvLine([...REDCAP_HEADERS])];
  STATS_VARIABLES.forEach((v, i) => {
    let type = "text";
    let choices = "";
    let validation = "";
    if (v.kind === "coded") {
      type = "dropdown";
      choices = v.codes!.map((c) => `${c.code}, ${both(c.en, c.th).replace(/\|/g, "/")}`).join(" | ");
    } else if (v.kind === "binary") {
      type = "yesno"; // REDCap's built-in 1 = Yes, 0 = No
    } else if (v.kind === "integer") validation = "integer";
    else if (v.kind === "number") validation = "number";
    else if (v.kind === "date") validation = "date_ymd";
    const ranged = v.kind === "integer" || v.kind === "number";
    lines.push(
      csvLine([
        v.name,
        REDCAP_FORM,
        i === 0 ? "LookAtMe screening session (research use, not diagnostic)" : "",
        type,
        both(v.labelEn, v.labelTh),
        choices,
        v.units ?? "",
        validation,
        ranged && v.min !== undefined ? v.min : "",
        ranged && v.max !== undefined ? v.max : "",
        "",
        "",
        i === 0 ? "y" : "",
        "",
        "",
        "",
        "",
        "",
      ]),
    );
  });
  return lines.join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// Codebook
// ---------------------------------------------------------------------------

const md = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

const KIND_LABEL: Record<StatsKind, string> = {
  string: "text",
  integer: "integer",
  number: "numeric",
  date: "date (YYYY-MM-DD)",
  coded: "categorical (numeric code)",
  binary: "binary (1/0)",
};

export function codebookMd(sessions: readonly ExportSession[], opts: StatsExportOptions): string {
  const n = visibleSessions(sessions, opts).length;
  const at = (opts.generatedAt ?? new Date()).toISOString();
  const out: string[] = [
    "# LookAtMe Research - codebook / คู่มือตัวแปร",
    "",
    `Generated / สร้างเมื่อ: ${at} · Sessions / จำนวนการตรวจ: ${n}`,
    ...(opts.filterNote ? [`Filters / ตัวกรอง: ${md(opts.filterNote)}`] : []),
    "",
    "> **Research screening instrument - not a diagnostic test.** Scores and risk levels are for research and " +
      "screening only and must not be used alone to diagnose autism or any other condition.",
    "> **เครื่องมือคัดกรองเพื่อการวิจัย ไม่ใช่การวินิจฉัย** คะแนนและระดับความเสี่ยงใช้เพื่อการวิจัยและการคัดกรองเท่านั้น " +
      "ห้ามใช้เพียงอย่างเดียวในการวินิจฉัยโรคออทิซึมหรือภาวะอื่นใด",
    "",
    "Using these data in research requires approval from your institution's ethics committee. " +
      "Records carry coded IDs only (session UUID, child code); there are no names.",
    "การนำข้อมูลไปใช้ในงานวิจัยต้องได้รับอนุมัติจากคณะกรรมการจริยธรรมการวิจัยของหน่วยงาน ข้อมูลมีเพียงรหัส ไม่มีชื่อเด็ก",
    "",
    "## Files / ไฟล์",
    "",
    "| File | Use |",
    "|---|---|",
    "| data.csv | One row per session. UTF-8 (no BOM), comma-separated, numeric codes, missing = empty cell. |",
    "| labels.sps | SPSS: set the folder in the CD line, then Run All. Reads data.csv and applies variable/value labels. |",
    "| labels.do | Stata 14+: `cd` to the folder, then `do labels.do`. |",
    "| redcap_dictionary.csv | REDCap: Project Setup > Data Dictionary > upload. One instrument, `" + REDCAP_FORM + "`. |",
    "| redcap_data.csv | REDCap: Data Import Tool (CSV, rows = records, dates Y-M-D). Same fields as the dictionary. |",
    "| codebook.md | This file. |",
    "",
    "## Variables / ตัวแปร",
    "",
    "| # | Variable | Label (EN) | คำอธิบาย (TH) | Type | Values / codes | Units | Notes |",
    "|---|---|---|---|---|---|---|---|",
  ];
  STATS_VARIABLES.forEach((v, i) => {
    const values = v.codes
      ? v.codes.map((c) => `${c.code} = ${both(c.en, c.th)}`).join("; ")
      : v.min !== undefined || v.max !== undefined
        ? `${v.min ?? ""}-${v.max ?? ""}`
        : "";
    out.push(
      `| ${i + 1} | \`${v.name}\` | ${md(v.labelEn)} | ${md(v.labelTh)} | ${KIND_LABEL[v.kind]} | ${md(values)} | ${md(v.units ?? "")} | ${md(v.note ?? "")} |`,
    );
  });
  out.push(
    "",
    "## Scoring / การคิดคะแนน",
    "",
    `- Overall score = ${fmtW(w.humanPreference)} x Test 1 + ${fmtW(w.faceAttention)} x Test 2 + ${fmtW(w.jointAttention)} x Test 3, clamped to 0-100 (lib/scoring.ts).`,
    `- Risk level: Low <= ${RISK_THRESHOLDS.lowMax} < Moderate <= ${RISK_THRESHOLDS.moderateMax} < High.`,
    `- Quality score: face found ${QUALITY_CONFIG.weights.face}, lighting ${QUALITY_CONFIG.weights.lighting}, distance ${QUALITY_CONFIG.weights.distance}; retest if face found < ${QUALITY_CONFIG.minFaceFoundPct}%. Provisional thresholds, to be tuned with pilot data.`,
    "- Missing values are empty cells in every file. Line breaks inside text are replaced with spaces.",
    "- Dates are calendar dates in Thailand time (UTC+7).",
    "",
  );
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Bundle
// ---------------------------------------------------------------------------

export function buildStatsExport(sessions: readonly ExportSession[], opts: StatsExportOptions): StatsExportFiles {
  const data = dataCsv(sessions, opts);
  return {
    "data.csv": data,
    "labels.sps": spssSyntax(sessions, opts),
    "labels.do": stataDo(),
    "redcap_dictionary.csv": redcapDictionary(),
    "redcap_data.csv": data,
    "codebook.md": codebookMd(sessions, opts),
  };
}

export function statsExportZip(sessions: readonly ExportSession[], opts: StatsExportOptions): Uint8Array {
  const files = buildStatsExport(sessions, opts);
  return zipStore(
    Object.entries(files).map(([name, data]) => ({ name, data })),
    opts.generatedAt,
  );
}
