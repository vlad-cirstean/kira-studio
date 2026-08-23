import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ElectronLogger } from "./logger.ts";

describe("ElectronLogger", () => {
  test("writes lines at or above the current level, skips below it", () => {
    const dir = mkdtempSync(join(tmpdir(), "kira-logger-"));
    try {
      const logger = new ElectronLogger(dir, () => "warn");
      logger.log("error", "boom");
      logger.log("warn", "careful");
      logger.log("info", "fyi");
      logger.log("debug", "chatter");

      const contents = readFileSync(join(dir, "kira-version.log"), "utf8");
      expect(contents).toContain("ERROR: boom");
      expect(contents).toContain("WARN: careful");
      expect(contents).not.toContain("fyi");
      expect(contents).not.toContain("chatter");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("off suppresses every level, without ever creating the log file", () => {
    const dir = mkdtempSync(join(tmpdir(), "kira-logger-"));
    try {
      const logger = new ElectronLogger(dir, () => "off");
      logger.log("error", "should not appear");
      expect(existsSync(join(dir, "kira-version.log"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("child prefixes messages with its dotted scope and shares the same file", () => {
    const dir = mkdtempSync(join(tmpdir(), "kira-logger-"));
    try {
      const root = new ElectronLogger(dir, () => "debug");
      const child = root.child("fileWatcher");
      const grandchild = child.child("poll");

      root.log("info", "root message");
      child.log("info", "child message");
      grandchild.log("info", "grandchild message");

      const contents = readFileSync(join(dir, "kira-version.log"), "utf8");
      expect(contents).toContain("INFO: root message");
      expect(contents).toContain("[fileWatcher] INFO: child message");
      expect(contents).toContain("[fileWatcher.poll] INFO: grandchild message");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("rotates a pre-existing log file to .old, but only for the root logger", () => {
    const dir = mkdtempSync(join(tmpdir(), "kira-logger-"));
    try {
      writeFileSync(join(dir, "kira-version.log"), "previous run\n", "utf8");

      const root = new ElectronLogger(dir, () => "info");
      expect(readFileSync(join(dir, "kira-version.log.old"), "utf8")).toBe("previous run\n");
      expect(existsSync(join(dir, "kira-version.log"))).toBe(false);

      root.log("info", "new run");
      expect(readFileSync(join(dir, "kira-version.log"), "utf8")).toContain("new run");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("appends Error name and message, and JSON-serializes other data", () => {
    const dir = mkdtempSync(join(tmpdir(), "kira-logger-"));
    try {
      const logger = new ElectronLogger(dir, () => "debug");
      logger.log("error", "failed", new Error("boom"));
      logger.log("info", "activated", { git: "/usr/bin/git" });

      const contents = readFileSync(join(dir, "kira-version.log"), "utf8");
      expect(contents).toContain("failed Error: boom");
      expect(contents).toContain('activated {"git":"/usr/bin/git"}');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
