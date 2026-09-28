import { describe, it, expect } from "vitest";
import { scaleToTotal } from "@/lib/splitCalculator";

describe("scaleToTotal", () => {
  it("applies a discount proportionally across groups", () => {
    expect(scaleToTotal([300, 500, 200], 800)).toEqual([240, 400, 160]);
  });

  it("returns the parts unchanged when there is no discount", () => {
    expect(scaleToTotal([123.45, 76.55], 200)).toEqual([123.45, 76.55]);
  });

  it("always sums to the total despite rounding", () => {
    const result = scaleToTotal([1, 1, 1], 2);
    expect(Math.round(result.reduce((a, b) => a + b, 0) * 100)).toBe(200);
    expect(result.every((r) => r === 0.66 || r === 0.67)).toBe(true);
  });

  it("handles all-zero parts", () => {
    expect(scaleToTotal([0, 0], 100)).toEqual([0, 0]);
  });
});
