import { describe, expect, test } from "bun:test";
import type { NameStatusEntry, NumstatEntry } from "./parse/diffTree.ts";
import { combineFileChanges } from "./queries.ts";

describe("combineFileChanges", () => {
  test("an ordinary modification picks up its numstat line counts", () => {
    const numstat: NumstatEntry[] = [
      { path: "a.txt", additions: 3, deletions: 1, isBinary: false },
    ];
    const nameStatus: NameStatusEntry[] = [
      { kind: "modified", path: "a.txt", originalPath: undefined, similarity: undefined },
    ];
    expect(combineFileChanges(numstat, nameStatus)).toEqual([
      {
        kind: "modified",
        path: "a.txt",
        originalPath: undefined,
        similarity: undefined,
        additions: 3,
        deletions: 1,
        isBinary: false,
      },
    ]);
  });

  test("a binary file's numstat entry has undefined additions/deletions", () => {
    const numstat: NumstatEntry[] = [
      { path: "b.bin", additions: undefined, deletions: undefined, isBinary: true },
    ];
    const nameStatus: NameStatusEntry[] = [
      { kind: "added", path: "b.bin", originalPath: undefined, similarity: undefined },
    ];
    const [change] = combineFileChanges(numstat, nameStatus);
    expect(change?.isBinary).toBe(true);
    expect(change?.additions).toBeUndefined();
    expect(change?.deletions).toBeUndefined();
  });

  test("a rename combines the old path's deletions with the new path's additions", () => {
    // numstat ran without -M, so it sees this as an independent full delete + full add.
    const numstat: NumstatEntry[] = [
      { path: "old.txt", additions: 0, deletions: 5, isBinary: false },
      { path: "new.txt", additions: 6, deletions: 0, isBinary: false },
    ];
    const nameStatus: NameStatusEntry[] = [
      { kind: "renamed", path: "new.txt", originalPath: "old.txt", similarity: 92 },
    ];
    expect(combineFileChanges(numstat, nameStatus)).toEqual([
      {
        kind: "renamed",
        path: "new.txt",
        originalPath: "old.txt",
        similarity: 92,
        additions: 6,
        deletions: 5,
        isBinary: false,
      },
    ]);
  });

  test("a copy behaves the same as a rename for line-count combination", () => {
    const numstat: NumstatEntry[] = [
      { path: "orig.txt", additions: 0, deletions: 0, isBinary: false },
      { path: "copy.txt", additions: 3, deletions: 0, isBinary: false },
    ];
    const nameStatus: NameStatusEntry[] = [
      { kind: "copied", path: "copy.txt", originalPath: "orig.txt", similarity: 100 },
    ];
    const [change] = combineFileChanges(numstat, nameStatus);
    expect(change?.kind).toBe("copied");
    expect(change?.additions).toBe(3);
    expect(change?.deletions).toBe(0);
  });

  test("a file present in name-status but missing from numstat defaults counts to zero", () => {
    const nameStatus: NameStatusEntry[] = [
      { kind: "deleted", path: "gone.txt", originalPath: undefined, similarity: undefined },
    ];
    const [change] = combineFileChanges([], nameStatus);
    expect(change?.additions).toBeUndefined();
    expect(change?.deletions).toBeUndefined();
    expect(change?.isBinary).toBe(false);
  });
});
