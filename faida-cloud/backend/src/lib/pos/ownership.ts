import type { PoolClient } from "pg";
import { ForeignRowNotOwnedError } from "@/lib/pos/types";

// Table names + their owning-vendor column are a fixed internal whitelist
// (never user input), so string interpolation into the query here is
// safe — the id itself is always parameterized. vendor.branches is the odd
// one out: its column is owner_id, not vendor_id.
const OWNERSHIP_TABLES = {
  "vendor.branches": "owner_id",
  "costing.vendor_recipes": "vendor_id",
  "costing.cook_plans": "vendor_id",
} as const;

export type OwnershipTable = keyof typeof OWNERSHIP_TABLES;

// Verifies a client-supplied foreign id actually belongs to the
// authenticated vendor before it's used anywhere — see
// ForeignRowNotOwnedError for why this can't be left to the FK constraint
// alone. No-op when id is null/undefined (optional references).
export async function assertOwnedByVendor(
  client: PoolClient,
  table: OwnershipTable,
  id: string | null | undefined,
  vendorId: string,
): Promise<void> {
  if (!id) return;
  const column = OWNERSHIP_TABLES[table];
  const result = await client.query(`select 1 from ${table} where id = $1 and ${column} = $2`, [id, vendorId]);
  if (result.rowCount === 0) throw new ForeignRowNotOwnedError(table, id);
}
