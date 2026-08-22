import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { splitRecords } from "@kira-version/core";
import { REFS_RECORD_DELIMITER, parseRefRecord } from "./refs.ts";

const FIXTURES = join(import.meta.dir, "../../../../tests/fixtures/porcelain/refs");
const HAND_AUTHORED = join(import.meta.dir, "../../../../tests/fixtures/porcelain/handAuthored");

async function* toAsyncIterable(bytes: Uint8Array) {
  yield bytes;
}

async function loadRefs(dir: string, name: string) {
  const bytes = readFileSync(join(dir, `${name}.bin`));
  const records = [];
  for await (const record of splitRecords(toAsyncIterable(bytes), {
    delimiter: REFS_RECORD_DELIMITER,
  })) {
    records.push(record);
  }
  return records.map(parseRefRecord);
}

describe("parseRefRecord", () => {
  test("upstream and ahead/behind track are populated for a branch with a remote", async () => {
    const refs = await loadRefs(FIXTURES, "withRemote");
    const main = refs.find((r) => r.refname === "refs/heads/main");
    expect(main).toBeDefined();
    expect(main?.kind).toBe("branch");
    expect(main?.shortName).toBe("main");
    expect(main?.upstream).toBe("refs/remotes/origin/main");
    expect(main?.track).toEqual({ ahead: 1, behind: 0 });

    const remote = refs.find((r) => r.refname === "refs/remotes/origin/main");
    expect(remote?.kind).toBe("remoteBranch");
    expect(remote?.shortName).toBe("origin/main");
  });

  test("an annotated tag reports the tag object id and its peeled commit target", async () => {
    const refs = await loadRefs(FIXTURES, "annotatedTag");
    const tag = refs.find((r) => r.kind === "tag");
    expect(tag).toBeDefined();
    expect(tag?.refname).toBe("refs/tags/v1");
    expect(tag?.objectType).toBe("tag");
    expect(tag?.objectId).toMatch(/^[0-9a-f]{40}$/);
    expect(tag?.peeledObjectId).toMatch(/^[0-9a-f]{40}$/);
    expect(tag?.objectId).not.toBe(tag?.peeledObjectId);

    const branch = refs.find((r) => r.kind === "branch");
    expect(branch?.isHead).toBe(true);
  });

  test("a ref with no upstream configured parses upstream/track as undefined", async () => {
    const refs = await loadRefs(HAND_AUTHORED, "refsNoUpstream");
    const main = refs.find((r) => r.refname === "refs/heads/main");
    expect(main?.upstream).toBeUndefined();
    expect(main?.track).toBeUndefined();
    expect(main?.peeledObjectId).toBeUndefined();
    expect(main?.isHead).toBe(true);
  });
});
