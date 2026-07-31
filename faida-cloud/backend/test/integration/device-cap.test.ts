import { describe, expect, it } from "vitest";
import { POST as refreshRoute } from "@/app/api/v1/auth/refresh/route";
import { jsonRequest, loginViaOtp } from "./helpers";

describe("device cap — max 3 active sessions per vendor", () => {
  it("a 4th login revokes the oldest family, leaving the 3 most recent alive", async () => {
    const phone = "0743000005"; // under the 5/15min OTP request limit for 4 logins
    const login1 = await loginViaOtp(phone);
    const login2 = await loginViaOtp(phone);
    const login3 = await loginViaOtp(phone);
    const login4 = await loginViaOtp(phone);

    const tryRefresh = (refreshToken: string) =>
      refreshRoute(jsonRequest("http://test/api/v1/auth/refresh", "POST", { refreshToken }));

    expect((await tryRefresh(login1.refreshToken)).status).toBe(401); // oldest — revoked
    expect((await tryRefresh(login2.refreshToken)).status).toBe(200);
    expect((await tryRefresh(login3.refreshToken)).status).toBe(200);
    expect((await tryRefresh(login4.refreshToken)).status).toBe(200);
  });
});
