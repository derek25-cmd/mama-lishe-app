import { randomBytes, createHash } from "node:crypto";
import { queryOne, query } from "@/lib/db";

const CODE_TTL_SECONDS = 10 * 60;

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function generateOpaqueCode(): string {
  return randomBytes(32).toString("base64url");
}

export interface OAuthClient {
  client_id: string;
  client_secret_hash: string | null;
  name: string;
  redirect_uris: string[];
  allowed_scopes: string[];
  is_active: boolean;
}

export async function getActiveClient(clientId: string): Promise<OAuthClient | null> {
  const client = await queryOne<OAuthClient>(
    `select client_id, client_secret_hash, name, redirect_uris, allowed_scopes, is_active
     from vendor.oauth_clients where client_id = $1`,
    [clientId],
  );
  return client && client.is_active ? client : null;
}

export function validateRedirectUri(client: OAuthClient, redirectUri: string): boolean {
  return client.redirect_uris.includes(redirectUri); // exact match only, no prefix/wildcard
}

export function validateScopes(client: OAuthClient, requestedScopes: string[]): boolean {
  return requestedScopes.every((s) => client.allowed_scopes.includes(s));
}

export interface CreateAuthorizationCodeInput {
  clientId: string;
  vendorId: string;
  scopes: string[];
  codeChallenge: string;
  redirectUri: string;
}

export async function createAuthorizationCode(input: CreateAuthorizationCodeInput): Promise<string> {
  const code = generateOpaqueCode();
  const expiresAt = new Date(Date.now() + CODE_TTL_SECONDS * 1000);
  await query(
    `insert into vendor.oauth_codes
       (code_hash, client_id, vendor_id, scopes, code_challenge, code_challenge_method, redirect_uri, expires_at)
     values ($1, $2, $3, $4, $5, 'S256', $6, $7)`,
    [hashCode(code), input.clientId, input.vendorId, input.scopes, input.codeChallenge, input.redirectUri, expiresAt],
  );
  return code;
}

export interface OAuthCodeRecord {
  client_id: string;
  vendor_id: string;
  scopes: string[];
  code_challenge: string;
  redirect_uri: string;
  expires_at: Date;
  consumed_at: Date | null;
}

// Single-use: fetches the code and marks it consumed in one call. Callers
// must still check expires_at/consumed_at themselves — this doesn't reject
// an expired code, it just guarantees it can never be consumed twice even
// under a race.
export async function consumeAuthorizationCode(code: string): Promise<OAuthCodeRecord | null> {
  const row = await queryOne<OAuthCodeRecord>(
    `update vendor.oauth_codes set consumed_at = now()
     where code_hash = $1 and consumed_at is null
     returning client_id, vendor_id, scopes, code_challenge, redirect_uri, expires_at, consumed_at`,
    [hashCode(code)],
  );
  return row;
}
