/**
 * `Storage` backed by two JSON files under `userData/storage` (§3.3, W11) — Electron's
 * counterpart to VS Code's two `Memento`s. `get` is synchronous per the port's contract, so
 * both files are read once at construction into an in-memory cache; `set` updates that cache
 * immediately (so a `get` right after an unresolved `set` sees the new value) and persists to
 * disk afterward with an atomic temp-file-then-rename write, so a crash mid-write never leaves
 * a truncated file behind for the next launch to fail on.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Storage, StorageScope } from "@kira-version/core";

function fileNameFor(scope: StorageScope): string {
  return scope === "global" ? "global.json" : "workspace.json";
}

function readJsonFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export class ElectronStorage implements Storage {
  readonly #dir: string;
  readonly #cache: Record<StorageScope, Record<string, unknown>>;

  constructor(userDataDir: string) {
    this.#dir = join(userDataDir, "storage");
    mkdirSync(this.#dir, { recursive: true });
    this.#cache = {
      global: readJsonFile(join(this.#dir, fileNameFor("global"))),
      workspace: readJsonFile(join(this.#dir, fileNameFor("workspace"))),
    };
  }

  get<T>(scope: StorageScope, key: string): T | undefined {
    return this.#cache[scope][key] as T | undefined;
  }

  async set(scope: StorageScope, key: string, value: unknown): Promise<void> {
    this.#cache[scope] = { ...this.#cache[scope], [key]: value };
    const path = join(this.#dir, fileNameFor(scope));
    const tempPath = `${path}.tmp`;
    await writeFile(tempPath, JSON.stringify(this.#cache[scope]), "utf8");
    await rename(tempPath, path);
  }
}
