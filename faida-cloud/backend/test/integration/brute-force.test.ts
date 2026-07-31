import { describe, expect, it } from "vitest";
import { POST as otpRequest } from "@/app/api/v1/auth/otp/request/route";
import { POST as otpVerify } from "@/app/api/v1/auth/otp/verify/route";
import { jsonRequest, otpRequestFor } from "./helpers";

describe("OTP brute-force protection", () => {
  it("invalidates the code entirely after 5 wrong attempts — even the correct 6th attempt fails", async () => {
    const phone = "0743000003";
    const logs: string[] = [];
    const original = console.log;
    console.log = (msg: string) => logs.push(msg);
    try {
      const res = await otpRequest(otpRequestFor(phone));
      expect(res.status).toBe(202);
    } finally {
      console.log = original;
    }
    const code = logs.find((l) => l.includes("sms:console"))?.match(/code is (\d{6})/)?.[1];
    expect(code).toBeTruthy();

    for (let i = 0; i < 5; i++) {
      const res = await otpVerify(jsonRequest("http://test/api/v1/auth/otp/verify", "POST", { phone, code: "000000" }));
      expect(res.status).toBe(401);
    }

    // the 6th attempt, with the REAL code, must still fail
    const finalRes = await otpVerify(jsonRequest("http://test/api/v1/auth/otp/verify", "POST", { phone, code }));
    expect(finalRes.status).toBe(401);
  });
});
