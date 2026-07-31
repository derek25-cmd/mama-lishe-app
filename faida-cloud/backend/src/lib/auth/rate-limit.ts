import { redis } from "@/lib/redis";

// Atomic fixed-window counter (INCR + EXPIRE-on-first-hit in one round trip
// via Lua, closing the race a plain INCR-then-EXPIRE pair would have).
const RATE_LIMIT_SCRIPT = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
end
return current
`;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

export async function checkRateLimit(key: string, max: number, windowSeconds: number): Promise<RateLimitResult> {
  const current = (await redis.eval(RATE_LIMIT_SCRIPT, 1, key, windowSeconds)) as number;
  return { allowed: current <= max, remaining: Math.max(0, max - current) };
}

// nginx is the only reverse proxy in front of this API and appends the real
// client IP with proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for,
// which chains onto whatever the client already sent. Everything except the
// last entry is attacker-controllable; the last entry is what our own nginx
// actually observed on the TCP connection — that's "the first hop" we trust.
export function clientIpFromHeaders(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (!xff) return "unknown";
  const parts = xff.split(",").map((p) => p.trim());
  return parts[parts.length - 1] || "unknown";
}
