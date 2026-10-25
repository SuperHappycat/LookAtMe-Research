/** Google Drive (spec §4): crypto, OAuth state, token refresh, folders, upload verification, chunk math. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

process.env.DRIVE_TOKEN_KEY = randomBytes(32).toString("base64");
process.env.DRIVE_STATE_SECRET = "test-state-secret-0123456789abcdef";

const { decryptToken, encryptToken, signState, verifyState, signUploadUrl, verifyUploadUrl } = await import(
  "../lib/research/drive/crypto.ts"
);
const cfg = await import("../lib/research/drive/config.ts");
const g = await import("../lib/research/drive/google.ts");
const svcMod = await import("../lib/research/drive/service.ts");
const up = await import("../lib/research/drive/upload.ts");
const { handleCallback } = await import("../lib/research/drive/callback.ts");
const { deleteFilesWith } = await import("../lib/research/drive/deleteFiles.ts");
const { FakeDb, scriptedFetch, json } = await import("./drive-fakes.ts");

const ORG = "00000000-0000-0000-0000-00000000000a";
const USER = "10000000-0000-0000-0000-00000000000a";
const SESSION = "5e000000-0000-0000-0000-000000000001";
const client = { clientId: "cid", clientSecret: "secret", redirectUri: "http://localhost:3301/api/drive/callback" };
const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=ABC123";

// ------------------------------------------------------------------ crypto
test("token encryption round-trips, uses a fresh IV, and detects tampering", () => {
  const plain = "1//0refresh-token-value";
  const a = encryptToken(plain);
  const b = encryptToken(plain);
  assert.notEqual(a, b);
  assert.equal(a.split(":").length, 3);
  assert.ok(!a.includes(plain));
  assert.equal(decryptToken(a), plain);

  const [iv, tag, ct] = a.split(":");
  const ctBuf = Buffer.from(ct, "base64");
  ctBuf[0] ^= 1;
  assert.throws(() => decryptToken(`${iv}:${tag}:${ctBuf.toString("base64")}`));
  const tagBuf = Buffer.from(tag, "base64");
  tagBuf[3] ^= 0x80;
  assert.throws(() => decryptToken(`${iv}:${tagBuf.toString("base64")}:${ct}`));
  assert.throws(() => decryptToken(a, randomBytes(32).toString("base64")), "another key must fail");
  assert.throws(() => decryptToken("garbage"));
  assert.throws(() => encryptToken("x", Buffer.alloc(16).toString("base64")), /32 bytes/);
});

test("OAuth state: signed, expires after 10 minutes, rejects tampering", () => {
  const now = 1_800_000_000_000;
  const { state, nonce } = signState({ org_id: ORG, user_id: USER }, { now });
  const p = verifyState(state, { now: now + 60_000 });
  assert.equal(p.org_id, ORG);
  assert.equal(p.user_id, USER);
  assert.equal(p.nonce, nonce);
  assert.throws(() => verifyState(state, { now: now + 10 * 60_000 + 1 }), /state_expired/);
  const [body, sig] = state.split(".");
  const forged = Buffer.from(JSON.stringify({ ...p, org_id: "00000000-0000-0000-0000-00000000000b" })).toString("base64url");
  assert.throws(() => verifyState(`${forged}.${sig}`, { now }), /bad_state/);
  assert.throws(() => verifyState(`${body}.${sig}x`, { now }), /bad_state/);
  assert.throws(() => verifyState(state, { now, secret: "another-secret-0123456789" }), /bad_state/);
  assert.throws(() => verifyState("nodot", { now }), /bad_state/);
});

test("upload URL signatures bind the URL to a session", () => {
  const sig = signUploadUrl(UPLOAD_URL, SESSION);
  assert.ok(verifyUploadUrl(UPLOAD_URL, SESSION, sig));
  assert.ok(!verifyUploadUrl(UPLOAD_URL, "5e000000-0000-0000-0000-000000000002", sig));
  assert.ok(!verifyUploadUrl(UPLOAD_URL + "x", SESSION, sig));
});

// ------------------------------------------------------------------ config / chunk math
test("chunk sizes: 8 MiB direct, 3.75 MiB proxy, both multiples of 256 KiB and proxy under 4.5 MB", () => {
  assert.equal(cfg.CHUNK_UNIT, 262_144);
  assert.equal(cfg.DIRECT_CHUNK_BYTES, 8 * 1024 * 1024);
  assert.equal(cfg.PROXY_CHUNK_BYTES, 3_932_160);
  assert.equal(cfg.PROXY_CHUNK_BYTES % cfg.CHUNK_UNIT, 0);
  assert.equal(cfg.DIRECT_CHUNK_BYTES % cfg.CHUNK_UNIT, 0);
  assert.ok(cfg.PROXY_CHUNK_BYTES < cfg.VERCEL_BODY_LIMIT_BYTES - 64 * 1024, "room for headers");

  const size = 10_000_000;
  const r = cfg.chunkRanges(size, cfg.PROXY_CHUNK_BYTES);
  assert.equal(r.length, 3);
  assert.deepEqual(r[0], { start: 0, end: 3_932_159 });
  assert.equal(r[2].end, size - 1);
  for (const c of r.slice(0, -1)) assert.equal(c.end - c.start + 1, cfg.PROXY_CHUNK_BYTES);
  assert.equal(r.reduce((n, c) => n + c.end - c.start + 1, 0), size);
  assert.deepEqual(cfg.chunkRanges(size, cfg.DIRECT_CHUNK_BYTES, 8 * 1024 * 1024), [{ start: 8_388_608, end: size - 1 }]);
  assert.throws(() => cfg.chunkRanges(size, 1_000_000));
  assert.equal(cfg.contentRange(0, 99, 100), "bytes 0-99/100");
  assert.equal(cfg.nextOffsetFromRange("bytes=0-262143"), 262_144);
  assert.equal(cfg.nextOffsetFromRange(null), 0);
});

test("file names use the child code only; upload URLs are allow-listed", () => {
  const at = new Date("2026-10-25T03:07:00Z"); // 10:07 in Bangkok
  assert.equal(
    cfg.driveFileName("A-001", at, 2, SESSION),
    `A-001_20261025-1007_L2_${SESSION}.webm`,
  );
  assert.match(cfg.localFileName("ก ข/../x", at, 3), /^ก_ข_x_\d{8}-\d{4}_L3\.webm$/);
  assert.equal(cfg.rootFolderName("Hospital B"), "LookAtMe Recordings – Hospital B");
  assert.ok(cfg.isDriveUploadUrl(UPLOAD_URL));
  assert.ok(!cfg.isDriveUploadUrl("https://evil.example/upload/drive/v3/files?uploadType=resumable&upload_id=1"));
  assert.ok(!cfg.isDriveUploadUrl("http://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=1"));
  assert.ok(!cfg.isDriveUploadUrl("https://www.googleapis.com/drive/v3/files?uploadType=resumable&upload_id=1"));
  assert.ok(!cfg.isDriveUploadUrl("https://user@www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=1"));
});

test("auth URL asks for drive.file only, offline access and consent", () => {
  const u = new URL(g.buildAuthUrl(client, "st"));
  assert.equal(u.origin + u.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(u.searchParams.get("scope"), "openid email https://www.googleapis.com/auth/drive.file");
  assert.equal(u.searchParams.get("access_type"), "offline");
  assert.equal(u.searchParams.get("prompt"), "consent");
  assert.equal(u.searchParams.get("state"), "st");
  assert.ok(!u.toString().includes("drive.readonly"));
  assert.equal(g.qEscape("a'b\\c"), "a\\'b\\\\c");
});

// ------------------------------------------------------------------ token refresh
function connectedDb(extra: Record<string, unknown> = {}) {
  return new FakeDb({
    organizations: [{ id: ORG, name: "School A", drive_folder_id: "root1" }],
    drive_connections: [
      { org_id: ORG, google_email: "a@school.th", refresh_token_enc: encryptToken("RT"), status: "active", last_error: null, ...extra },
    ],
  });
}

const isToken = (c: { url: string }) => c.url === cfg.GOOGLE_TOKEN_URL;

test("refresh invalid_grant marks the connection needs_reconnect and returns 409", async () => {
  const db = connectedDb();
  const { f, calls } = scriptedFetch([[isToken, () => json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400)]]);
  await assert.rejects(svcMod.getAccessToken(db.client(), f, client, ORG), (e: InstanceType<typeof svcMod.DriveFlowError>) => {
    assert.equal(e.status, 409);
    assert.equal(e.code, "drive_needs_reconnect");
    return true;
  });
  assert.equal(db.t("drive_connections")[0].status, "needs_reconnect");
  assert.equal(db.t("drive_connections")[0].last_error, "invalid_grant");
  assert.match(String(calls[0].body), /grant_type=refresh_token/);
  assert.match(String(calls[0].body), /refresh_token=RT/);
  // Next call doesn't even reach Google.
  await assert.rejects(svcMod.getAccessToken(db.client(), f, client, ORG), /reconnect/);
  assert.equal(calls.length, 1);
});

test("access token: ok when active; not connected / revoked → drive_not_connected", async () => {
  const db = connectedDb();
  const { f } = scriptedFetch([[isToken, () => json({ access_token: "AT", expires_in: 3599 })]]);
  assert.equal(await svcMod.getAccessToken(db.client(), f, client, ORG), "AT");
  for (const d of [new FakeDb(), connectedDb({ status: "revoked", refresh_token_enc: null })]) {
    await assert.rejects(svcMod.getAccessToken(d.client(), f, client, ORG), (e: { code: string }) => e.code === "drive_not_connected");
  }
  const bad = connectedDb({ refresh_token_enc: "AAAA:BBBB:CCCC" });
  await assert.rejects(svcMod.getAccessToken(bad.client(), f, client, ORG), (e: { code: string }) => e.code === "drive_needs_reconnect");
  assert.equal(bad.t("drive_connections")[0].status, "needs_reconnect");
});

// ------------------------------------------------------------------ folders
test("root folder: kept when it exists (even if moved), recreated when deleted or trashed", async () => {
  const name = "LookAtMe Recordings – School A";
  {
    const { f, calls } = scriptedFetch([[(c) => c.url.includes("/files/root1"), () => json({ id: "root1", trashed: false, mimeType: cfg.FOLDER_MIME })]]);
    assert.deepEqual(await g.ensureRootFolder(f, "AT", "root1", name), { id: "root1", created: false });
    assert.equal(calls.length, 1);
  }
  for (const gone of [() => json({ error: { code: 404 } }, 404), () => json({ id: "root1", trashed: true, mimeType: cfg.FOLDER_MIME })]) {
    const db = connectedDb();
    const { f, calls } = scriptedFetch([
      [(c) => c.url.includes("/files/root1"), gone],
      [(c) => c.method === "POST" && c.url.startsWith(cfg.DRIVE_FILES_URL), () => json({ id: "root2" })],
    ]);
    assert.equal(await svcMod.ensureOrgRoot(db.client(), f, "AT", ORG), "root2");
    assert.equal(db.t("organizations")[0].drive_folder_id, "root2");
    const body = JSON.parse(String(calls[1].body));
    assert.equal(body.name, name);
    assert.equal(body.mimeType, cfg.FOLDER_MIME);
    assert.equal(body.parents, undefined);
  }
});

test("child folder: found by name under the root, else created there", async () => {
  {
    const { f, calls } = scriptedFetch([[(c) => c.method === "GET", () => json({ files: [{ id: "kid1" }] })]]);
    assert.equal(await g.ensureChildFolder(f, "AT", "root1", "A-'01"), "kid1");
    const q = new URL(calls[0].url).searchParams.get("q")!;
    assert.equal(q, `name='A-\\'01' and 'root1' in parents and mimeType='${cfg.FOLDER_MIME}' and trashed=false`);
    assert.equal(calls[0].headers.authorization, "Bearer AT");
  }
  {
    const { f, calls } = scriptedFetch([
      [(c) => c.method === "GET", () => json({ files: [] })],
      [(c) => c.method === "POST", () => json({ id: "kid2" })],
    ]);
    assert.equal(await g.ensureChildFolder(f, "AT", "root1", "A-001"), "kid2");
    assert.deepEqual(JSON.parse(String(calls[1].body)).parents, ["root1"]);
  }
});

// ------------------------------------------------------------------ start / finish upload
const sessionRef = { id: SESSION, orgId: ORG, childCode: "A-001", startedAt: "2026-10-25T03:07:00Z" };

function driveRoutes(extra: [(c: { url: string; method: string }) => boolean, () => Response][] = []) {
  return scriptedFetch([
    ...extra,
    [isToken, () => json({ access_token: "AT" })],
    [(c) => c.url.includes("/files/root1"), () => json({ id: "root1", trashed: false, mimeType: cfg.FOLDER_MIME })],
    [(c) => c.method === "GET" && c.url.includes("?q="), () => json({ files: [{ id: "kid1" }] })],
    [
      (c) => c.method === "POST" && c.url.startsWith(cfg.DRIVE_UPLOAD_URL),
      () => new Response(null, { status: 200, headers: { location: UPLOAD_URL } }),
    ],
  ]);
}

test("start-upload: resumable session in the child folder, with Origin and appProperties", async () => {
  const db = connectedDb();
  const { f, calls } = driveRoutes();
  const out = await up.startUpload({ svc: db.client(), f, client }, sessionRef, {
    size: 1_500_000,
    mimeType: "video/webm;codecs=vp9",
    level: 2,
    origin: "https://research.lookat-me.online",
  });
  assert.equal(out.uploadUrl, UPLOAD_URL);
  const start = calls.find((c) => c.url.startsWith(cfg.DRIVE_UPLOAD_URL))!;
  assert.match(start.url, /uploadType=resumable/);
  assert.equal(start.headers.origin, "https://research.lookat-me.online");
  assert.equal(start.headers["x-upload-content-length"], "1500000");
  assert.equal(start.headers["x-upload-content-type"], "video/webm");
  const meta = JSON.parse(String(start.body));
  assert.deepEqual(meta.parents, ["kid1"]);
  assert.deepEqual(meta.appProperties, { lookatme_session: SESSION, lookatme_org: ORG, lookatme_level: "2" });
  assert.equal(meta.name, `A-001_20261025-1007_L2_${SESSION}.webm`);
  // No token in anything returned.
  assert.ok(!JSON.stringify(out).includes("AT\""));
});

test("start-upload: Drive full → 507 drive_full and last_error noted; bad sizes rejected", async () => {
  const db = connectedDb();
  const { f } = driveRoutes([
    [
      (c) => c.method === "POST" && c.url.startsWith(cfg.DRIVE_UPLOAD_URL),
      () => json({ error: { errors: [{ reason: "storageQuotaExceeded" }], code: 403, message: "The user's Drive storage quota has been exceeded." } }, 403),
    ],
  ]);
  await assert.rejects(
    up.startUpload({ svc: db.client(), f, client }, sessionRef, { size: 10, mimeType: "video/webm", level: 1, origin: "http://x" }),
    (e: { status: number; code: string }) => e.status === 507 && e.code === "drive_full",
  );
  assert.equal(db.t("drive_connections")[0].last_error, "storage_quota");
  assert.throws(() => up.validateUploadRequest(0, "video/webm"));
  assert.throws(() => up.validateUploadRequest(300 * 1024 * 1024, "video/webm"));
  assert.equal(up.validateUploadRequest(5, "text/html").mimeType, "video/webm");
});

test("verifyRecordingFile checks session, org, level, size and trash", () => {
  const ok = { id: "f1", size: "100", appProperties: { lookatme_session: SESSION, lookatme_org: ORG, lookatme_level: "1" } };
  const exp = { sessionId: SESSION, orgId: ORG, level: 1, size: 100 };
  assert.equal(g.verifyRecordingFile(ok, exp), null);
  assert.equal(g.verifyRecordingFile({ ...ok, appProperties: { ...ok.appProperties, lookatme_session: "other" } }, exp), "session_mismatch");
  assert.equal(g.verifyRecordingFile({ ...ok, appProperties: { lookatme_session: SESSION } }, exp), "org_mismatch");
  assert.equal(g.verifyRecordingFile({ ...ok, appProperties: { ...ok.appProperties, lookatme_level: "3" } }, exp), "level_mismatch");
  assert.equal(g.verifyRecordingFile({ ...ok, size: "99" }, exp), "size_mismatch");
  assert.equal(g.verifyRecordingFile({ ...ok, trashed: true }, exp), "file_trashed");
  assert.equal(g.verifyRecordingFile({ id: "f1" }, exp), "session_mismatch");
});

test("finish-upload: verified file → session_files row (google_drive, level); mismatch or missing refused", async () => {
  const db = connectedDb();
  const meta = { id: "file_abcdefghij", size: "1500", appProperties: { lookatme_session: SESSION, lookatme_org: ORG, lookatme_level: "3" } };
  const { f, calls } = scriptedFetch([
    [isToken, () => json({ access_token: "AT" })],
    [(c) => c.url.includes("/files/file_abcdefghij"), () => json(meta)],
    [(c) => c.url.includes("/files/file_otherxxxxx"), () => json({ ...meta, id: "file_otherxxxxx", appProperties: { lookatme_session: "x", lookatme_org: ORG } })],
    [(c) => c.url.includes("/files/file_missingxx"), () => json({ error: { code: 404 } }, 404)],
  ]);
  const deps = { svc: db.client(), f, client };
  const out = await up.finishUpload(deps, sessionRef, { driveFileId: "file_abcdefghij", level: 3, size: 1500 });
  assert.deepEqual(out, { fileId: "file_abcdefghij", sizeBytes: 1500 });
  assert.match(calls.find((c) => c.url.includes("file_abcdefghij"))!.url, /fields=.*appProperties/);
  const rows = db.t("session_files");
  assert.equal(rows.length, 1);
  assert.deepEqual(
    { kind: rows[0].kind, level: rows[0].level, location: rows[0].location, drive_file_id: rows[0].drive_file_id, org_id: rows[0].org_id },
    { kind: "recording", level: 3, location: "google_drive", drive_file_id: "file_abcdefghij", org_id: ORG },
  );
  // Idempotent: same level again updates the same row.
  await up.finishUpload(deps, sessionRef, { driveFileId: "file_abcdefghij", level: 3 });
  assert.equal(db.t("session_files").length, 1);

  await assert.rejects(up.finishUpload(deps, sessionRef, { driveFileId: "file_otherxxxxx", level: 3 }), (e: { status: number }) => e.status === 422);
  await assert.rejects(
    up.finishUpload(deps, sessionRef, { driveFileId: "file_missingxx", level: 3 }),
    (e: { code: string; message: string }) => e.code === "drive_file_not_found" && /ไม่พบไฟล์ใน Google Drive/.test(e.message),
  );
  await assert.rejects(up.finishUpload(deps, sessionRef, { driveFileId: "../../x", level: 3 }), (e: { status: number }) => e.status === 400);
  assert.equal(db.t("session_files").length, 1);
});

test("finish-upload / local_only never replace a recording already in Drive", async () => {
  const db = connectedDb();
  db.t("session_files").push({ org_id: ORG, session_id: SESSION, kind: "recording", level: 2, location: "google_drive", drive_file_id: "file_firstxxxxx" });
  const meta = { id: "file_secondxxxx", size: "10", appProperties: { lookatme_session: SESSION, lookatme_org: ORG, lookatme_level: "2" } };
  const { f } = scriptedFetch([
    [isToken, () => json({ access_token: "AT" })],
    [(c) => c.url.includes("/files/file_secondxxxx"), () => json(meta)],
  ]);
  await assert.rejects(up.finishUpload({ svc: db.client(), f, client }, sessionRef, { driveFileId: "file_secondxxxx", level: 2 }), (e: { status: number; code: string }) => e.status === 409 && e.code === "already_uploaded");
  await assert.rejects(up.recordLocalOnly(db.client(), sessionRef, 2, 5), (e: { status: number }) => e.status === 409);
  assert.equal(db.t("session_files")[0].drive_file_id, "file_firstxxxxx");
});

test("local_only recordings are recorded without a file id", async () => {
  const db = connectedDb();
  await up.recordLocalOnly(db.client(), sessionRef, 1, 1234);
  const r = db.t("session_files")[0];
  assert.deepEqual(
    { location: r.location, drive_file_id: r.drive_file_id, level: r.level, kind: r.kind, size_bytes: r.size_bytes },
    { location: "local_only", drive_file_id: null, level: 1, kind: "recording", size_bytes: 1234 },
  );
});

// ------------------------------------------------------------------ proxy chunks
test("upload-chunk validation: exact 256 KiB multiples, ≤ 3.75 MiB, matching length", () => {
  const P = cfg.PROXY_CHUNK_BYTES;
  assert.deepEqual(up.validateProxyChunk(`bytes 0-${P - 1}/10000000`, P), { query: false, start: 0, end: P - 1, total: 10_000_000 });
  assert.equal(up.validateProxyChunk(`bytes ${2 * P}-9999999/10000000`, 10_000_000 - 2 * P).query, false); // last chunk, any size
  assert.equal(up.validateProxyChunk("bytes */10000000", 0).query, true);
  assert.throws(() => up.validateProxyChunk(`bytes 0-${P}/10000000`, P + 1), /too large/);
  assert.throws(() => up.validateProxyChunk("bytes 0-99999/10000000", 100_000), /multiples/);
  assert.throws(() => up.validateProxyChunk("bytes 0-99/100", 50), /length/);
  assert.throws(() => up.validateProxyChunk("bytes 100-199/1000", 100), /256 KiB/);
  assert.throws(() => up.validateProxyChunk("bytes */100", 5));
  assert.throws(() => up.validateProxyChunk("nonsense", 0));
});

test("upload-chunk forwarding: only to Drive session URLs; maps 308 / 200 / quota", async () => {
  await assert.rejects(up.forwardChunk(fetch, "https://evil.example/x", "bytes */1", new Uint8Array()), /Not a Google Drive upload URL/);
  const { f, calls } = scriptedFetch([
    [(c) => c.headers["content-range"] === "bytes 0-262143/300000", () => new Response(null, { status: 308, headers: { range: "bytes=0-262143" } })],
    [(c) => c.headers["content-range"] === "bytes 262144-299999/300000", () => json({ id: "file_done12345" })],
    [(c) => c.headers["content-range"] === "bytes */300000", () => json({ error: { errors: [{ reason: "storageQuotaExceeded" }] } }, 403)],
  ]);
  assert.deepEqual(await up.forwardChunk(f, UPLOAD_URL, "bytes 0-262143/300000", new Uint8Array(262_144)), { done: false, nextOffset: 262_144 });
  assert.deepEqual(await up.forwardChunk(f, UPLOAD_URL, "bytes 262144-299999/300000", new Uint8Array(37_856)), { done: true, fileId: "file_done12345" });
  await assert.rejects(up.forwardChunk(f, UPLOAD_URL, "bytes */300000", new Uint8Array()), (e: { code: string }) => e.code === "drive_full");
  assert.equal(calls[0].headers.authorization, undefined, "no token is sent to the session URL");
});

// ------------------------------------------------------------------ callback
function fakeIdToken(email: string) {
  return `x.${Buffer.from(JSON.stringify({ email })).toString("base64url")}.y`;
}

test("callback: verifies state + nonce, requires refresh_token, stores it encrypted, creates root folder", async () => {
  const db = new FakeDb({ organizations: [{ id: ORG, name: "School A", drive_folder_id: null }] });
  const { state, nonce } = signState({ org_id: ORG, user_id: USER });
  const { f, calls } = scriptedFetch([
    [isToken, () => json({ access_token: "AT", refresh_token: "RT-NEW", id_token: fakeIdToken("admin@school.th") })],
    [(c) => c.method === "POST" && c.url.startsWith(cfg.DRIVE_FILES_URL), () => json({ id: "rootX" })],
  ]);
  const deps = { svc: db.client(), f, client, checkAdmin: async () => {} };

  assert.deepEqual(await handleCallback({ code: "c", state, error: null, nonceCookie: "wrong" }, deps), { ok: false, reason: "bad_state" });
  assert.deepEqual(await handleCallback({ code: "c", state, error: null, nonceCookie: null }, deps), { ok: false, reason: "bad_state" });
  assert.equal(calls.length, 0);

  const out = await handleCallback({ code: "c", state, error: null, nonceCookie: nonce }, deps);
  assert.equal(out.ok, true);
  const row = db.t("drive_connections")[0];
  assert.equal(row.status, "active");
  assert.equal(row.google_email, "admin@school.th");
  assert.notEqual(row.refresh_token_enc, "RT-NEW");
  assert.equal(decryptToken(String(row.refresh_token_enc)), "RT-NEW");
  assert.equal(db.t("organizations")[0].drive_folder_id, "rootX");
  assert.match(String(calls[0].body), /grant_type=authorization_code/);
});

test("callback: no refresh_token, expired state, not admin, Google error", async () => {
  const db = new FakeDb({ organizations: [{ id: ORG, name: "School A", drive_folder_id: null }] });
  const { f } = scriptedFetch([[isToken, () => json({ access_token: "AT" })]]);
  const deps = { svc: db.client(), f, client, checkAdmin: async () => {} };
  const s1 = signState({ org_id: ORG, user_id: USER });
  assert.equal((await handleCallback({ code: "c", state: s1.state, error: null, nonceCookie: s1.nonce }, deps)).ok, false);
  assert.equal(
    ((await handleCallback({ code: "c", state: s1.state, error: null, nonceCookie: s1.nonce }, deps)) as { reason: string }).reason,
    "no_refresh_token",
  );
  assert.equal(db.t("drive_connections").length, 0);

  const old = signState({ org_id: ORG, user_id: USER }, { now: Date.now() - 11 * 60_000 });
  assert.equal(((await handleCallback({ code: "c", state: old.state, error: null, nonceCookie: old.nonce }, deps)) as { reason: string }).reason, "state_expired");

  const notAdmin = { ...deps, checkAdmin: async () => Promise.reject(new Error("403")) };
  assert.equal(((await handleCallback({ code: "c", state: s1.state, error: null, nonceCookie: s1.nonce }, notAdmin)) as { reason: string }).reason, "not_admin");
  assert.equal(((await handleCallback({ code: null, state: s1.state, error: "access_denied", nonceCookie: s1.nonce }, deps)) as { reason: string }).reason, "access_denied");
});

// ------------------------------------------------------------------ deleteDriveFiles core
test("deleteDriveFiles: deletes, counts 404 as deleted, reports failures; all failed when not connected", async () => {
  const db = connectedDb();
  const { f } = scriptedFetch([
    [isToken, () => json({ access_token: "AT" })],
    [(c) => c.method === "DELETE" && c.url.endsWith("/f1"), () => new Response(null, { status: 204 })],
    [(c) => c.method === "DELETE" && c.url.endsWith("/gone"), () => json({ error: { code: 404 } }, 404)],
    [(c) => c.method === "DELETE" && c.url.endsWith("/locked"), () => json({ error: { code: 403, message: "forbidden" } }, 403)],
  ]);
  assert.deepEqual(await deleteFilesWith(db.client(), f, client, ORG, ["f1", "gone", "locked", "f1"]), { deleted: 2, failed: ["locked"] });
  assert.deepEqual(await deleteFilesWith(new FakeDb().client(), f, client, ORG, ["f1"]), { deleted: 0, failed: ["f1"] });
  assert.deepEqual(await deleteFilesWith(db.client(), f, client, ORG, []), { deleted: 0, failed: [] });
});

test("statusOf maps rows to DriveStatus", () => {
  assert.equal(svcMod.statusOf(null), "not_connected");
  const base = { org_id: ORG, google_email: null, connected_at: null, last_error: null };
  assert.equal(svcMod.statusOf({ ...base, status: "active", refresh_token_enc: "x" }), "active");
  assert.equal(svcMod.statusOf({ ...base, status: "active", refresh_token_enc: null }), "needs_reconnect");
  assert.equal(svcMod.statusOf({ ...base, status: "revoked", refresh_token_enc: null }), "revoked");
});
