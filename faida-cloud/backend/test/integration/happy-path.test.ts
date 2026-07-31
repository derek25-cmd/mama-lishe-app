import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET as meRoute } from "@/app/api/v1/me/route";
import { POST as refreshRoute } from "@/app/api/v1/auth/refresh/route";
import { authedRequest, jsonRequest, loginViaOtp } from "./helpers";

describe("full happy path: request -> verify -> /me -> refresh -> /me again", () => {
  it("issues a working session and rotates it cleanly", async () => {
    const tokens = await loginViaOtp("0743000001");
    expect(tokens.accessToken).toBeTruthy();
    expect(tokens.refreshToken).toBeTruthy();

    const meRes = await meRoute(authedRequest("http://test/api/v1/me", tokens.accessToken));
    expect(meRes.status).toBe(200);
    const profile = await meRes.json();
    expect(profile.phone).toBe("+255743000001");
    expect(profile.role).toBe("vendor");
    expect(profile.status).toBe("pending_onboarding");

    const refreshRes = await refreshRoute(
      jsonRequest("http://test/api/v1/auth/refresh", "POST", { refreshToken: tokens.refreshToken }),
    );
    expect(refreshRes.status).toBe(200);
    const rotated = await refreshRes.json();
    expect(rotated.accessToken).not.toBe(tokens.accessToken);
    expect(rotated.refreshToken).not.toBe(tokens.refreshToken);

    const meRes2 = await meRoute(authedRequest("http://test/api/v1/me", rotated.accessToken));
    expect(meRes2.status).toBe(200);
    expect((await meRes2.json()).phone).toBe("+255743000001");
  });

  it("a call to /me with no token at all is rejected", async () => {
    const res = await meRoute(new NextRequest("http://test/api/v1/me"));
    expect(res.status).toBe(401);
  });
});
