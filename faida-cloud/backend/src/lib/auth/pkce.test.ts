import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyPkce } from "./pkce";

function s256Challenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

describe("verifyPkce", () => {
  it("accepts a matching verifier/challenge pair (S256)", () => {
    const verifier = "a-random-code-verifier-at-least-43-chars-long-per-rfc7636";
    const challenge = s256Challenge(verifier);
    expect(verifyPkce(verifier, challenge)).toBe(true);
  });

  it("rejects a verifier that doesn't match the challenge", () => {
    const challenge = s256Challenge("the-real-verifier");
    expect(verifyPkce("a-different-verifier", challenge)).toBe(false);
  });

  it("rejects a challenge of a different length than the computed hash", () => {
    expect(verifyPkce("any-verifier", "too-short")).toBe(false);
  });

  it("is not fooled by a 'plain' style challenge equal to the verifier itself", () => {
    // If someone tried to use plain-method semantics (challenge === verifier)
    // against this S256-only verifier, it must still fail.
    const verifier = "some-verifier-value-that-is-long-enough-1234567890";
    expect(verifyPkce(verifier, verifier)).toBe(false);
  });
});
