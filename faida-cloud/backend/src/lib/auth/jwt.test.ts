import { describe, expect, it, beforeAll } from "vitest";
import { SignJWT } from "jose";
import { randomUUID } from "node:crypto";
import { signAccessToken, verifyAccessToken, TokenVerificationError } from "./jwt";

beforeAll(() => {
  process.env.JWT_SECRET = "test-secret-do-not-use-in-real-life";
});

describe("signAccessToken / verifyAccessToken", () => {
  it("round-trips the claims it was given", async () => {
    const token = await signAccessToken({ sub: "vendor-1", role: "vendor", marketId: "market-1" });
    const claims = await verifyAccessToken(token);
    expect(claims.sub).toBe("vendor-1");
    expect(claims.role).toBe("vendor");
    expect(claims.marketId).toBe("market-1");
    expect(claims.jti).toBeTruthy();
    expect(claims.scope).toBeUndefined();
  });

  it("includes a scope claim only when one was provided", async () => {
    const token = await signAccessToken({ sub: "vendor-1", role: "vendor", marketId: null, scope: "vendor.read" });
    const claims = await verifyAccessToken(token);
    expect(claims.scope).toBe("vendor.read");
  });

  it("null marketId round-trips as null, not undefined", async () => {
    const token = await signAccessToken({ sub: "vendor-1", role: "vendor", marketId: null });
    const claims = await verifyAccessToken(token);
    expect(claims.marketId).toBeNull();
  });

  it("rejects an expired token", async () => {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    const expired = await new SignJWT({ role: "vendor", marketId: null })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("vendor-1")
      .setJti(randomUUID())
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600) // expired 1h ago
      .sign(secret);

    await expect(verifyAccessToken(expired)).rejects.toThrow(TokenVerificationError);
  });

  it("rejects a token signed with a different secret", async () => {
    const wrongSecret = new TextEncoder().encode("a-completely-different-secret");
    const forged = await new SignJWT({ role: "ops_admin", marketId: null })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("vendor-1")
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(wrongSecret);

    await expect(verifyAccessToken(forged)).rejects.toThrow(TokenVerificationError);
  });

  it("rejects a token with an alg other than HS256", async () => {
    // "none" algorithm forgery — a classic JWT library footgun if the
    // verifier ever trusts the token's own declared alg.
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ sub: "vendor-1", role: "ops_admin", exp: 9999999999 })).toString(
      "base64url",
    );
    const noneToken = `${header}.${payload}.`;

    await expect(verifyAccessToken(noneToken)).rejects.toThrow(TokenVerificationError);
  });

  it("rejects a token whose role claim was altered after signing", async () => {
    const token = await signAccessToken({ sub: "vendor-1", role: "vendor", marketId: null });
    const [header, payload, signature] = token.split(".");
    const decoded = JSON.parse(Buffer.from(payload!, "base64url").toString());
    decoded.role = "ops_admin"; // privilege escalation attempt
    const tamperedPayload = Buffer.from(JSON.stringify(decoded)).toString("base64url");
    const tampered = `${header}.${tamperedPayload}.${signature}`;

    await expect(verifyAccessToken(tampered)).rejects.toThrow(TokenVerificationError);
  });

  it("rejects a malformed token outright", async () => {
    await expect(verifyAccessToken("not-a-jwt")).rejects.toThrow(TokenVerificationError);
  });

  it("rejects a validly-signed token missing required claims (no sub)", async () => {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    const noSubject = await new SignJWT({ role: "vendor", marketId: null })
      .setProtectedHeader({ alg: "HS256" })
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(secret);

    await expect(verifyAccessToken(noSubject)).rejects.toThrow(TokenVerificationError);
  });

  it("rejects a validly-signed token missing required claims (no role)", async () => {
    const secret = new TextEncoder().encode(process.env.JWT_SECRET);
    const noRole = await new SignJWT({ marketId: null })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("vendor-1")
      .setJti(randomUUID())
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(secret);

    await expect(verifyAccessToken(noRole)).rejects.toThrow(TokenVerificationError);
  });

  it("propagates a non-JOSE error (e.g. missing JWT_SECRET) without wrapping it", async () => {
    const saved = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    try {
      await expect(verifyAccessToken("anything")).rejects.not.toBeInstanceOf(TokenVerificationError);
    } finally {
      process.env.JWT_SECRET = saved;
    }
  });
});
