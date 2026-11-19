/**
 * A small in-memory stand-in for the Supabase query builder, for tests of the
 * server reads that decide what a client sees (patch 68). It implements the
 * calls those reads make and nothing else: an unknown call throws, so a test
 * can never pass against a filter the fake silently ignored.
 */
export type Row = Record<string, unknown>;
type Err = { message: string } | null;
type Res<T> = { data: T; error: Err };

export class FakeDb {
  tables: Record<string, Row[]> = {};
  /** Unique keys per table, for upsert's onConflict. */
  private seq = 0;
  /** Every table read or written, in order, with the filters used: lets a test assert a query was scoped. */
  log: { table: string; op: string; filters: string[] }[] = [];
  /** Return an error to make a call fail (a missing column, a dropped connection). `cols` is the select list or the written keys. */
  failOn: ((q: { table: string; op: string; cols: string; filters: string[] }) => Err | undefined) | null = null;

  /**
   * Columns the real database generates from the row (migration 0101's
   * opp_host and opp_funder). Worked out at read time, never stored, so a
   * test cannot pass by writing a column the database would refuse.
   */
  computed: Record<string, (r: Row) => Row> = {};

  seed(table: string, rows: Row[]) { this.tables[table] = rows.map(r => ({ ...r })); return this; }
  rows(table: string): Row[] { return (this.tables[table] ??= []); }

  from = (table: string) => new Query(this, table);
  nextId() { this.seq += 1; return `gen-${this.seq}`; }
}

class Query implements PromiseLike<Res<Row[] | null>> {
  private preds: ((r: Row) => boolean)[] = [];
  private filters: string[] = [];
  private op: "select" | "update" | "delete" = "select";
  private patch: Row = {};
  private max: number | null = null;
  private sort: { col: string; asc: boolean }[] = [];
  constructor(private db: FakeDb, private table: string) {}

  private cols = "";
  select(cols?: string) { this.cols = cols ?? "*"; return this; }
  private failure(): Err { return this.db.failOn?.({ table: this.table, op: this.op, cols: this.op === "update" ? Object.keys(this.patch).join(",") : this.cols, filters: this.filters }) ?? null; }
  private where(name: string, p: (r: Row) => boolean) { this.preds.push(p); this.filters.push(name); return this; }
  eq(col: string, v: unknown) { return this.where(`eq:${col}`, r => r[col] === v); }
  neq(col: string, v: unknown) { return this.where(`neq:${col}`, r => r[col] !== v); }
  in(col: string, vs: unknown[]) { return this.where(`in:${col}`, r => vs.includes(r[col])); }
  gte(col: string, v: string) { return this.where(`gte:${col}`, r => String(r[col] ?? "") >= v); }
  is(col: string, v: null) { return this.where(`is:${col}`, r => (r[col] ?? null) === v); }
  not(col: string, op: string, v: unknown) {
    if (op !== "is" || v !== null) throw new Error(`fake-db: not(${col}, ${op}) is not implemented`);
    return this.where(`notnull:${col}`, r => (r[col] ?? null) !== null);
  }
  like(col: string, pattern: string) {
    const prefix = pattern.replace(/%$/, "").replace(/\\(.)/g, "$1");
    return this.where(`like:${col}`, r => String(r[col] ?? "").startsWith(prefix));
  }
  order(col: string, o?: { ascending?: boolean }) { this.sort.push({ col, asc: o?.ascending !== false }); return this; }
  limit(n: number) { this.max = n; return this; }

  private run(): Row[] {
    this.db.log.push({ table: this.table, op: this.op, filters: [...this.filters] });
    const all = this.db.rows(this.table);
    const calc = this.db.computed[this.table];
    const view = (r: Row) => calc ? { ...r, ...calc(r) } : r;
    const hit = all.filter(r => this.preds.every(p => p(view(r))));
    if (this.op === "update") { for (const r of hit) Object.assign(r, this.patch); return hit; }
    if (this.op === "delete") { this.db.tables[this.table] = all.filter(r => !hit.includes(r)); return hit; }
    const out = [...hit];
    for (const s of [...this.sort].reverse()) out.sort((a, b) => String(a[s.col] ?? "").localeCompare(String(b[s.col] ?? "")) * (s.asc ? 1 : -1));
    return (this.max === null ? out : out.slice(0, this.max)).map(r => ({ ...view(r) }));
  }
  async maybeSingle(): Promise<Res<Row | null>> { const e = this.failure(); return e ? { data: null, error: e } : { data: this.run()[0] ?? null, error: null }; }
  async single(): Promise<Res<Row | null>> { const e = this.failure(); if (e) return { data: null, error: e }; const r = this.run()[0] ?? null; return { data: r, error: r ? null : { message: "no rows" } }; }
  then<A = Res<Row[] | null>, B = never>(ok?: ((v: Res<Row[] | null>) => A | PromiseLike<A>) | null, bad?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve().then(() => { const e = this.failure(); return e ? { data: null, error: e } : { data: this.run(), error: null as Err }; }).then(ok, bad);
  }

  update(patch: Row) { this.op = "update"; this.patch = patch; return this; }
  delete() { this.op = "delete"; return this; }
  async insert(row: Row | Row[]): Promise<{ error: Err }> {
    this.db.log.push({ table: this.table, op: "insert", filters: [] });
    for (const r of Array.isArray(row) ? row : [row]) {
      const e = this.db.failOn?.({ table: this.table, op: "insert", cols: Object.keys(r).join(","), filters: [] });
      if (e) return { error: e };
      const generated = Object.keys(this.db.computed[this.table]?.(r) ?? {}).find(k => k in r);
      if (generated) return { error: { message: `cannot insert a non-DEFAULT value into column "${generated}"` } };
    }
    for (const r of Array.isArray(row) ? row : [row]) this.db.rows(this.table).push({ id: this.db.nextId(), created_at: new Date().toISOString(), ...r });
    return { error: null };
  }
  async upsert(row: Row | Row[], o?: { onConflict?: string; ignoreDuplicates?: boolean }): Promise<{ error: Err }> {
    this.db.log.push({ table: this.table, op: "upsert", filters: [] });
    const keys = (o?.onConflict ?? "id").split(",").map(k => k.trim());
    for (const r of Array.isArray(row) ? row : [row]) {
      const had = this.db.rows(this.table).find(x => keys.every(k => x[k] === r[k]));
      if (!had) this.db.rows(this.table).push({ id: this.db.nextId(), ...r });
      else if (!o?.ignoreDuplicates) Object.assign(had, r);
    }
    return { error: null };
  }
}

/** ledger_overlay's generated columns, as migration 0101 defines them. */
export const overlayComputed = (r: Row): Row => {
  if (r.kind !== "grant") return { opp_host: null, opp_funder: null };
  const m = /^https?:\/\/(?:www\.)?([^/:#?\s]+)/.exec(String(r.source_url ?? "").toLowerCase());
  const agency = String((r.fields as Row | undefined)?.agency ?? "").toLowerCase().replace(/^\s*the\s+/, "").replace(/[^a-z0-9]+/g, "");
  return { opp_host: m ? m[1] : null, opp_funder: agency || null };
};
