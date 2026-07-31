import { query, queryOne } from "@/lib/db";

export interface VendorRecord {
  id: string;
  phone: string;
  role: string;
  market_id: string | null;
  status: string;
}

export async function findOrCreateVendorByPhone(phone: string): Promise<VendorRecord> {
  const existing = await queryOne<VendorRecord>(
    `select id, phone, role, market_id, status from vendor.vendors where phone = $1`,
    [phone],
  );
  if (existing) return existing;

  // INSERT ... RETURNING always yields exactly one row on success (or the
  // query itself throws) — no need to defend against a row that can't fail
  // to come back.
  const [inserted] = await query<VendorRecord>(
    `insert into vendor.vendors (id, phone, display_name, business_type, role, status)
     values (gen_random_uuid(), $1, $1, 'mama_lishe', 'vendor', 'pending_onboarding')
     returning id, phone, role, market_id, status`,
    [phone],
  );
  return inserted!;
}

export async function getVendorById(vendorId: string): Promise<VendorRecord | null> {
  return queryOne<VendorRecord>(`select id, phone, role, market_id, status from vendor.vendors where id = $1`, [
    vendorId,
  ]);
}
