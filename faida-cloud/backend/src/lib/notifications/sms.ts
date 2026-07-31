import { maskPhone } from "@/lib/auth/phone";

export interface SmsSender {
  send(phone: string, message: string): Promise<void>;
}

// Dev-only: prints instead of sending. This is the ONLY place an OTP code
// is ever written anywhere — it exists specifically so the code is visible
// without burning real SMS credit, mirroring what a real phone would
// receive. General app/security logs never include a code; only the phone
// number is masked here, never the message content (that would defeat the
// driver's purpose).
export class ConsoleSmsSender implements SmsSender {
  async send(phone: string, message: string): Promise<void> {
    console.log(`[sms:console] to=${maskPhone(phone)} message="${message}"`);
  }
}

/** SMS via Beem Africa (https://docs.beem.africa) */
export class BeemSmsSender implements SmsSender {
  async send(phone: string, message: string): Promise<void> {
    const auth = Buffer.from(`${process.env.BEEM_API_KEY}:${process.env.BEEM_SECRET_KEY}`).toString("base64");
    const res = await fetch("https://apisms.beem.africa/v1/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
      body: JSON.stringify({
        source_addr: process.env.BEEM_SENDER_ID ?? "FAIDA",
        encoding: 0,
        message,
        recipients: [{ recipient_id: 1, dest_addr: phone }],
      }),
    });
    if (!res.ok) throw new Error(`Beem SMS failed: ${res.status} ${await res.text()}`);
  }
}

export function getSmsSender(): SmsSender {
  if (process.env.NODE_ENV !== "production" || process.env.SMS_DRIVER === "console") {
    return new ConsoleSmsSender();
  }
  return new BeemSmsSender();
}
