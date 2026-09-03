import { describe, expect, test } from "bun:test";
import { laneClass, nodeKindFor, NODE_CLASS } from "../../../packages/ui/src/graph/palette.ts";

describe("laneClass", () => {
  test("the first eight colours get their own class", () => {
    expect(laneClass(0)).toBe("kv-lane-0");
    expect(laneClass(7)).toBe("kv-lane-7");
  });

  test("a colour index at or past the default palette size wraps", () => {
    expect(laneClass(8)).toBe("kv-lane-0");
    expect(laneClass(9)).toBe("kv-lane-1");
  });

  test("a custom palette size changes where the wrap happens", () => {
    expect(laneClass(4, 4)).toBe("kv-lane-0");
    expect(laneClass(3, 4)).toBe("kv-lane-3");
  });
});

test("NODE_CLASS is the literal class name the generated CSS defines", () => {
  expect(NODE_CLASS).toBe("kv-node");
});

describe("nodeKindFor", () => {
  test("one parent, no stash decoration: an ordinary commit", () => {
    expect(nodeKindFor(1, false)).toBe("commit");
  });

  test("zero parents (a root commit) is still ordinary, not a merge", () => {
    expect(nodeKindFor(0, false)).toBe("commit");
  });

  test("more than one parent, no stash decoration: a merge", () => {
    expect(nodeKindFor(2, false)).toBe("merge");
    expect(nodeKindFor(4, false)).toBe("merge");
  });

  test("a stash decoration wins even though a real stash commit has two parents", () => {
    expect(nodeKindFor(2, true)).toBe("stash");
  });

  test("a stash decoration on a one-parent row is still a stash", () => {
    expect(nodeKindFor(1, true)).toBe("stash");
  });
});
