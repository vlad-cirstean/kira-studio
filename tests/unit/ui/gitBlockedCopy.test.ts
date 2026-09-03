import { describe, expect, test } from "bun:test";
import {
  detectPlatform,
  gitBlockedCopy,
  upgradeCommandFor,
} from "../../../packages/ui/src/components/gitBlockedCopy.ts";

describe("detectPlatform", () => {
  test("recognises a macOS user agent", () => {
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("mac");
  });

  test("recognises a Windows user agent", () => {
    expect(detectPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("windows");
  });

  test("recognises a Linux user agent", () => {
    expect(detectPlatform("Mozilla/5.0 (X11; Linux x86_64)")).toBe("linux");
  });

  test("falls back to unknown rather than guessing", () => {
    expect(detectPlatform("some-unrecognisable-string")).toBe("unknown");
  });
});

describe("upgradeCommandFor", () => {
  test("every platform has a distinct, non-empty command", () => {
    const commands = (["mac", "windows", "linux", "unknown"] as const).map(upgradeCommandFor);
    expect(new Set(commands).size).toBe(commands.length);
    for (const command of commands) expect(command.length).toBeGreaterThan(0);
  });
});

describe("gitBlockedCopy", () => {
  test("notFound names every probed path", () => {
    const copy = gitBlockedCopy({ kind: "notFound", probed: ["/usr/bin/git", "/opt/git"] }, "mac");
    expect(copy.detail).toContain("/usr/bin/git");
    expect(copy.detail).toContain("/opt/git");
  });

  test("notFound with nothing probed still reads sensibly", () => {
    const copy = gitBlockedCopy({ kind: "notFound", probed: [] }, "mac");
    expect(copy.detail).not.toContain("undefined");
    expect(copy.detail.length).toBeGreaterThan(0);
  });

  test("tooOld names the detected and required versions, the setting id, and the platform command", () => {
    const copy = gitBlockedCopy(
      {
        kind: "tooOld",
        path: "/usr/bin/git",
        detected: "2.10.0",
        required: "2.28.0",
        settingId: "kiraVersion.git.path",
      },
      "linux",
    );
    expect(copy.detail).toContain("2.10.0");
    expect(copy.detail).toContain("2.28.0");
    expect(copy.detail).toContain("kiraVersion.git.path");
    expect(copy.detail).toContain(upgradeCommandFor("linux"));
  });

  test("unusable names the path and the reason verbatim", () => {
    const copy = gitBlockedCopy(
      { kind: "unusable", path: "/usr/bin/git", reason: "exited with code 127" },
      "windows",
    );
    expect(copy.detail).toContain("/usr/bin/git");
    expect(copy.detail).toContain("exited with code 127");
  });
});
