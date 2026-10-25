/**
 * Test doubles for Drive tests: a tiny in-memory Supabase query builder and a scripted fetch.
 * (Not a test file itself: the runner only picks up *.test.ts.)
 */
import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;

export class FakeDb {
  tables: Record<string, Row[]> = {};
  constructor(init: Record<string, Row[]> = {}) {
    for (const [k, v] of Object.entries(init)) this.tables[k] = v.map((r) => ({ ...r }));
  }
  t(name: string): Row[] {
    return (this.tables[name] ??= []);
  }
  client(): SupabaseClient {
    return { from: (table: string) => new Query(this, table) } as unknown as SupabaseClient;
  }
}

class Query implements PromiseLike<{ data: unknown; error: null | { message: string } }> {
  private filters: ((r: Row) => boolean)[] = [];
  private op: "select" | "update" | "upsert" = "select";
  private payload: Row = {};
  private conflict: string[] = [];
  private single = false;
  private lim = Infinity;
  private db: FakeDb;
  private table: string;
  constructor(db: FakeDb, table: string) {
    this.db = db;
    this.table = table;
  }
  select() {
    return this;
  }
  eq(k: string, v: unknown) {
    this.filters.push((r) => r[k] === v);
    return this;
  }
  is(k: string, v: unknown) {
    this.filters.push((r) => (r[k] ?? null) === v);
    return this;
  }
  order() {
    return this;
  }
  limit(n: number) {
    this.lim = n;
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }
  update(p: Row) {
    this.op = "update";
    this.payload = p;
    return this;
  }
  upsert(p: Row, o: { onConflict?: string } = {}) {
    this.op = "upsert";
    this.payload = p;
    this.conflict = (o.onConflict ?? "id").split(",").map((s) => s.trim());
    return this;
  }
  private run() {
    const rows = this.db.t(this.table);
    if (this.op === "update") {
      rows.filter((r) => this.filters.every((f) => f(r))).forEach((r) => Object.assign(r, this.payload));
      return { data: null, error: null };
    }
    if (this.op === "upsert") {
      const hit = rows.find((r) => this.conflict.every((k) => r[k] === this.payload[k]));
      if (hit) Object.assign(hit, this.payload);
      else rows.push({ ...this.payload });
      return { data: null, error: null };
    }
    const out = rows.filter((r) => this.filters.every((f) => f(r))).slice(0, this.lim);
    return { data: this.single ? (out[0] ?? null) : out, error: null };
  }
  then<A, B>(ok?: ((v: { data: unknown; error: null }) => A) | null, bad?: ((e: unknown) => B) | null) {
    return Promise.resolve(this.run()).then(ok, bad) as PromiseLike<A | B> as Promise<A | B>;
  }
}

export interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** fetch double: routes are [predicate, responder]; records every call. */
export function scriptedFetch(routes: [(c: Call) => boolean, (c: Call) => Response | Promise<Response>][]) {
  const calls: Call[] = [];
  const f = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const h: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => (h[k] = v));
    const c: Call = { url: String(input), method: (init.method ?? "GET").toUpperCase(), headers: h, body: init.body };
    calls.push(c);
    const r = routes.find(([p]) => p(c));
    if (!r) throw new Error(`unexpected fetch ${c.method} ${c.url}`);
    return r[1](c);
  }) as typeof fetch;
  return { f, calls };
}

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
