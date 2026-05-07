import { describe, it, expect, vi, beforeEach } from "vitest";
import { ageStr, ageClass, dotClass } from "./status-helpers.js";

const NOW = 1_700_000_000_000;

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
});

describe("ageStr", () => {
  it("returns — for zero (no data)", () => {
    expect(ageStr(0)).toBe("—");
  });

  it("shows seconds for sub-minute age", () => {
    expect(ageStr(NOW - 30_000)).toBe("30s ago");
  });

  it("shows minutes for sub-hour age", () => {
    expect(ageStr(NOW - 5 * 60_000)).toBe("5m ago");
  });

  it("shows hours for age >= 1 hour", () => {
    expect(ageStr(NOW - 2 * 3600_000)).toBe("2h ago");
  });
});

describe("ageClass", () => {
  it("returns red for zero (no data)", () => {
    expect(ageClass(0)).toBe("red");
  });

  it("returns green within 2 minutes", () => {
    expect(ageClass(NOW - 60_000)).toBe("green");
  });

  it("returns amber between 2 and 10 minutes", () => {
    expect(ageClass(NOW - 5 * 60_000)).toBe("amber");
  });

  it("returns red beyond 10 minutes", () => {
    expect(ageClass(NOW - 15 * 60_000)).toBe("red");
  });
});

describe("dotClass", () => {
  it("returns dot-red for zero", () => {
    expect(dotClass(0)).toBe("dot-red");
  });

  it("returns dot-green within 2 minutes", () => {
    expect(dotClass(NOW - 60_000)).toBe("dot-green");
  });

  it("returns dot-amber between 2 and 10 minutes", () => {
    expect(dotClass(NOW - 5 * 60_000)).toBe("dot-amber");
  });

  it("returns dot-red beyond 10 minutes", () => {
    expect(dotClass(NOW - 15 * 60_000)).toBe("dot-red");
  });
});
