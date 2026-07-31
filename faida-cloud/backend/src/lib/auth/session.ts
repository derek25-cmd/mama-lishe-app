import { randomBytes, randomUUID, createHash } from "node:crypto";
import { query, queryOne } from "@/lib/db";
import { signAccessToken } from "@/lib/auth/jwt";
import { logSecurityEvent } from "@/lib/auth/log";

const REFRESH_TTL_DAYS = Number(process.env.JWT_REFRESH_TTL_DAYS ?? 30);
const MAX_ACTIVE_FAMILIES = 3;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// 256-bit opaque token, base64url — never a JWT, never carries claims.
function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export interface SessionVendor {
  id: string;
  role: string;
  marketId: string | null;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

interface RefreshTokenRow {
  id: string;
  vendor_id: string;
  family_id: string;
  expires_at: Date;
  rotated_at: Date | null;
  revoked_at: Date | null;
  device_label: string | null;
  oauth_scope: string | null;
}

// Creating a 4th active family revokes the oldest (by when that family was
// first seen), keeping at most MAX_ACTIVE_FAMILIES-1 before the new one.
async function enforceDeviceCap(vendorId: string): Promise<void> {
  const families = await query<{ family_id: string }>(
    `select family_id
     from vendor.refresh_tokens
     where vendor_id = $1 and revoked_at is null
     group by family_id
     order by min(created_at) asc`,
    [vendorId],
  );
  if (families.length >= MAX_ACTIVE_FAMILIES) {
    const oldest = families[0]!;
    await query(
      `update vendor.refresh_tokens set revoked_at = now(), revoke_reason = 'device_cap'
       where family_id = $1 and revoked_at is null`,
      [oldest.family_id],
    );
  }
}

export async function createSession(
  vendor: SessionVendor,
  deviceLabel?: string,
  scope?: string,
): Promise<TokenPair> {
  await enforceDeviceCap(vendor.id);

  const familyId = randomUUID();
  const refreshToken = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);

  await query(
    `insert into vendor.refresh_tokens (vendor_id, family_id, token_hash, device_label, expires_at, oauth_scope)
     values ($1, $2, $3, $4, $5, $6)`,
    [vendor.id, familyId, hashToken(refreshToken), deviceLabel ?? null, expiresAt, scope ?? null],
  );

  const accessToken = await signAccessToken({ sub: vendor.id, role: vendor.role, marketId: vendor.marketId, scope });
  return { accessToken, refreshToken };
}

export type RefreshFailureReason = "invalid" | "expired" | "reused";

export type RefreshResult = { ok: true; tokens: TokenPair } | { ok: false; reason: RefreshFailureReason };

// Rotation with reuse detection: a refresh token that's already been rotated
// or revoked being presented again means it was stolen (an attacker replayed
// an old token, or the legitimate client raced a refresh) — the entire
// family is revoked, not just the one token, since every token in that
// family is now suspect.
export async function rotateRefreshToken(presentedToken: string): Promise<RefreshResult> {
  const tokenHash = hashToken(presentedToken);
  const row = await queryOne<RefreshTokenRow>(
    `select id, vendor_id, family_id, expires_at, rotated_at, revoked_at, device_label, oauth_scope
     from vendor.refresh_tokens where token_hash = $1`,
    [tokenHash],
  );

  if (!row) return { ok: false, reason: "invalid" };

  if (row.revoked_at || row.rotated_at) {
    await query(
      `update vendor.refresh_tokens set revoked_at = now(), revoke_reason = 'reuse_detected'
       where family_id = $1 and revoked_at is null`,
      [row.family_id],
    );
    logSecurityEvent("refresh_token_reuse_detected", {
      vendorId: row.vendor_id,
      familyId: row.family_id,
      deviceLabel: row.device_label,
    });
    return { ok: false, reason: "reused" };
  }

  if (row.expires_at.getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }

  await query(`update vendor.refresh_tokens set rotated_at = now() where id = $1`, [row.id]);

  const vendorRow = await queryOne<{ id: string; role: string; market_id: string | null }>(
    `select id, role, market_id from vendor.vendors where id = $1`,
    [row.vendor_id],
  );
  if (!vendorRow) return { ok: false, reason: "invalid" };

  const refreshToken = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
  await query(
    `insert into vendor.refresh_tokens (vendor_id, family_id, token_hash, device_label, expires_at, oauth_scope)
     values ($1, $2, $3, $4, $5, $6)`,
    [row.vendor_id, row.family_id, hashToken(refreshToken), row.device_label, expiresAt, row.oauth_scope],
  );

  const accessToken = await signAccessToken({
    sub: vendorRow.id,
    role: vendorRow.role,
    marketId: vendorRow.market_id,
    scope: row.oauth_scope ?? undefined,
  });

  return { ok: true, tokens: { accessToken, refreshToken } };
}

// Revokes only the family the presented token belongs to (single-device
// sign-out).
export async function logout(presentedToken: string): Promise<void> {
  const tokenHash = hashToken(presentedToken);
  const row = await queryOne<{ family_id: string }>(
    `select family_id from vendor.refresh_tokens where token_hash = $1`,
    [tokenHash],
  );
  if (!row) return;
  await query(
    `update vendor.refresh_tokens set revoked_at = now(), revoke_reason = 'logout'
     where family_id = $1 and revoked_at is null`,
    [row.family_id],
  );
}

// Revokes every family for the vendor — "remote sign-out" from all devices.
export async function logoutAll(vendorId: string): Promise<void> {
  await query(
    `update vendor.refresh_tokens set revoked_at = now(), revoke_reason = 'logout_all'
     where vendor_id = $1 and revoked_at is null`,
    [vendorId],
  );
}
