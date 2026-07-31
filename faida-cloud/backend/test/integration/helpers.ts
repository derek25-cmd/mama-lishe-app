import { NextRequest } from "next/server";

export function jsonRequest(
  url: string,
  method: string,
  body?: unknown,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(url, {
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: { "content-type": "application/json", ...headers },
  });
}

// Every test in this suite hits the same otp/request route in the same
// process, so without a distinct X-Forwarded-For per logical "test client"
// they'd all pile into the single "unknown" IP rate-limit bucket and
// exhaust it — a test-isolation bug in the harness, not the rate limiter
// (which is doing exactly its job). Deriving a stable fake IP from the
// phone number keeps each test's requests isolated, the same way distinct
// real devices would be.
export function fakeIpFor(phone: string): string {
  let hash = 0;
  for (const ch of phone) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `10.${(hash >> 16) & 255}.${(hash >> 8) & 255}.${hash & 255}`;
}

export function otpRequestFor(phone: string): NextRequest {
  return jsonRequest("http://test/api/v1/auth/otp/request", "POST", { phone }, { "x-forwarded-for": fakeIpFor(phone) });
}

export function authedRequest(url: string, accessToken: string, method = "GET"): NextRequest {
  return new NextRequest(url, { method, headers: { authorization: `Bearer ${accessToken}` } });
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

// Drives the real OTP request+verify routes (not a lib-level shortcut) so
// every integration test starts from a genuine, freshly-issued session —
// capturing the code the same way a human tester would: off the
// console-driver's log line, never by reaching into Redis directly.
export async function loginViaOtp(phone: string): Promise<TokenPair> {
  const { POST: otpRequest } = await import("@/app/api/v1/auth/otp/request/route");
  const { POST: otpVerify } = await import("@/app/api/v1/auth/otp/verify/route");

  const logs: string[] = [];
  const spy = (msg: string) => logs.push(msg);
  const original = console.log;
  console.log = spy;
  try {
    const res = await otpRequest(otpRequestFor(phone));
    if (res.status !== 202) throw new Error(`otp/request failed: ${res.status}`);
  } finally {
    console.log = original;
  }

  const line = logs.find((l) => l.includes("sms:console"));
  const code = line?.match(/code is (\d{6})/)?.[1];
  if (!code) throw new Error(`could not extract OTP code from logs: ${JSON.stringify(logs)}`);

  const verifyRes = await otpVerify(jsonRequest("http://test/api/v1/auth/otp/verify", "POST", { phone, code }));
  if (verifyRes.status !== 200) throw new Error(`otp/verify failed: ${verifyRes.status}`);
  return verifyRes.json();
}
