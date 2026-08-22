import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseMergeTreeOutput } from "./mergeTree.ts";

const FIXTURES = join(import.meta.dir, "../../../../tests/fixtures/porcelain/mergeTree");

describe("parseMergeTreeOutput", () => {
  test("a clean merge yields the tree id and no conflicted paths", () => {
    const stdout = readFileSync(join(FIXTURES, "clean.bin"), "utf8");
    const result = parseMergeTreeOutput(stdout, 0);
    expect(result.kind).toBe("clean");
    if (result.kind === "clean") {
      expect(result.treeId).toMatch(/^[0-9a-f]{40}$/);
    }
  });

  test("a real conflict (cross-checked against an actual merge, see integration suite) lists the conflicted path", () => {
    const stdout = readFileSync(join(FIXTURES, "conflict.bin"), "utf8");
    const result = parseMergeTreeOutput(stdout, 1);
    expect(result.kind).toBe("conflicts");
    if (result.kind === "conflicts") {
      expect(result.paths).toEqual(["conflict.txt"]);
      expect(result.messages.some((m) => m.includes("CONFLICT"))).toBe(true);
    }
  });

  test("exit codes above 1 are not a clean/conflict result", () => {
    expect(() => parseMergeTreeOutput("abc\n", 2)).toThrow();
  });
});
