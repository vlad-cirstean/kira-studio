import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { RecordSplitter } from "@kira-version/core";
import { parseStatus } from "./status.ts";

const FIXTURES = join(import.meta.dir, "../../../../tests/fixtures/porcelain/status");

function loadRecords(name: string): Uint8Array[] {
  const bytes = readFileSync(join(FIXTURES, `${name}.bin`));
  const splitter = new RecordSplitter();
  const records = splitter.push(bytes);
  const tail = splitter.finish();
  return tail !== undefined ? [...records, tail] : records;
}

describe("parseStatus", () => {
  test("clean: no entries, branch header only", () => {
    const result = parseStatus(loadRecords("clean"));
    expect(result.entries).toHaveLength(0);
    expect(result.branch.head).toEqual({ kind: "branch", name: "main" });
    expect(result.branch.oid).toMatch(/^[0-9a-f]{40}$/);
  });

  test("dirty: one ordinary unstaged modification", () => {
    const result = parseStatus(loadRecords("dirty"));
    expect(result.entries).toHaveLength(1);
    const [entry] = result.entries;
    expect(entry?.kind).toBe("ordinary");
    if (entry?.kind === "ordinary") {
      expect(entry.staged).toBe(".");
      expect(entry.unstaged).toBe("M");
      expect(entry.path).toBe("file.txt");
    }
  });

  test("untracked: a ? entry with just a path", () => {
    const result = parseStatus(loadRecords("untracked"));
    expect(result.entries).toEqual([{ kind: "untracked", path: "new.txt" }]);
  });

  test("staged + unstaged: XY reflects both index and worktree changes", () => {
    const result = parseStatus(loadRecords("stagedAndUnstaged"));
    const [entry] = result.entries;
    expect(entry?.kind).toBe("ordinary");
    if (entry?.kind === "ordinary") {
      expect(entry.staged).toBe("M");
      expect(entry.unstaged).toBe("M");
    }
  });

  test("renamed: a '2' record consumes its origPath from the next NUL chunk", () => {
    const result = parseStatus(loadRecords("renamed"));
    expect(result.entries).toHaveLength(1);
    const [entry] = result.entries;
    expect(entry?.kind).toBe("renamed");
    if (entry?.kind === "renamed") {
      expect(entry.path).toBe("renamed.txt");
      expect(entry.originalPath).toBe("file.txt");
      expect(entry.renameOrCopy).toBe("rename");
      expect(entry.similarity).toBe(100);
    }
  });

  test("ignored: a ! entry, only present when --ignored was requested", () => {
    const result = parseStatus(loadRecords("ignored"));
    const ignored = result.entries.filter((e) => e.kind === "ignored");
    expect(ignored).toEqual([{ kind: "ignored", path: "ignored.log" }]);
  });

  test("unmerged: stage 1/2/3 modes and object ids from a real conflict", () => {
    const result = parseStatus(loadRecords("unmerged"));
    const unmerged = result.entries.find((e) => e.kind === "unmerged");
    expect(unmerged).toBeDefined();
    if (unmerged?.kind === "unmerged") {
      expect(unmerged.staged).toBe("U");
      expect(unmerged.unstaged).toBe("U");
      expect(unmerged.base.objectId).toMatch(/^[0-9a-f]{40}$/);
      expect(unmerged.ours.objectId).toMatch(/^[0-9a-f]{40}$/);
      expect(unmerged.theirs.objectId).toMatch(/^[0-9a-f]{40}$/);
      expect(unmerged.base.objectId).not.toBe(unmerged.ours.objectId);
      expect(unmerged.ours.objectId).not.toBe(unmerged.theirs.objectId);
    }
  });

  test("unborn: (initial) oid and no upstream/ab headers", () => {
    const result = parseStatus(loadRecords("unborn"));
    expect(result.branch.oid).toBeUndefined();
    expect(result.branch.head).toEqual({ kind: "branch", name: "main" });
    expect(result.branch.upstream).toBeUndefined();
    expect(result.branch.ahead).toBeUndefined();
    expect(result.branch.behind).toBeUndefined();
    expect(result.entries).toHaveLength(0);
  });
});
