import { describe, expect, it } from "vitest";
import { POST as logoutRoute } from "@/app/api/v1/auth/logout/route";
import { POST as logoutAllRoute } from "@/app/api/v1/auth/logout-all/route";
import { POST as refreshRoute } from "@/app/api/v1/auth/refresh/route";
import { authedRequest, jsonRequest, loginViaOtp } from "./helpers";

describe("logout", () => {
  it("revokes only the presented family — that refresh token stops working", async () => {
    const tokens = await loginViaOtp("0743000015");
    const res = await logoutRoute(jsonRequest("http://test/api/v1/auth/logout", "POST", { refreshToken: tokens.refreshToken }));
    expect(res.status).toBe(200);

    const refreshAttempt = await refreshRoute(
      jsonRequest("http://test/api/v1/auth/refresh", "POST", { refreshToken: tokens.refreshToken }),
    );
    expect(refreshAttempt.status).toBe(401);
  });

  it("is a no-op (not an error) for an unknown token", async () => {
    const res = await logoutRoute(jsonRequest("http://test/api/v1/auth/logout", "POST", { refreshToken: "unknown" }));
    expect(res.status).toBe(200);
  });
});

describe("logout-all", () => {
  it("revokes every family for the vendor — remote sign-out from all devices", async () => {
    const phone = "0743000016";
    const login1 = await loginViaOtp(phone);
    const login2 = await loginViaOtp(phone);

    const res = await logoutAllRoute(authedRequest("http://test/api/v1/auth/logout-all", login1.accessToken, "POST"));
    expect(res.status).toBe(200);

    const r1 = await refreshRoute(jsonRequest("http://test/api/v1/auth/refresh", "POST", { refreshToken: login1.refreshToken }));
    const r2 = await refreshRoute(jsonRequest("http://test/api/v1/auth/refresh", "POST", { refreshToken: login2.refreshToken }));
    expect(r1.status).toBe(401);
    expect(r2.status).toBe(401);
  });

  it("requires authentication", async () => {
    const { NextRequest } = await import("next/server");
    const res = await logoutAllRoute(new NextRequest("http://test/api/v1/auth/logout-all", { method: "POST" }));
    expect(res.status).toBe(401);
  });
});
