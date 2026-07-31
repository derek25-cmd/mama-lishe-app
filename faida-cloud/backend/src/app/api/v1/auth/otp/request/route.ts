import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { normalizePhone } from "@/lib/auth/phone";
import { generateAndStoreOtp } from "@/lib/auth/otp";
import { checkRateLimit, clientIpFromHeaders } from "@/lib/auth/rate-limit";
import { getSmsSender } from "@/lib/notifications/sms";

const Body = z.object({ phone: z.string().min(1) });

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", details: parsed.error.flatten() }, { status: 400 });
  }

  const ip = clientIpFromHeaders(req.headers);
  const ipLimit = await checkRateLimit(`rl:otp:ip:${ip}`, 20, 60 * 60);
  if (!ipLimit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const phone = normalizePhone(parsed.data.phone);
  // Always 202, even for an unrecognized/malformed number — the response
  // shape must never reveal whether a phone number could ever exist.
  if (!phone) {
    return NextResponse.json({ ok: true }, { status: 202 });
  }

  const phoneLimit = await checkRateLimit(`rl:otp:phone:${phone}`, 5, 15 * 60);
  if (!phoneLimit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const code = await generateAndStoreOtp(phone);
  await getSmsSender().send(phone, `Your Faida verification code is ${code}. It expires in 5 minutes.`);

  return NextResponse.json({ ok: true }, { status: 202 });
}
