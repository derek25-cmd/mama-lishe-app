import pino from "pino";

// Structured logger for auth security events. Never pass a raw phone number,
// OTP code, or token/token-hash into `details` — callers are responsible for
// masking (see phone.ts's maskPhone) before this is called.
const logger = pino({ name: "faida-auth" });

export function logSecurityEvent(event: string, details: Record<string, unknown>): void {
  logger.warn({ event, ...details }, `security event: ${event}`);
}
