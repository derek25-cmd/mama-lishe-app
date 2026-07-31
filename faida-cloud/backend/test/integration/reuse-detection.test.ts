import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { POST as refreshRoute } from "@/app/api/v1/auth/refresh/route";
import { query } from "@/lib/db";
import { jsonRequest, loginViaOtp } from "./helpers";

describe("refresh token reuse detection — the stolen-token defense", () => {
  it("replaying an already-rotated refresh token 401s and revokes the WHOLE family, including the newer token", async () => {
    const original = await loginViaOtp("0743000004");

    const rotateRes = await refreshRoute(
      jsonRequest("http://test/api/v1/auth/refresh", "POST", { refreshToken: original.refreshToken }),
    );
    expect(rotateRes.status).toBe(200);
    const rotated = await rotateRes.json();

    // replay the OLD token — this is the attack
    const replayRes = await refreshRoute(
      jsonRequest("http://test/api/v1/auth/refresh", "POST", { refreshToken: original.refreshToken }),
    );
    expect(replayRes.status).toBe(401);
    expect((await replayRes.json()).reason).toBe("reused");

    // the token issued by the legitimate rotation is ALSO now dead —
    // the whole family was revoked, not just the replayed token
    const newerRes = await refreshRoute(
      jsonRequest("http://test/api/v1/auth/refresh", "POST", { refreshToken: rotated.refreshToken }),
    );
    expect(newerRes.status).toBe(401);
  });

  it("an unknown refresh token is rejected as invalid, not reused", async () => {
    const res = await refreshRoute(
      jsonRequest("http://test/api/v1/auth/refresh", "POST", { refreshToken: "totally-made-up-token" }),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).reason).toBe("invalid");
  });

  it("a genuinely expired (never rotated, never revoked) refresh token is rejected as expired", async () => {
    const tokens = await loginViaOtp("0743000017");
    const tokenHash = createHash("sha256").update(tokens.refreshToken).digest("hex");
    await query("update vendor.refresh_tokens set expires_at = now() - interval '1 day' where token_hash = $1", [
      tokenHash,
    ]);

    const res = await refreshRoute(
      jsonRequest("http://test/api/v1/auth/refresh", "POST", { refreshToken: tokens.refreshToken }),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).reason).toBe("expired");
  });
});
