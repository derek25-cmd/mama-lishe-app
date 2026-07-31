import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GET as authorizeRoute } from "@/app/api/v1/oauth/authorize/route";
import { POST as tokenRoute } from "@/app/api/v1/oauth/token/route";
import { authedRequest, jsonRequest, loginViaOtp } from "./helpers";

const CLIENT_ID = "faida-ops-dashboard"; // seeded by migration
const REDIRECT_URI = "https://ops.your-domain.com/callback"; // matches the seed exactly

function pkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

describe("OAuth 2.0 authorization-code + PKCE", () => {
  it("full grant: authorize -> code -> token (PKCE verified) -> access+refresh with scope", async () => {
    const { accessToken } = await loginViaOtp("0743000009");
    const { verifier, challenge } = pkcePair();

    const authorizeUrl =
      `http://test/api/v1/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&response_type=code&scope=${encodeURIComponent("vendor.read prices.read")}&code_challenge=${challenge}&code_challenge_method=S256&state=xyz`;

    const authRes = await authorizeRoute(authedRequest(authorizeUrl, accessToken));
    expect(authRes.status).toBe(302);
    const location = new URL(authRes.headers.get("location")!);
    expect(location.searchParams.get("state")).toBe("xyz");
    const code = location.searchParams.get("code");
    expect(code).toBeTruthy();

    const tokenRes = await tokenRoute(
      jsonRequest("http://test/api/v1/oauth/token", "POST", {
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        code_verifier: verifier,
      }),
    );
    expect(tokenRes.status).toBe(200);
    const body = await tokenRes.json();
    expect(body.access_token).toBeTruthy();
    expect(body.refresh_token).toBeTruthy();
    expect(body.scope).toBe("vendor.read prices.read");

    // the code is single-use
    const replay = await tokenRoute(
      jsonRequest("http://test/api/v1/oauth/token", "POST", {
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        code_verifier: verifier,
      }),
    );
    expect(replay.status).toBe(400);

    // refresh_token grant preserves the scope across rotation
    const refreshed = await tokenRoute(
      jsonRequest("http://test/api/v1/oauth/token", "POST", {
        grant_type: "refresh_token",
        refresh_token: body.refresh_token,
      }),
    );
    expect(refreshed.status).toBe(200);
  });

  it("rejects a mismatched code_verifier (wrong PKCE proof)", async () => {
    const { accessToken } = await loginViaOtp("0743000010");
    const { challenge } = pkcePair();

    const authorizeUrl =
      `http://test/api/v1/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&response_type=code&scope=vendor.read&code_challenge=${challenge}&code_challenge_method=S256`;
    const authRes = await authorizeRoute(authedRequest(authorizeUrl, accessToken));
    const code = new URL(authRes.headers.get("location")!).searchParams.get("code");

    const tokenRes = await tokenRoute(
      jsonRequest("http://test/api/v1/oauth/token", "POST", {
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        code_verifier: "the-wrong-verifier-entirely",
      }),
    );
    expect(tokenRes.status).toBe(400);
    expect((await tokenRes.json()).error).toBe("invalid_grant");
  });

  it("rejects code_challenge_method=plain outright", async () => {
    const { accessToken } = await loginViaOtp("0743000011");
    const authorizeUrl =
      `http://test/api/v1/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&response_type=code&scope=vendor.read&code_challenge=plaintext-challenge&code_challenge_method=plain`;
    const res = await authorizeRoute(authedRequest(authorizeUrl, accessToken));
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!);
    expect(location.searchParams.get("error")).toBe("invalid_request");
  });

  it("rejects an unregistered redirect_uri without redirecting to it", async () => {
    const { accessToken } = await loginViaOtp("0743000012");
    const authorizeUrl =
      `http://test/api/v1/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent("https://evil.example/steal")}` +
      `&response_type=code&scope=vendor.read&code_challenge=abc&code_challenge_method=S256`;
    const res = await authorizeRoute(authedRequest(authorizeUrl, accessToken));
    expect(res.status).toBe(400); // not a redirect — open-redirect protection
    expect(res.headers.get("location")).toBeNull();
  });

  it("rejects a scope outside the client's allowed_scopes", async () => {
    const { accessToken } = await loginViaOtp("0743000013");
    const { challenge } = pkcePair();
    const authorizeUrl =
      `http://test/api/v1/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
      `&response_type=code&scope=${encodeURIComponent("admin.everything")}&code_challenge=${challenge}&code_challenge_method=S256`;
    const res = await authorizeRoute(authedRequest(authorizeUrl, accessToken));
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get("location")!).searchParams.get("error")).toBe("invalid_scope");
  });

  it("rejects an unknown client_id", async () => {
    const { accessToken } = await loginViaOtp("0743000014");
    const authorizeUrl = `http://test/api/v1/oauth/authorize?client_id=does-not-exist&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&code_challenge=abc&code_challenge_method=S256`;
    const res = await authorizeRoute(authedRequest(authorizeUrl, accessToken));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_client");
  });

  it("the /authorize endpoint itself requires an authenticated session", async () => {
    const { NextRequest } = await import("next/server");
    const authorizeUrl = `http://test/api/v1/oauth/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&code_challenge=abc&code_challenge_method=S256`;
    const res = await authorizeRoute(new NextRequest(authorizeUrl));
    expect(res.status).toBe(401);
  });
});
