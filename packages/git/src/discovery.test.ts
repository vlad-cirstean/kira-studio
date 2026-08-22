import { describe, expect, test } from "bun:test";
import {
  MINIMUM_GIT_VERSION,
  compareVersions,
  meetsMinimumVersion,
  parseGitVersion,
} from "./discovery.ts";

/**
 * Pure logic only — no spawning, no fixtures. `locateGit`'s and `resolveRepoIdentity`'s tests
 * need a real (fake) git binary and real repositories, which per the project convention (see
 * AGENTS.md / SPEC.md §3.1) belong under tests/integration/, not colocated here: see
 * tests/integration/discovery.test.ts.
 */

describe("parseGitVersion", () => {
  test("handles the real-world forms git actually emits", () => {
    expect(parseGitVersion("git version 2.39.5 (Apple Git-154)")).toEqual({
      major: 2,
      minor: 39,
      patch: 5,
      raw: "git version 2.39.5 (Apple Git-154)",
    });
    expect(parseGitVersion("git version 2.38.0.windows.1")).toEqual(
      expect.objectContaining({ major: 2, minor: 38, patch: 0 }),
    );
    expect(parseGitVersion("git version 2.38.0-rc1")).toEqual(
      expect.objectContaining({ major: 2, minor: 38, patch: 0 }),
    );
    expect(parseGitVersion("git version 2.38.GIT")).toEqual(
      expect.objectContaining({ major: 2, minor: 38, patch: 0 }),
    );
  });

  test("returns undefined for unparsable output", () => {
    expect(parseGitVersion("not a version string at all")).toBeUndefined();
  });
});

describe("compareVersions / meetsMinimumVersion", () => {
  test("orders major, then minor, then patch", () => {
    expect(compareVersions({ major: 2, minor: 37, patch: 9, raw: "" }, MINIMUM_GIT_VERSION)).toBe(
      -1,
    );
    expect(compareVersions({ major: 2, minor: 38, patch: 0, raw: "" }, MINIMUM_GIT_VERSION)).toBe(
      0,
    );
    expect(compareVersions({ major: 2, minor: 39, patch: 0, raw: "" }, MINIMUM_GIT_VERSION)).toBe(
      1,
    );
    expect(compareVersions({ major: 3, minor: 0, patch: 0, raw: "" }, MINIMUM_GIT_VERSION)).toBe(1);
  });

  test("meetsMinimumVersion is the >= 0 shorthand", () => {
    expect(meetsMinimumVersion({ major: 2, minor: 38, patch: 0, raw: "" })).toBe(true);
    expect(meetsMinimumVersion({ major: 2, minor: 37, patch: 9, raw: "" })).toBe(false);
  });
});
