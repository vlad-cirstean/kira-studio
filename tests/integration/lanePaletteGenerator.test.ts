import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * P4 W1 / `scripts/gen-lane-palette.ts` — the generator that keeps the eight lane colours (VS
 * Code's `contributes.colors` plus the CSS literal fallback + rules) in sync with the script's
 * own `CLUSTER_HUES`/`LANE_TIERS` source table. Both paths the script's own doc comment promises
 * are exercised here, following `settingsGenerator.test.ts`'s "mutate the real committed file,
 * restore in `finally`" shape, since neither artifact path is injectable:
 *
 *  - **Determinism** (`--check`): a hand-edited artifact is caught, the way `gen-settings.ts`'s
 *    already is.
 *  - **Distinguishability** (no `--check`, plain run): a source table that no longer clears the
 *    CVD ΔE bar makes `generateAll()` throw *before* either artifact is written — this is what
 *    "Done when: `bun run check` fails ... on a deliberately low-contrast hue" rests on, since a
 *    bad source table can never reach disk to be `--check`ed against in the first place.
 */

const REPO_ROOT = join(import.meta.dir, "..", "..");
const SCRIPT_PATH = join(REPO_ROOT, "scripts", "gen-lane-palette.ts");
const TOKENS_CSS_PATH = join(REPO_ROOT, "packages", "ui", "src", "theme", "vscode-tokens.css");

function run(args: readonly string[]): { readonly exitCode: number; readonly stderr: string } {
  try {
    execFileSync("bun", [SCRIPT_PATH, ...args], { cwd: REPO_ROOT, stdio: "pipe" });
    return { exitCode: 0, stderr: "" };
  } catch (error) {
    const e = error as { readonly status: number | null; readonly stderr: Buffer };
    return { exitCode: e.status ?? 1, stderr: e.stderr.toString("utf8") };
  }
}

describe("gen-lane-palette --check", () => {
  test("passes on the committed artifacts", () => {
    const result = run(["--check"]);
    expect(result.exitCode).toBe(0);
  });

  test("fails on a mutated copy of vscode-tokens.css", () => {
    const original = readFileSync(TOKENS_CSS_PATH, "utf8");
    try {
      const mutated = original.replace(
        "--kv-graph-lane-0: var(--vscode-kiraVersion-graphLane0,",
        "--kv-graph-lane-0: var(--vscode-kiraVersion-graphLane0, /* wrong on purpose */",
      );
      expect(mutated).not.toBe(original);
      writeFileSync(TOKENS_CSS_PATH, mutated);

      const result = run(["--check"]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("out of date");
    } finally {
      writeFileSync(TOKENS_CSS_PATH, original);
    }
    expect(readFileSync(TOKENS_CSS_PATH, "utf8")).toBe(original);
  });
});

describe("gen-lane-palette — distinguishability guard", () => {
  test("a deliberately low-contrast/collapsing hue pair makes the generator throw", () => {
    const original = readFileSync(SCRIPT_PATH, "utf8");
    try {
      // Both clusters on the same hue: every lane pair within a tier now differs only by the
      // saturation/lightness spread, which the CVD simulation compresses further — exactly the
      // "eight hues collapse under dichromacy" failure this script's checks exist to catch.
      const mutated = original.replace(
        "const CLUSTER_HUES: readonly [blue: number, orange: number] = [205, 15];",
        "const CLUSTER_HUES: readonly [blue: number, orange: number] = [205, 206];",
      );
      expect(mutated).not.toBe(original);
      writeFileSync(SCRIPT_PATH, mutated);

      const result = run([]); // no --check: the throw happens before either artifact is written
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("CVD-distinguishability");
    } finally {
      writeFileSync(SCRIPT_PATH, original);
    }
    expect(readFileSync(SCRIPT_PATH, "utf8")).toBe(original);
  });
});
