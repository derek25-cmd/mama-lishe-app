import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/middleware";
import { getActiveClient, validateRedirectUri, validateScopes, createAuthorizationCode } from "@/lib/auth/oauth";

// Authorization-code + PKCE (RFC 7636, S256 only). Vendors authenticate by
// OTP, not a login form, so this endpoint expects an already-authenticated
// session (Bearer token) rather than rendering a consent screen — there's
// no UI here, consent screens are explicitly out of scope for this phase.
export const GET = requireAuth(async (req, ctx) => {
  const params = req.nextUrl.searchParams;
  const clientId = params.get("client_id");
  const redirectUri = params.get("redirect_uri");
  const responseType = params.get("response_type");
  const scopeParam = params.get("scope") ?? "";
  const codeChallenge = params.get("code_challenge");
  const codeChallengeMethod = params.get("code_challenge_method");
  const state = params.get("state");

  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const client = await getActiveClient(clientId);
  if (!client) {
    return NextResponse.json({ error: "invalid_client" }, { status: 400 });
  }
  if (!validateRedirectUri(client, redirectUri)) {
    // Never redirect to an unvalidated URI — that's an open-redirect hole,
    // so this specific failure is reported directly, not via redirect.
    return NextResponse.json(
      { error: "invalid_request", error_description: "redirect_uri not registered for this client" },
      { status: 400 },
    );
  }

  // redirect_uri is trusted from here on — RFC 6749 §4.1.2.1 wants
  // remaining errors delivered back to the client via redirect.
  const redirectWithError = (error: string, description?: string) => {
    const url = new URL(redirectUri);
    url.searchParams.set("error", error);
    if (description) url.searchParams.set("error_description", description);
    if (state) url.searchParams.set("state", state);
    return NextResponse.redirect(url, 302);
  };

  if (responseType !== "code") {
    return redirectWithError("unsupported_response_type");
  }
  if (!codeChallenge || codeChallengeMethod !== "S256") {
    // "plain" is rejected here, not silently downgraded.
    return redirectWithError("invalid_request", "code_challenge_method must be S256");
  }

  const scopes = scopeParam.split(" ").filter(Boolean);
  if (!validateScopes(client, scopes)) {
    return redirectWithError("invalid_scope");
  }

  const code = await createAuthorizationCode({
    clientId: client.client_id,
    vendorId: ctx.vendorId,
    scopes,
    codeChallenge,
    redirectUri,
  });

  const url = new URL(redirectUri);
  url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);
  return NextResponse.redirect(url, 302);
});
