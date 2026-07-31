import { describe, expect, it } from "vitest";
import { tzs } from "../types.js";

describe("tzs()", () => {
  it("accepts an integer", () => {
    expect(tzs(5000)).toBe(5000);
  });

  it("accepts zero", () => {
    expect(tzs(0)).toBe(0);
  });

  it("throws on a non-integer value — a float can never silently become money", () => {
    expect(() => tzs(5000.5)).toThrow(/must be an integer/);
  });
});
