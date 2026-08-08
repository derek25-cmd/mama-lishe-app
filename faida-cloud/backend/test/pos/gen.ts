import { ulid } from "ulid";
import type { SyncRecord } from "@/lib/pos";

// Deterministic PRNG (mulberry32) — the property test needs reproducible
// failures to debug, not true randomness. Seeding with the run index makes
// every one of the 500+ scenarios distinct but replayable.
export function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

const DENI_CUSTOMER_NAMES = ["Mama Juma", "Baba Ali", "Dada Fatuma"];

export interface TradingDay {
  date: string; // YYYY-MM-DD
  records: SyncRecord[]; // in natural creation order — sales/expenses interleaved through the day, deni_payments and day_close last
  /** Expected totals, derived from the same generation the records came
   *  from — the property test's oracle. Computed independently of
   *  whatever applySyncBatch does with them. */
  expected: {
    saleCount: number;
    /** Total revenue as pos.daily_summaries actually defines it: every
     *  non-voided sale, cash AND deni combined — a deni sale is still
     *  revenue the moment it's recorded, the money owed just hasn't been
     *  collected in cash yet. Not to be confused with cash-only takings. */
    totalRevenueTzs: number;
    deniSaleTotalByCustomer: Map<string, number>;
    deniPaymentTotalByCustomer: Map<string, number>;
    expenseTotalTzs: number;
    wastePlates: number;
  };
}

// A realistic trading day: 40-120 sales (8 of them deni, spread across 3
// recurring customers so balances actually accumulate the way a real
// mama lishe's regulars would), 5 expenses, 3 deni payments each capped
// well under that customer's running balance so the scenario is always
// valid on its own, one day close.
export function generateTradingDay(rng: () => number, date: string): TradingDay {
  const records: SyncRecord[] = [];
  const saleCount = randInt(rng, 40, 120);
  const deniSaleSlots = new Set<number>();
  while (deniSaleSlots.size < Math.min(8, saleCount)) {
    deniSaleSlots.add(randInt(rng, 0, saleCount - 1));
  }

  let totalRevenueTzs = 0;
  const deniSaleTotalByCustomer = new Map<string, number>();

  for (let i = 0; i < saleCount; i++) {
    const isDeni = deniSaleSlots.has(i);
    const quantity = randInt(rng, 1, 3);
    const unitPriceTzs = 500 * randInt(rng, 1, 10);
    const totalTzs = quantity * unitPriceTzs;
    const hour = randInt(rng, 6, 20);
    const minute = randInt(rng, 0, 59);
    const soldAt = `${date}T${pad2(hour)}:${pad2(minute)}:00Z`;
    const customerName = DENI_CUSTOMER_NAMES[i % DENI_CUSTOMER_NAMES.length]!;

    records.push({
      type: "sale",
      clientId: ulid(),
      clientCreatedAt: soldAt,
      payload: isDeni
        ? { soldAt, quantity, unitPriceTzs, totalTzs, paymentMethod: "deni", deniCustomerName: customerName }
        : { soldAt, quantity, unitPriceTzs, totalTzs, paymentMethod: "cash" },
    });

    if (isDeni) {
      deniSaleTotalByCustomer.set(customerName, (deniSaleTotalByCustomer.get(customerName) ?? 0) + totalTzs);
    }
    totalRevenueTzs += totalTzs;
  }

  let expenseTotalTzs = 0;
  for (let i = 0; i < 5; i++) {
    const amountTzs = 1000 * randInt(rng, 1, 20);
    expenseTotalTzs += amountTzs;
    records.push({
      type: "expense",
      clientId: ulid(),
      clientCreatedAt: `${date}T${pad2(randInt(rng, 6, 12))}:00:00Z`,
      payload: { spentAt: `${date}T${pad2(randInt(rng, 6, 12))}:00:00Z`, category: "malighafi", amountTzs },
    });
  }

  // 3 payments, each against a customer who actually has a positive
  // balance, capped at half of what's currently owed so multiple payments
  // against the same customer in this same batch can never overdraw them.
  const deniPaymentTotalByCustomer = new Map<string, number>();
  const customersWithBalance = [...deniSaleTotalByCustomer.keys()];
  for (let i = 0; i < 3 && customersWithBalance.length > 0; i++) {
    const customerName = customersWithBalance[i % customersWithBalance.length]!;
    const owed = (deniSaleTotalByCustomer.get(customerName) ?? 0) - (deniPaymentTotalByCustomer.get(customerName) ?? 0);
    if (owed <= 0) continue;
    const amountTzs = Math.max(1, Math.floor(owed / 2));
    deniPaymentTotalByCustomer.set(customerName, (deniPaymentTotalByCustomer.get(customerName) ?? 0) + amountTzs);
    records.push({
      type: "deni_payment",
      clientId: ulid(),
      clientCreatedAt: `${date}T18:00:00Z`,
      payload: { deniCustomerName: customerName, amountTzs, paidAt: `${date}T18:00:00Z` },
    });
  }

  const wastePlates = randInt(rng, 0, 5);
  records.push({
    type: "day_close",
    clientId: ulid(),
    clientCreatedAt: `${date}T21:00:00Z`,
    payload: { date, wastePlates, notes: "generated trading day" },
  });

  return {
    date,
    records,
    expected: { saleCount, totalRevenueTzs, deniSaleTotalByCustomer, deniPaymentTotalByCustomer, expenseTotalTzs, wastePlates },
  };
}

// One mutated "how a flaky offline sync might actually deliver this data"
// scenario: shuffle order, duplicate a random subset, split into random
// batch sizes, and mark a random subset of batches for a second (retried)
// send. The property test applies every batch this returns, in order,
// asserting the end state never depends on any of this.
export function mutateIntoScenario(rng: () => number, records: SyncRecord[]): SyncRecord[][] {
  const shuffled = [...records];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }

  const duplicateCount = randInt(rng, 0, Math.floor(records.length * 0.2));
  const withDuplicates = [...shuffled];
  for (let i = 0; i < duplicateCount; i++) {
    const pick = shuffled[randInt(rng, 0, shuffled.length - 1)]!;
    withDuplicates.push(pick);
  }
  // Re-shuffle once more so duplicates land at random positions, not all
  // tacked onto the end (which would trivially always be "last write").
  for (let i = withDuplicates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [withDuplicates[i], withDuplicates[j]] = [withDuplicates[j]!, withDuplicates[i]!];
  }

  const batches: SyncRecord[][] = [];
  let cursor = 0;
  while (cursor < withDuplicates.length) {
    const size = randInt(rng, 1, 25);
    batches.push(withDuplicates.slice(cursor, cursor + size));
    cursor += size;
  }

  // Randomly retry a subset of batches (re-send the exact same batch a
  // second time immediately after its first send) — simulates a client
  // that times out waiting for a response and resends without knowing the
  // first attempt actually landed.
  const finalBatches: SyncRecord[][] = [];
  for (const batch of batches) {
    finalBatches.push(batch);
    if (rng() < 0.2) finalBatches.push(batch);
  }

  return finalBatches;
}
