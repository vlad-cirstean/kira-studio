import { describe, expect, test } from "bun:test";
import { fan, octopusOf, TopologyError, topology } from "./topology.ts";

describe("topology()", () => {
  test("round-trips a linear chain, newest first", () => {
    const records = topology(["A", "B:A", "C:B"]);
    expect(records.map((r) => r.subject)).toEqual(["C", "B", "A"]);
    expect(records[0]?.parents).toEqual([records[1]?.sha as string]);
    expect(records[1]?.parents).toEqual([records[2]?.sha as string]);
    expect(records[2]?.parents).toEqual([]);
  });

  test("a two-entry spec yields B before A", () => {
    const records = topology(["A", "B:A"]);
    expect(records.map((r) => r.subject)).toEqual(["B", "A"]);
  });

  test("shas are deterministic across calls", () => {
    const a = topology(["A", "B:A"]);
    const b = topology(["A", "B:A"]);
    expect(a.map((r) => r.sha)).toEqual(b.map((r) => r.sha));
  });

  test("a merge commit carries multiple parents in spec order", () => {
    const records = topology(["A", "B:A", "C:A", "D:B,C"]);
    const merge = records.find((r) => r.subject === "D");
    const bSha = records.find((r) => r.subject === "B")?.sha as string;
    const cSha = records.find((r) => r.subject === "C")?.sha as string;
    expect(merge?.parents).toEqual([bSha, cSha]);
  });

  test("rejects an unknown parent name", () => {
    expect(() => topology(["B:A"])).toThrow(TopologyError);
  });

  test("rejects a child listed before its parent (and so a cycle)", () => {
    expect(() => topology(["B:A", "A"])).toThrow(TopologyError);
    expect(() => topology(["A:B", "B:A"])).toThrow(TopologyError);
  });

  test("rejects a duplicate commit name", () => {
    expect(() => topology(["A", "A:A"])).toThrow(TopologyError);
  });

  test("rejects an entry with no name", () => {
    expect(() => topology([":A"])).toThrow(TopologyError);
  });
});

describe("fan()", () => {
  test("builds independent branches off a shared root, none merged", () => {
    const records = fan(3, 4);
    // root + 3 branches * 4 commits each
    expect(records).toHaveLength(1 + 3 * 4);
    const root = records.find((r) => r.subject === "fan-root");
    expect(root?.parents).toEqual([]);
    // No commit is a merge (every fan commit but the root has exactly one parent).
    expect(records.every((r) => r.parents.length <= 1)).toBe(true);
    // Every branch tip is never a parent of anything else (the branch is never merged back).
    const allParents = new Set(records.flatMap((r) => r.parents));
    for (let b = 0; b < 3; b++) {
      const tip = records.find((r) => r.subject === `fan-${b}-3`);
      expect(tip).toBeDefined();
      expect(allParents.has(tip?.sha ?? "")).toBe(false);
    }
  });
});

describe("octopusOf()", () => {
  test("builds a single merge commit with N parents", () => {
    const records = octopusOf(12);
    const merge = records.find((r) => r.subject === "octopus-merge");
    expect(merge?.parents).toHaveLength(12);
    expect(new Set(merge?.parents).size).toBe(12);
  });

  test("3-parent octopus has a base with three direct children", () => {
    const records = octopusOf(3);
    const base = records.find((r) => r.subject === "octopus-base");
    const childrenOfBase = records.filter((r) => r.parents.includes(base?.sha ?? ""));
    expect(childrenOfBase).toHaveLength(3);
  });

  test("rejects fewer than 2 parents", () => {
    expect(() => octopusOf(1)).toThrow();
  });
});
