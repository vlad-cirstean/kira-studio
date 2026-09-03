import { describe, expect, test } from "bun:test";
import { shortRepoLabel } from "../../../packages/ui/src/components/repoLabel.ts";

describe("shortRepoLabel", () => {
  test("a POSIX path returns its trailing segment", () => {
    expect(shortRepoLabel("/home/alice/projects/kira-version")).toBe("kira-version");
  });

  test("a Windows path returns its trailing segment", () => {
    expect(shortRepoLabel("C:\\Users\\alice\\projects\\kira-version")).toBe("kira-version");
  });

  test("a trailing separator is ignored", () => {
    expect(shortRepoLabel("/home/alice/projects/kira-version/")).toBe("kira-version");
  });

  test("a bare root with no segments falls back to the input itself", () => {
    expect(shortRepoLabel("/")).toBe("/");
  });

  test("a single segment with no separators returns itself", () => {
    expect(shortRepoLabel("kira-version")).toBe("kira-version");
  });
});
