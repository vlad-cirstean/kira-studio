import { describe, expect, test } from "bun:test";
import {
  formatAbsoluteDate,
  formatRelativeDate,
} from "../../../packages/ui/src/components/dateFormat.ts";

const NOW_SECONDS = 1_700_100_000;
const NOW_MS = NOW_SECONDS * 1000;

describe("formatRelativeDate", () => {
  test("clamps a future timestamp (clock skew) to now rather than a negative duration", () => {
    expect(formatRelativeDate(NOW_SECONDS + 3600, NOW_MS)).toBe("now");
  });

  test("under a minute reads now", () => {
    expect(formatRelativeDate(NOW_SECONDS - 30, NOW_MS)).toBe("now");
  });

  test("minutes, hours, days, months and years each render their own unit", () => {
    expect(formatRelativeDate(NOW_SECONDS - 90, NOW_MS)).toBe("1m");
    expect(formatRelativeDate(NOW_SECONDS - 2 * 3600, NOW_MS)).toBe("2h");
    expect(formatRelativeDate(NOW_SECONDS - 5 * 86400, NOW_MS)).toBe("5d");
    expect(formatRelativeDate(NOW_SECONDS - 90 * 86400, NOW_MS)).toBe("3mo");
    expect(formatRelativeDate(NOW_SECONDS - 400 * 86400, NOW_MS)).toBe("1y");
  });

  test("defaults nowMs to the current clock when not supplied", () => {
    // Not asserting an exact string (that would be the moving-target problem this file's own
    // doc comment warns about) — just that a very recent timestamp reads as "now".
    expect(formatRelativeDate(Math.floor(Date.now() / 1000))).toBe("now");
  });
});

describe("formatAbsoluteDate", () => {
  test("renders a fixed UTC timestamp identically regardless of the host timezone", () => {
    expect(formatAbsoluteDate(1_700_000_000)).toBe("2023-11-14 22:13");
  });

  test("pads single-digit month/day/hour/minute components", () => {
    // 2024-01-02T03:04:00Z
    expect(formatAbsoluteDate(1_704_164_640)).toBe("2024-01-02 03:04");
  });
});
