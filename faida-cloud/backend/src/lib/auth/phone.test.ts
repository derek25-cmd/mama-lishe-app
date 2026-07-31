import { describe, expect, it } from "vitest";
import { normalizePhone, maskPhone } from "./phone";

describe("normalizePhone", () => {
  it("accepts strict E.164 as-is", () => {
    expect(normalizePhone("+255743123456")).toBe("+255743123456");
  });

  it("normalizes the 255-without-plus form", () => {
    expect(normalizePhone("255743123456")).toBe("+255743123456");
  });

  it("normalizes the common local 0-prefixed form", () => {
    expect(normalizePhone("0743123456")).toBe("+255743123456");
  });

  it("accepts the 6-prefixed mobile range too", () => {
    expect(normalizePhone("0655123456")).toBe("+255655123456");
  });

  it("strips spaces and hyphens before normalizing", () => {
    expect(normalizePhone("0743 123 456")).toBe("+255743123456");
    expect(normalizePhone("0743-123-456")).toBe("+255743123456");
  });

  it("rejects a non-mobile prefix (landline range)", () => {
    expect(normalizePhone("0223123456")).toBeNull();
  });

  it("rejects too few digits", () => {
    expect(normalizePhone("074312345")).toBeNull();
  });

  it("rejects too many digits", () => {
    expect(normalizePhone("07431234567")).toBeNull();
  });

  it("rejects a non-Tanzanian country code", () => {
    expect(normalizePhone("+254743123456")).toBeNull();
  });

  it("rejects garbage input", () => {
    expect(normalizePhone("not-a-phone")).toBeNull();
  });
});

describe("maskPhone", () => {
  it("keeps the country code + first digit and last 3 digits, masks the rest", () => {
    expect(maskPhone("+255743123456")).toBe("+2557***456");
  });

  it("falls back to a fixed mask for anything too short to safely partial-mask", () => {
    expect(maskPhone("12345")).toBe("***");
  });
});
