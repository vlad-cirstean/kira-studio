import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * D25 / `scripts/gen-settings.ts` — the generator that keeps `packages/host-vscode/
 * package.json`'s `contributes.configuration` in sync with `@kira-version/core`'s settings
 * schema, the single source of truth `bun run check` gates on. `MANIFEST_PATH` inside the
 * script is hardcoded to the real committed manifest (`import.meta.dir`-relative, not
 * injectable), so this drives the real CLI as a subprocess against the real file rather than
 * importing the script's internals — exactly what a developer running `bun run check` does.
 *
 * The "mutated copy" half temporarily edits the real, committed manifest on disk and restores
 * it in a `finally` — the only way to exercise `--check`'s failure path against the file it
 * actually reads, since the path isn't parameterized. A crash between the edit and the restore
 * would leave the repo dirty; `try`/`finally` plus a final read-back assertion is the guard
 * against that being silent.
 */

const REPO_ROOT = join(import.meta.dir, "..", "..");
const SCRIPT_PATH = join(REPO_ROOT, "scripts", "gen-settings.ts");
const MANIFEST_PATH = join(REPO_ROOT, "packages", "host-vscode", "package.json");

function runCheck(): { readonly exitCode: number; readonly stderr: string } {
  try {
    execFileSync("bun", [SCRIPT_PATH, "--check"], { cwd: REPO_ROOT, stdio: "pipe" });
    return { exitCode: 0, stderr: "" };
  } catch (error) {
    const e = error as { readonly status: number | null; readonly stderr: Buffer };
    return { exitCode: e.status ?? 1, stderr: e.stderr.toString("utf8") };
  }
}

describe("gen-settings --check", () => {
  test("passes on the committed manifest", () => {
    const result = runCheck();
    expect(result.exitCode).toBe(0);
  });

  test("fails on a mutated copy of the manifest", () => {
    const original = readFileSync(MANIFEST_PATH, "utf8");
    try {
      const manifest = JSON.parse(original) as {
        contributes: { configuration: { properties: Record<string, unknown> } };
      };
      manifest.contributes.configuration.properties["kiraVersion.graph.pageSize"] = {
        type: "number",
        default: 999_999, // wrong on purpose — differs from schema.ts's real default
      };
      writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);

      const result = runCheck();
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("out of date");
    } finally {
      writeFileSync(MANIFEST_PATH, original);
    }
    expect(readFileSync(MANIFEST_PATH, "utf8")).toBe(original);
  });
});
