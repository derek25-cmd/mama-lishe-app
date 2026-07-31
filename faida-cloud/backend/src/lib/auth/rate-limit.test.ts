import { describe, expect, it } from "vitest";
import { clientIpFromHeaders } from "./rate-limit";

describe("clientIpFromHeaders", () => {
  it("takes the last entry — the hop nginx itself appended", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.1, 198.51.100.9, 192.0.2.55" });
    expect(clientIpFromHeaders(headers)).toBe("192.0.2.55");
  });

  it("trims whitespace around entries", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.1 ,  192.0.2.55" });
    expect(clientIpFromHeaders(headers)).toBe("192.0.2.55");
  });

  it("returns 'unknown' when the header is entirely absent", () => {
    expect(clientIpFromHeaders(new Headers())).toBe("unknown");
  });

  it("returns 'unknown' for a single trailing-comma malformed value", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.1," });
    expect(clientIpFromHeaders(headers)).toBe("unknown");
  });
});
