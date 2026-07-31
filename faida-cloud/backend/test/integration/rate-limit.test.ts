import { describe, expect, it } from "vitest";
import { POST as otpRequest } from "@/app/api/v1/auth/otp/request/route";
import { jsonRequest, otpRequestFor } from "./helpers";

describe("OTP request rate limiting", () => {
  it("allows 5 requests then 429s the 6th, for the same phone within the window", async () => {
    const phone = "0743000002";
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await otpRequest(otpRequestFor(phone));
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 5)).toEqual([202, 202, 202, 202, 202]);
    expect(statuses[5]).toBe(429);
  });

  it("blocks a 21st request from the same IP within an hour, even across different phones", async () => {
    const ip = "203.0.113.55";
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) {
      const res = await otpRequest(
        jsonRequest("http://test/api/v1/auth/otp/request", "POST", { phone: `074300${String(9000 + i)}` }, { "x-forwarded-for": ip }),
      );
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 20).every((s) => s === 202)).toBe(true);
    expect(statuses[20]).toBe(429);
  });

  it("always returns 202 for an unrecognizable phone number — no enumeration", async () => {
    const res = await otpRequest(
      jsonRequest("http://test/api/v1/auth/otp/request", "POST", { phone: "not-a-phone" }, { "x-forwarded-for": "198.51.100.1" }),
    );
    expect(res.status).toBe(202);
  });
});
