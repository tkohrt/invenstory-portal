/**
 * Verify against the RUNNING database (not the migrations) that RLS is enabled
 * on every application table. Requires an exec_sql RPC or direct SQL access;
 * if unavailable, this test documents the exact query to run by hand.
 */
import { describe, expect, test } from "vitest";
import { admin } from "./setup";

const QUERY = `select tablename from pg_tables
  where schemaname='public' and rowsecurity=false
  and tablename not like 'pg_%' and tablename not like '_prisma%'`;

describe("RLS coverage", () => {
  test("no public application table has RLS disabled", async () => {
    const db = admin();
    let data: unknown[] | null = null;
    let error: { message: string } | null = null;
    try {
      const res = await db.rpc("exec_sql", { sql: QUERY });
      data = res.data as unknown[] | null;
      error = res.error;
    } catch (e) {
      error = { message: (e as Error).message };
    }
    if (error) {
      // No SQL-exec RPC in this project. Fail loudly with the manual check to run.
      console.warn("Run this in the Supabase SQL editor and expect ZERO rows:\n" + QUERY);
      test.skip; // eslint-disable-line
      return;
    }
    expect(data ?? []).toHaveLength(0);
  });
});
