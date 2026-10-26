/** SPSS / Stata / REDCap export bundle (lib/research/exports). Run with: npm test */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  REDCAP_HEADERS,
  STATS_VARIABLES,
  buildStatsExport,
  codebookMd,
  csvField,
  dataCsv,
  isoDate,
  redcapDictionary,
  spssSyntax,
  stataDo,
  statsExportZip,
  statsRows,
  type StatsExportOptions,
} from "../lib/research/exports/statsExport.ts";
import { crc32, zipStore } from "../lib/research/exports/zip.ts";
import type { ExportSession } from "../lib/research/exportCsv.ts";


function session(over: Partial<ExportSession> = {}): ExportSession {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    started_at: "2026-10-04T23:30:00.000Z", // 06:30 on 5 Oct in Bangkok
    completed_at: "2026-10-04T23:42:30.000Z",
    status: "completed",
    engine: "mediapipe",
    overall_score: 55.25,
    risk_level: "Moderate",
    level1_score: 60,
    level2_score: 50.5,
    level3_score: 55,
    quality_score: 88.123456,
    face_found_pct: 92,
    retest_needed: false,
    calibration_error_px: 41.7,
    low_accuracy: false,
    blind: false,
    child: { code: "CM-001", birth_month: "2023-04-01", sex: "F" },
    ...over,
  };
}

const ADMIN: StatsExportOptions = { viewerIsAdmin: true, generatedAt: new Date("2026-10-26T03:00:00Z") };

const SAMPLE: ExportSession[] = [
  session(),
  session({
    id: "22222222-2222-4222-8222-222222222222",
    status: "invalid",
    risk_level: null,
    overall_score: null,
    completed_at: null,
    retest_needed: true,
    engine: "opencv",
    child: { code: "รหัส,\"ก\"\nข", birth_month: null, sex: "U" },
  }),
  session({ id: "33333333-3333-4333-8333-333333333333", risk_level: "High", blind: true, child: { code: "007", birth_month: "2022-01-01", sex: "M" } }),
  session({ id: "44444444-4444-4444-8444-444444444444", risk_level: "Low", status: "started", engine: "weird", child: null }),
];

/** Minimal RFC 4180 parser (handles quotes, doubled quotes, embedded newlines). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\r") continue;
    else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

test("variable names are valid for SPSS, Stata and REDCap and unique", () => {
  const names = STATS_VARIABLES.map((v) => v.name);
  assert.equal(new Set(names).size, names.length);
  for (const n of names) {
    assert.match(n, /^[a-z][a-z0-9_]*$/, n);
    assert.ok(n.length <= 26, `${n} <= 26 chars (REDCap advice; Stata needs room for the _d / _l suffix)`);
  }
  assert.equal(names[0], "session_id", "first field is the REDCap record id");
  for (const v of STATS_VARIABLES) {
    if (v.kind === "coded" || v.kind === "binary") assert.ok(v.codes?.length, `${v.name} has codes`);
    if (v.codes) assert.equal(new Set(v.codes.map((c) => c.code)).size, v.codes.length, `${v.name} codes unique`);
  }
});

test("data.csv: header, coding, dates, missing values", () => {
  const rows = parseCsv(dataCsv(SAMPLE, ADMIN));
  const head = rows[0];
  assert.deepEqual(head, STATS_VARIABLES.map((v) => v.name));
  const col = (r: string[], name: string) => r[head.indexOf(name)];
  const [a, b, c, d] = rows.slice(1);
  assert.equal(rows.length, 5);
  assert.equal(col(a, "risk_level"), "2");
  assert.equal(col(c, "risk_level"), "3");
  assert.equal(col(d, "risk_level"), "1");
  assert.equal(col(b, "risk_level"), "");
  assert.equal(col(a, "status"), "1");
  assert.equal(col(b, "status"), "2");
  assert.equal(col(d, "status"), "3");
  assert.equal(col(a, "sex"), "2");
  assert.equal(col(b, "sex"), "9");
  assert.equal(col(c, "sex"), "1");
  assert.equal(col(d, "sex"), "");
  assert.equal(col(a, "engine"), "1");
  assert.equal(col(b, "engine"), "2");
  assert.equal(col(d, "engine"), "9");
  assert.equal(col(a, "blind"), "0");
  assert.equal(col(c, "blind"), "1");
  assert.equal(col(b, "retest_needed"), "1");
  assert.equal(col(a, "session_date"), "2026-10-05", "Bangkok calendar date");
  assert.equal(col(b, "completed_date"), "");
  assert.equal(col(a, "duration_min"), "12.5");
  assert.equal(col(a, "age_months"), "42");
  assert.equal(col(a, "quality_score"), "88.123");
  assert.equal(col(c, "child_code"), "007", "leading zeros kept");
  assert.equal(col(b, "overall_score"), "");
  for (const r of rows.slice(1)) for (const ds of ["session_date", "completed_date"]) assert.match(col(r, ds), /^(\d{4}-\d{2}-\d{2})?$/);
  assert.equal(isoDate("2026-10-05T17:00:00Z", 420), "2026-10-06");
  assert.equal(isoDate(null, 420), null);
});

test("blind sessions are dropped for non-admins and kept for admins", () => {
  const adminIds = statsRows(SAMPLE, ADMIN).map((r) => r[0]);
  const staffIds = statsRows(SAMPLE, { ...ADMIN, viewerIsAdmin: false }).map((r) => r[0]);
  assert.ok(adminIds.includes("33333333-3333-4333-8333-333333333333"));
  assert.ok(!staffIds.includes("33333333-3333-4333-8333-333333333333"));
  assert.equal(staffIds.length, 3);
  assert.match(codebookMd(SAMPLE, { ...ADMIN, viewerIsAdmin: false }), /Sessions \/ จำนวนการตรวจ: 3/);
});

test("every coded value in the data has a label, in every file", () => {
  const rows = statsRows(SAMPLE, ADMIN);
  const sps = spssSyntax(SAMPLE, ADMIN);
  const dofile = stataDo();
  const dict = parseCsv(redcapDictionary());
  STATS_VARIABLES.forEach((v, i) => {
    if (!v.codes) return;
    const codes = new Set(v.codes.map((c) => c.code));
    for (const r of rows) if (r[i] !== null) assert.ok(codes.has(r[i] as number), `${v.name}=${r[i]} is labelled`);
    // SPSS
    const block = sps.slice(sps.indexOf("VALUE LABELS"));
    for (const c of v.codes) assert.ok(block.includes(`${c.code} "${c.en} / ${c.th}"`) || block.includes(`${c.code} "${c.en}"`), `${v.name} ${c.code} in .sps`);
    // Stata
    const def = dofile.split(/\r\n/).find((l) => l.startsWith(`label define ${v.name}_l `));
    assert.ok(def, `${v.name} label define`);
    for (const c of v.codes) assert.ok(def!.includes(`${c.code} "`), `${v.name} ${c.code} in .do`);
    assert.ok(dofile.includes(`label values ${v.name} ${v.name}_l`));
    // REDCap
    const row = dict.find((r) => r[0] === v.name)!;
    if (v.kind === "binary") {
      assert.equal(row[3], "yesno");
      assert.deepEqual([...codes].sort(), [0, 1]);
    } else {
      assert.equal(row[3], "dropdown");
      const parsed = row[5].split(" | ").map((x) => Number(x.split(",")[0]));
      assert.deepEqual(parsed, v.codes.map((c) => c.code));
    }
  });
});

test("SPSS syntax reads data.csv as UTF-8 and covers every variable", () => {
  const sps = spssSyntax(SAMPLE, ADMIN);
  assert.match(sps, /GET DATA\r\n {2}\/TYPE=TXT/);
  assert.match(sps, /\/FILE='data\.csv'/);
  assert.match(sps, /\/ENCODING='UTF8'/);
  assert.match(sps, /\/FIRSTCASE=2/);
  const varsBlock = sps.slice(sps.indexOf("/VARIABLES="), sps.indexOf("CACHE."));
  const labels = sps.slice(sps.indexOf("VARIABLE LABELS"), sps.indexOf("VALUE LABELS"));
  for (const v of STATS_VARIABLES) {
    assert.match(varsBlock, new RegExp(`\\n {4}${v.name} (A\\d+|F\\d+\\.0|SDATE10)\\r`), `${v.name} read`);
    assert.match(labels, new RegExp(`\\n {2}${v.name} "`), `${v.name} labelled`);
  }
  assert.match(varsBlock, /session_date SDATE10/);
  // the Thai child code is 3 bytes per character: the A width must hold it
  const w = Number(/child_code A(\d+)/.exec(varsBlock)![1]);
  assert.ok(w >= new TextEncoder().encode("รหัส,\"ก\" ข").length);
  assert.ok(sps.includes("ระดับความเสี่ยง"), "Thai label present");
  assert.match(sps, /risk_level\r\n {4}1 "Low \/ ต่ำ"\r\n {4}2 "Moderate \/ ปานกลาง"\r\n {4}3 "High \/ สูง"/);
});

test("Stata do-file imports UTF-8 and labels every variable", () => {
  const d = stataDo();
  assert.match(d, /import delimited using "data\.csv", encoding\("utf-8"\) varnames\(1\)/);
  for (const v of STATS_VARIABLES) {
    const line = d.split("\r\n").find((l) => l.startsWith(`label variable ${v.name} "`));
    assert.ok(line, `${v.name} labelled`);
    const text = /"(.*)"$/.exec(line!)![1];
    assert.ok([...text].length <= 80, `${v.name} label within Stata's 80 chars`);
    assert.ok(!/[`$]/.test(text));
  }
  // string columns by position (1-based) include session_id and child_code, so codes like 007 stay text
  const strCols = /stringcols\(([\d ]+)\)/.exec(d)![1].split(" ").map(Number);
  const names = STATS_VARIABLES.map((v) => v.name);
  assert.ok(strCols.includes(names.indexOf("session_id") + 1));
  assert.ok(strCols.includes(names.indexOf("child_code") + 1));
  assert.match(d, /generate double session_date_d = date\(session_date, "YMD"\)/);
  assert.ok(d.includes("ชาย"), "Thai value label present");
});

test("REDCap dictionary: standard headers, one row per variable, validations", () => {
  const dict = parseCsv(redcapDictionary());
  assert.deepEqual(dict[0], [...REDCAP_HEADERS]);
  assert.equal(dict[0].length, 18);
  assert.deepEqual(dict.slice(1).map((r) => r[0]), STATS_VARIABLES.map((v) => v.name));
  for (const r of dict.slice(1)) assert.equal(r.length, 18);
  const byName = new Map(dict.slice(1).map((r) => [r[0], r]));
  assert.equal(byName.get("session_id")![3], "text");
  assert.equal(byName.get("session_date")![7], "date_ymd");
  assert.equal(byName.get("overall_score")![7], "number");
  assert.equal(byName.get("overall_score")![8], "0");
  assert.equal(byName.get("overall_score")![9], "100");
  assert.equal(byName.get("age_months")![7], "integer");
  assert.equal(byName.get("risk_level")![5], "1, Low / ต่ำ | 2, Moderate / ปานกลาง | 3, High / สูง");
  // redcap_data.csv uses exactly the dictionary's field names, record id first
  const files = buildStatsExport(SAMPLE, ADMIN);
  assert.deepEqual(parseCsv(files["redcap_data.csv"])[0], dict.slice(1).map((r) => r[0]));
});

test("codebook lists every variable with Thai labels and the not-diagnostic note", () => {
  const cb = codebookMd(SAMPLE, { ...ADMIN, filterNote: "risk = High" });
  for (const v of STATS_VARIABLES) {
    assert.ok(cb.includes(`\`${v.name}\``), v.name);
    assert.ok(cb.includes(v.labelTh), `${v.name} Thai label`);
  }
  assert.match(cb, /not a diagnostic test/);
  assert.match(cb, /ไม่ใช่การวินิจฉัย/);
  assert.match(cb, /0\.40 x Test 1 \+ 0\.35 x Test 2 \+ 0\.25 x Test 3/);
  assert.match(cb, /Low <= 39 < Moderate <= 69 < High/);
  assert.match(cb, /Filters \/ ตัวกรอง: risk = High/);
});

test("CSV escaping of commas, quotes and newlines; Thai text round-trips", () => {
  assert.equal(csvField('a,"b"'), '"a,""b"""');
  assert.equal(csvField("line1\nline2"), '"line1\nline2"');
  assert.equal(csvField("x\ry"), '"x\ry"');
  assert.equal(csvField("plain"), "plain");
  assert.equal(csvField(null), "");
  assert.equal(csvField(Number.NaN), "");
  const csv = dataCsv(SAMPLE, ADMIN);
  // The newline inside the child code is flattened (SPSS reads one case per line); comma and quote are escaped.
  assert.ok(csv.includes('"รหัส,""ก"" ข"'));
  const rows = parseCsv(csv);
  assert.equal(rows.length, 1 + SAMPLE.length);
  for (const r of rows) assert.equal(r.length, STATS_VARIABLES.length);
  assert.equal(rows[2][1], 'รหัส,"ก" ข');
  // UTF-8 bytes decode back to the same Thai text; no BOM
  const bytes = new TextEncoder().encode(csv);
  assert.notEqual(bytes[0], 0xef);
  assert.equal(new TextDecoder("utf-8", { fatal: true }).decode(bytes), csv);
});

// ---------------------------------------------------------------------------
// ZIP
// ---------------------------------------------------------------------------

interface ParsedEntry {
  name: string;
  data: Uint8Array;
  crc: number;
}

/** Walks local headers and the central directory, checking they agree. */
function readZip(buf: Uint8Array): ParsedEntry[] {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const eocd = buf.length - 22;
  assert.equal(v.getUint32(eocd, true), 0x06054b50, "EOCD signature");
  const count = v.getUint16(eocd + 10, true);
  const cdSize = v.getUint32(eocd + 12, true);
  const cdStart = v.getUint32(eocd + 16, true);
  assert.equal(cdStart + cdSize, eocd, "central directory ends at EOCD");
  const dec = new TextDecoder();
  const out: ParsedEntry[] = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    assert.equal(v.getUint32(p, true), 0x04034b50, "local header signature");
    assert.equal(v.getUint16(p + 8, true), 0, "STORE");
    const crc = v.getUint32(p + 14, true);
    const csize = v.getUint32(p + 18, true);
    const usize = v.getUint32(p + 22, true);
    assert.equal(csize, usize);
    const nlen = v.getUint16(p + 26, true);
    const xlen = v.getUint16(p + 28, true);
    const name = dec.decode(buf.subarray(p + 30, p + 30 + nlen));
    const data = buf.subarray(p + 30 + nlen + xlen, p + 30 + nlen + xlen + csize);
    out.push({ name, data, crc });
    p += 30 + nlen + xlen + csize;
  }
  assert.equal(p, cdStart, "local entries end where the central directory starts");
  let q = cdStart;
  for (let i = 0; i < count; i++) {
    assert.equal(v.getUint32(q, true), 0x02014b50, "central header signature");
    assert.equal(v.getUint32(q + 16, true), out[i].crc);
    const nlen = v.getUint16(q + 28, true);
    const off = v.getUint32(q + 42, true);
    assert.equal(dec.decode(buf.subarray(q + 46, q + 46 + nlen)), out[i].name);
    assert.equal(v.getUint32(off, true), 0x04034b50, "offset points at a local header");
    q += 46 + nlen + v.getUint16(q + 30, true) + v.getUint16(q + 32, true);
  }
  assert.equal(q, eocd);
  return out;
}

test("crc32 matches known values", () => {
  const enc = new TextEncoder();
  assert.equal(crc32(enc.encode("")), 0);
  assert.equal(crc32(enc.encode("123456789")), 0xcbf43926);
  assert.equal(crc32(enc.encode("The quick brown fox jumps over the lazy dog")), 0x414fa339);
});

test("zipStore writes a valid STORE archive with correct CRCs", () => {
  const zip = zipStore(
    [
      { name: "a.txt", data: "hello" },
      { name: "ไทย.txt", data: "สวัสดี" },
      { name: "empty", data: new Uint8Array(0) },
    ],
    new Date(2026, 9, 26, 10, 30, 0),
  );
  const entries = readZip(zip);
  assert.deepEqual(entries.map((e) => e.name), ["a.txt", "ไทย.txt", "empty"]);
  const dec = new TextDecoder();
  assert.equal(dec.decode(entries[1].data), "สวัสดี");
  for (const e of entries) assert.equal(e.crc, crc32(e.data));
});

test("the export zip holds all six files, byte-identical to the builders", () => {
  const zip = statsExportZip(SAMPLE, ADMIN);
  const entries = readZip(zip);
  const files = buildStatsExport(SAMPLE, ADMIN);
  assert.deepEqual(entries.map((e) => e.name).sort(), Object.keys(files).sort());
  const dec = new TextDecoder("utf-8", { fatal: true });
  for (const e of entries) {
    assert.equal(e.crc, crc32(e.data), `${e.name} CRC`);
    assert.equal(dec.decode(e.data), files[e.name as keyof typeof files], `${e.name} content`);
  }
});
