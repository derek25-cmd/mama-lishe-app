import { createHash, timingSafeEqual } from "node:crypto";

// RFC 7636 §4.6, S256 only — "plain" is never accepted anywhere this is
// called from (see oauth/authorize, which rejects any method other than
// "S256" before a code is ever issued).
export function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
  const computed = createHash("sha256").update(codeVerifier).digest("base64url");
  const a = Buffer.from(computed);
  const b = Buffer.from(codeChallenge);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
