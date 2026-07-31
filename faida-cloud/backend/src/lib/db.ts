import pg, { type PoolClient, type QueryResultRow } from "pg";

const { Pool } = pg;

let pool: pg.Pool | undefined;

// A single process-wide pool, connected as the owning role (POSTGRES_USER
// from DATABASE_URL) — table owner, bypasses RLS. Fine for migrations, the
// seed loader, and other ops-only code. Anything handling a vendor request
// must go through withVendorContext() below instead, so RLS (DOC 05 §11)
// actually engages.
export function getPool(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    pool = new Pool({ connectionString });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

// Typed query helper. Parameterized queries only — no string-built SQL.
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await getPool().query<T>(text, params);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export interface VendorContext {
  vendorId: string;
  role?: string; // JWT role claim, e.g. 'vendor' | 'ops_admin'
}

// Runs `fn` inside a transaction with `SET LOCAL ROLE faida_app` plus the
// app.vendor_id / app.role session variables RLS policies key off (DOC 05
// §11 + the faida_app role granted in the RLS migration). SET LOCAL scopes
// both to the transaction — they're gone on commit/rollback, so nothing
// leaks across pooled connections. Every request handler that touches
// vendor-scoped tables must go through this, never getPool()/query() directly.
export async function withVendorContext<T>(
  ctx: VendorContext,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query("set local role faida_app");
    await client.query("select set_config('app.vendor_id', $1, true)", [ctx.vendorId]);
    await client.query("select set_config('app.role', $1, true)", [ctx.role ?? ""]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}
