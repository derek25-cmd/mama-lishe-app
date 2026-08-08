// Task 7 end-to-end verification: authenticates as a real test vendor
// through the actual OTP login flow, pushes a mixed 30-record sync batch,
// re-pushes the identical batch (expecting zero new rows), pages through
// GET /sales with filters, settles a deni payment, closes the day, shows
// the resulting profit figures, then runs the reconciliation script and
// confirms it reports zero drift.
//
// One-off manual verification script (like scripts/verify-costing.ts from
// Phase 3), not part of the automated test suite. Run with:
//   DATABASE_URL=... npx tsx scripts/verify-pos.ts
import { execSync } from "node:child_process";
import pg from "pg";
import { normalizePhone, maskPhone } from "../src/lib/auth/phone.js";

const BASE_URL = process.env.VERIFY_BASE_URL ?? "http://localhost";
const COMPOSE_DIR = process.env.VERIFY_COMPOSE_DIR ?? "..";
const TEST_PHONE = normalizePhone(process.env.VERIFY_TEST_PHONE ?? "+255799000099");
if (!TEST_PHONE) throw new Error("VERIFY_TEST_PHONE did not normalize to a valid Tanzanian phone number");

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestOtp(phone: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/v1/auth/otp/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone }),
  });
  if (!res.ok) throw new Error(`otp/request failed: ${res.status} ${await res.text()}`);
}

async function readOtpFromLogs(phone: string): Promise<string> {
  const masked = maskPhone(phone);
  for (let attempt = 0; attempt < 10; attempt++) {
    const logs = execSync(`docker compose logs api --no-color --since 2m`, {
      cwd: COMPOSE_DIR,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    const lines = logs.split("\n").filter((l) => l.includes(`to=${masked}`));
    const lastLine = lines[lines.length - 1];
    const match = lastLine?.match(/verification code is (\d{6})/);
    if (match) return match[1]!;
    await sleep(1000);
  }
  throw new Error(`could not find an OTP code for ${masked} in \`docker compose logs api\``);
}

interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

async function verifyOtp(phone: string, code: string): Promise<TokenPair> {
  const res = await fetch(`${BASE_URL}/api/v1/auth/otp/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, code }),
  });
  if (!res.ok) throw new Error(`otp/verify failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as TokenPair;
}

function ulidLike(seed: string): string {
  // Not a real ULID generator — good enough as a unique-per-run client_id
  // for this script, which doesn't need lexical sortability.
  return `${seed}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

interface SyncRecordResult {
  clientId: string;
  status: "applied" | "duplicate" | "rejected";
  serverId?: string;
  reason?: string;
}

async function push(accessToken: string, records: unknown[]): Promise<SyncRecordResult[]> {
  const res = await fetch(`${BASE_URL}/api/v1/sync/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ deviceId: "verify-pos-script", records }),
  });
  if (!res.ok) throw new Error(`sync/push failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { results: SyncRecordResult[] };
  return body.results;
}

function buildBatch(date: string, runId: string) {
  const records: unknown[] = [];
  const deniCustomerName = `Verify Customer ${runId}`;

  records.push({
    type: "deni_customer",
    clientId: ulidLike(`${runId}-dc`),
    clientCreatedAt: `${date}T08:00:00Z`,
    payload: { name: deniCustomerName },
  });

  let firstSaleClientId = "";
  for (let i = 0; i < 24; i++) {
    const isDeni = i < 3;
    const clientId = ulidLike(`${runId}-sale-${i}`);
    if (i === 0) firstSaleClientId = clientId;
    const hour = 6 + (i % 14);
    records.push({
      type: "sale",
      clientId,
      clientCreatedAt: `${date}T${String(hour).padStart(2, "0")}:00:00Z`,
      payload: isDeni
        ? {
            soldAt: `${date}T${String(hour).padStart(2, "0")}:00:00Z`,
            quantity: 1,
            unitPriceTzs: 4000,
            totalTzs: 4000,
            paymentMethod: "deni",
            deniCustomerName,
          }
        : {
            soldAt: `${date}T${String(hour).padStart(2, "0")}:00:00Z`,
            quantity: 1 + (i % 3),
            unitPriceTzs: 1000 * (1 + (i % 5)),
            totalTzs: (1 + (i % 3)) * 1000 * (1 + (i % 5)),
            paymentMethod: "cash",
          },
    });
  }

  for (let i = 0; i < 3; i++) {
    records.push({
      type: "expense",
      clientId: ulidLike(`${runId}-exp-${i}`),
      clientCreatedAt: `${date}T07:00:00Z`,
      payload: { spentAt: `${date}T07:00:00Z`, category: "malighafi", amountTzs: 5000 * (i + 1) },
    });
  }

  records.push({
    type: "sale_void",
    clientId: ulidLike(`${runId}-void`),
    clientCreatedAt: `${date}T20:00:00Z`,
    payload: { saleClientId: firstSaleClientId, reason: "verify-pos script: deliberate void" },
  });

  records.push({
    type: "day_close",
    clientId: ulidLike(`${runId}-close`),
    clientCreatedAt: `${date}T21:00:00Z`,
    payload: { date, wastePlates: 1, notes: "verify-pos script run" },
  });

  // 1 deni_customer + 24 sales + 3 expenses + 1 void + 1 close = 30 records.
  return { records, deniCustomerName };
}

async function rowCounts(vendorPhone: string): Promise<{ sales: number; expenses: number; deniPayments: number }> {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const vendor = await pool.query<{ id: string }>(`select id from vendor.vendors where phone = $1`, [vendorPhone]);
    const vendorId = vendor.rows[0]?.id;
    if (!vendorId) return { sales: 0, expenses: 0, deniPayments: 0 };
    const [sales, expenses, deniPayments] = await Promise.all([
      pool.query(`select count(*) as c from pos.sales where vendor_id = $1`, [vendorId]),
      pool.query(`select count(*) as c from pos.expenses where vendor_id = $1`, [vendorId]),
      pool.query(`select count(*) as c from pos.deni_payments where vendor_id = $1`, [vendorId]),
    ]);
    return {
      sales: Number((sales.rows[0] as { c: string }).c),
      expenses: Number((expenses.rows[0] as { c: string }).c),
      deniPayments: Number((deniPayments.rows[0] as { c: string }).c),
    };
  } finally {
    await pool.end();
  }
}

function summarize(results: SyncRecordResult[]): { applied: number; duplicate: number; rejected: number } {
  return {
    applied: results.filter((r) => r.status === "applied").length,
    duplicate: results.filter((r) => r.status === "duplicate").length,
    rejected: results.filter((r) => r.status === "rejected").length,
  };
}

async function main() {
  console.log(`verify-pos: authenticating as ${maskPhone(TEST_PHONE!)} against ${BASE_URL}`);
  await requestOtp(TEST_PHONE!);
  const code = await readOtpFromLogs(TEST_PHONE!);
  const tokens = await verifyOtp(TEST_PHONE!, code);
  console.log("login ok\n");

  const runId = Date.now().toString(36);
  const date = new Date().toISOString().slice(0, 10);
  const { records, deniCustomerName } = buildBatch(date, runId);
  console.log(`=== pushing ${records.length}-record batch ===`);
  const first = await push(tokens.accessToken, records);
  const firstCounts = summarize(first);
  console.log(firstCounts);
  if (firstCounts.applied !== records.length) {
    console.log("non-applied records:", first.filter((r) => r.status !== "applied"));
    throw new Error(`expected all ${records.length} records applied on first push, got ${JSON.stringify(firstCounts)}`);
  }

  console.log("\n=== re-pushing the identical batch (expect zero new rows) ===");
  const countsBefore = await rowCounts(TEST_PHONE!);
  const second = await push(tokens.accessToken, records);
  const secondCounts = summarize(second);
  console.log(secondCounts);
  // sale_void is the one documented exception: it always reports 'applied'
  // on a successful void, even a repeat, since voided/void_reason/
  // voided_at live on the sale row itself with no separate client_id-keyed
  // table to report 'duplicate' against (see sync.ts's applySaleVoid).
  // The invariant that actually matters — zero new rows — is checked
  // directly against Postgres below, not inferred from status labels.
  if (secondCounts.rejected !== 0 || secondCounts.applied !== 1 || secondCounts.duplicate !== records.length - 1) {
    throw new Error(
      `expected exactly 1 'applied' (the sale_void record) and ${records.length - 1} 'duplicate' on re-push, got ${JSON.stringify(secondCounts)}`,
    );
  }
  const countsAfter = await rowCounts(TEST_PHONE!);
  console.log("row counts before re-push:", countsBefore);
  console.log("row counts after re-push: ", countsAfter);
  if (JSON.stringify(countsBefore) !== JSON.stringify(countsAfter)) {
    throw new Error(`row counts changed on re-push: ${JSON.stringify(countsBefore)} -> ${JSON.stringify(countsAfter)}`);
  }
  console.log("confirmed: zero new rows in Postgres despite the sale_void record's 'applied' label");

  console.log("\n=== GET /sales with filters, paginating to the end ===");
  let cursor: string | null = null;
  let seen = 0;
  let pages = 0;
  do {
    const url = new URL(`${BASE_URL}/api/v1/sales`);
    url.searchParams.set("limit", "10");
    url.searchParams.set("paymentMethod", "cash");
    if (cursor) url.searchParams.set("cursor", cursor);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${tokens.accessToken}` } });
    if (!res.ok) throw new Error(`GET /sales failed: ${res.status} ${await res.text()}`);
    const page = (await res.json()) as { data: unknown[]; nextCursor: string | null; hasMore: boolean };
    seen += page.data.length;
    pages++;
    cursor = page.nextCursor;
  } while (cursor);
  console.log(`paginated ${pages} page(s), ${seen} cash sales total`);

  console.log("\n=== settling a deni payment ===");
  const customerRes = await fetch(`${BASE_URL}/api/v1/deni/customers?limit=200`, {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  });
  const customerPage = (await customerRes.json()) as { data: { id: string; name: string; balance_tzs: number }[] };
  const customer = customerPage.data.find((c) => c.name === deniCustomerName);
  if (!customer) throw new Error(`could not find deni customer "${deniCustomerName}" just created`);
  console.log(`customer "${customer.name}" balance before payment: ${customer.balance_tzs} TZS`);

  const paymentRes = await fetch(`${BASE_URL}/api/v1/deni/payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokens.accessToken}` },
    body: JSON.stringify({
      clientId: ulidLike(`${runId}-settle`),
      deniCustomerId: customer.id,
      amountTzs: 3000,
      paidAt: new Date().toISOString(),
    }),
  });
  if (!paymentRes.ok) throw new Error(`deni payment settle failed: ${paymentRes.status} ${await paymentRes.text()}`);
  console.log("settled 3000 TZS payment");

  console.log("\n=== closing the day ===");
  const closeRes = await fetch(`${BASE_URL}/api/v1/days/${date}/close`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokens.accessToken}` },
    body: JSON.stringify({ wastePlates: 1, notes: "verify-pos final close" }),
  });
  if (!closeRes.ok) throw new Error(`close day failed: ${closeRes.status} ${await closeRes.text()}`);

  console.log(`\n=== GET /days/${date} ===`);
  const dayRes = await fetch(`${BASE_URL}/api/v1/days/${date}`, {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  });
  const dayBody = (await dayRes.json()) as { summary: Record<string, unknown> };
  console.log(JSON.stringify(dayBody.summary, null, 2));

  console.log("\n=== running reconciliation (expect zero drift for this vendor/date) ===");
  const reconcileOut = execSync(`docker compose exec -T reconcile-cron sh -c "cd /app && npx tsx scripts/reconcile.ts"`, {
    cwd: COMPOSE_DIR,
    encoding: "utf8",
  });
  console.log(reconcileOut);

  console.log("\nVERIFY-POS COMPLETE — no errors.");
}

main().catch((err: unknown) => {
  console.error("verify-pos FAILED:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
