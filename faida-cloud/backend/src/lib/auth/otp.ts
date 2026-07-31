import { randomInt, createHash, timingSafeEqual } from "node:crypto";
import { redis } from "@/lib/redis";

const OTP_TTL_SECONDS = 5 * 60;
const MAX_VERIFY_ATTEMPTS = 5;

function otpKey(phone: string): string {
  return `otp:${phone}`;
}

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// crypto.randomInt(0, 1_000_000) then zero-padded to 6 digits — uniform,
// CSPRNG-backed, never Math.random().
export async function generateAndStoreOtp(phone: string): Promise<string> {
  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const key = otpKey(phone);
  await redis.hset(key, { hash: hashCode(code), attempts: "0" });
  await redis.expire(key, OTP_TTL_SECONDS);
  return code;
}

export type VerifyOtpResult = "ok" | "invalid" | "expired" | "too_many_attempts";

// Single-use: the Redis key is deleted on success. Brute-force guard: the
// 5th wrong attempt deletes the key outright, so even the "right" 6th
// attempt sees no code at all (returns "expired", not "invalid").
export async function verifyOtp(phone: string, code: string): Promise<VerifyOtpResult> {
  const key = otpKey(phone);
  const stored = await redis.hgetall(key);
  if (!stored.hash) return "expired";

  const attempts = Number(stored.attempts ?? "0");
  if (attempts >= MAX_VERIFY_ATTEMPTS) {
    await redis.del(key);
    return "too_many_attempts";
  }

  if (!timingSafeEqualHex(stored.hash, hashCode(code))) {
    const newAttempts = await redis.hincrby(key, "attempts", 1);
    if (newAttempts >= MAX_VERIFY_ATTEMPTS) {
      await redis.del(key);
    }
    return "invalid";
  }

  await redis.del(key);
  return "ok";
}
