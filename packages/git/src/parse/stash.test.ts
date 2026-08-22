import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { splitRecords } from "@kira-version/core";
import { parseStashRecord } from "./stash.ts";

const FIXTURES = join(import.meta.dir, "../../../../tests/fixtures/porcelain/stash");

async function* toAsyncIterable(bytes: Uint8Array) {
  yield bytes;
}

describe("parseStashRecord", () => {
  test("parses index, sha, base sha and the 'On <branch>: <msg>' message", async () => {
    const bytes = readFileSync(join(FIXTURES, "list.bin"));
    const records = [];
    for await (const record of splitRecords(toAsyncIterable(bytes))) records.push(record);
    expect(records).toHaveLength(1);

    const entry = parseStashRecord(records[0] as Uint8Array);
    expect(entry.index).toBe(0);
    expect(entry.sha).toMatch(/^[0-9a-f]{40}$/);
    expect(entry.baseSha).toMatch(/^[0-9a-f]{40}$/);
    expect(entry.sha).not.toBe(entry.baseSha);
    expect(entry.message).toContain("On main:");
    expect(entry.timestamp).toBeGreaterThan(0);
  });
});
