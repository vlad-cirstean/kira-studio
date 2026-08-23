import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ElectronStorage } from "./storage.ts";

/** Real `fs`, a fresh temp dir per test — this file has no Electron API to fake at all, so
 *  there is nothing colocation would gain from stubbing one out. */

describe("ElectronStorage", () => {
  test("get returns undefined for a key that was never set", () => {
    const dir = mkdtempSync(join(tmpdir(), "kira-storage-"));
    try {
      const storage = new ElectronStorage(dir);
      expect(storage.get("global", "missing")).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("get reflects a set synchronously, before the write settles", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kira-storage-"));
    try {
      const storage = new ElectronStorage(dir);
      const write = storage.set("global", "theme", "dark");
      expect(storage.get<string>("global", "theme")).toBe("dark");
      await write;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("set persists to global.json under userData/storage", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kira-storage-"));
    try {
      const storage = new ElectronStorage(dir);
      await storage.set("global", "recentRepos", ["/a", "/b"]);
      const raw = readFileSync(join(dir, "storage", "global.json"), "utf8");
      expect(JSON.parse(raw)).toEqual({ recentRepos: ["/a", "/b"] });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("global and workspace scopes are stored and read independently", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kira-storage-"));
    try {
      const storage = new ElectronStorage(dir);
      await storage.set("global", "key", "global-value");
      await storage.set("workspace", "key", "workspace-value");
      expect(storage.get<string>("global", "key")).toBe("global-value");
      expect(storage.get<string>("workspace", "key")).toBe("workspace-value");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a fresh ElectronStorage rehydrates values written by a previous instance", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kira-storage-"));
    try {
      const first = new ElectronStorage(dir);
      await first.set("global", "windowBounds", { x: 0, y: 0, width: 800, height: 600 });

      const second = new ElectronStorage(dir);
      expect(
        second.get<{ x: number; y: number; width: number; height: number }>(
          "global",
          "windowBounds",
        ),
      ).toEqual({
        x: 0,
        y: 0,
        width: 800,
        height: 600,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a corrupt storage file is treated as empty rather than throwing", () => {
    const dir = mkdtempSync(join(tmpdir(), "kira-storage-"));
    try {
      mkdirSync(join(dir, "storage"), { recursive: true });
      writeFileSync(join(dir, "storage", "global.json"), "not json", "utf8");

      const storage = new ElectronStorage(dir);
      expect(storage.get("global", "anything")).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
