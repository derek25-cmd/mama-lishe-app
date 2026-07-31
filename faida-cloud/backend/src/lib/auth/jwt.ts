import { SignJWT, jwtVerify, errors } from "jose";
import { randomUUID } from "node:crypto";

const ACCESS_TTL_SECONDS = Number(process.env.JWT_ACCESS_TTL ?? 3600);

function secretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not set");
  return new TextEncoder().encode(secret);
}

export interface AccessTokenClaims {
  sub: string; // vendor_id
  role: string;
  marketId: string | null;
  scope?: string; // space-separated OAuth scopes — only present on OAuth-issued tokens
  jti: string;
  iat: number;
  exp: number;
}

export interface IssueAccessTokenInput {
  sub: string;
  role: string;
  marketId: string | null;
  scope?: string;
}

export async function signAccessToken(input: IssueAccessTokenInput): Promise<string> {
  return new SignJWT({ role: input.role, marketId: input.marketId, ...(input.scope ? { scope: input.scope } : {}) })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(input.sub)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
    .sign(secretKey());
}

export class TokenVerificationError extends Error {}

// Algorithm is pinned to HS256 explicitly — jwtVerify would otherwise trust
// whatever `alg` the token claims, which is exactly the classic alg-confusion
// hole. Tampered signatures, expired tokens, and altered claims all throw
// jose's own error types here, normalized to one error class for callers.
export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || typeof payload.role !== "string") {
      throw new TokenVerificationError("malformed token payload");
    }
    return {
      sub: payload.sub,
      role: payload.role,
      marketId: (payload.marketId as string | null) ?? null,
      scope: typeof payload.scope === "string" ? payload.scope : undefined,
      jti: payload.jti as string,
      iat: payload.iat as number,
      exp: payload.exp as number,
    };
  } catch (err) {
    if (err instanceof errors.JOSEError) throw new TokenVerificationError(err.message);
    throw err;
  }
}
