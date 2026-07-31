import { describe, expect, it } from "vitest";
import { verifyOtp } from "@/lib/auth/otp";
import { redis } from "@/lib/redis";
import { createHash } from "node:crypto";

// Normal flow deletes the Redis key the instant the 5th wrong attempt is
// recorded, so "attempts already at the cap but the key still exists" only
// happens under a genuine race (two concurrent verify calls both reading
// before either writes). This test recreates that race's end state
// directly rather than trying to actually win a timing race, to prove the
// defensive check in verifyOtp still does the right thing when it happens.
describe("OTP verify — attempts-already-at-cap race", () => {
  it("invalidates the code and reports too_many_attempts without checking the code", async () => {
    const phone = "+255743000099";
    const key = `otp:${phone}`;
    const code = "654321";
    await redis.hset(key, { hash: createHash("sha256").update(code).digest("hex"), attempts: "5" });
    await redis.expire(key, 300);

    const result = await verifyOtp(phone, code); // the CORRECT code — must still be rejected
    expect(result).toBe("too_many_attempts");

    const exists = await redis.exists(key);
    expect(exists).toBe(0);
  });
});
