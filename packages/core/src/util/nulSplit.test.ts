import { describe, expect, test } from "bun:test";
import {
  RecordSplitter,
  RemainderOverflowError,
  splitLimitedFields,
  splitRecords,
} from "./nulSplit.ts";

function bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

function text(b: Uint8Array): string {
  return new TextDecoder().decode(b);
}

describe("RecordSplitter", () => {
  test("splits a single chunk on the delimiter", () => {
    const splitter = new RecordSplitter();
    const records = splitter.push(bytes("a\0b\0c\0")).map(text);
    expect(records).toEqual(["a", "b", "c"]);
    expect(splitter.finish()).toBeUndefined();
  });

  test("holds a record split across three chunks", () => {
    const splitter = new RecordSplitter();
    expect(splitter.push(bytes("ab")).map(text)).toEqual([]);
    expect(splitter.push(bytes("cd")).map(text)).toEqual([]);
    expect(splitter.push(bytes("ef\0")).map(text)).toEqual(["abcdef"]);
  });

  test("yields an empty trailing record", () => {
    const splitter = new RecordSplitter();
    const records = splitter.push(bytes("a\0\0")).map(text);
    expect(records).toEqual(["a", ""]);
  });

  test("yields an empty record when the delimiter is the first byte", () => {
    const splitter = new RecordSplitter();
    const records = splitter.push(bytes("\0a")).map(text);
    expect(records).toEqual([""]);
    expect(text(splitter.finish() ?? new Uint8Array())).toBe("a");
  });

  test("finish() returns undefined when the stream ended cleanly on a delimiter", () => {
    const splitter = new RecordSplitter();
    splitter.push(bytes("a\0"));
    expect(splitter.finish()).toBeUndefined();
  });

  test("throws when the remainder exceeds the cap without a delimiter", () => {
    const splitter = new RecordSplitter({ maxRemainderBytes: 8 });
    splitter.push(bytes("1234"));
    expect(() => splitter.push(bytes("56789"))).toThrow(RemainderOverflowError);
  });

  test("supports a non-NUL delimiter for %x1f field framing", () => {
    const splitter = new RecordSplitter({ delimiter: 0x1f });
    const records = splitter.push(bytes("a\x1fb\x1fc")).map(text);
    expect(records).toEqual(["a", "b"]);
    expect(text(splitter.finish() ?? new Uint8Array())).toBe("c");
  });
});

describe("splitRecords", () => {
  test("streams records out of an async byte source, including the final undelimited tail", async () => {
    async function* source() {
      yield bytes("hel");
      yield bytes("lo\0wor");
      yield bytes("ld");
    }
    const records: string[] = [];
    for await (const record of splitRecords(source())) records.push(text(record));
    expect(records).toEqual(["hello", "world"]);
  });
});

describe("splitLimitedFields", () => {
  test("splits into exactly fieldCount pieces, last field absorbing extra delimiters", () => {
    const fields = splitLimitedFields(bytes("a\x1fb\x1fc\x1fd"), 0x1f, 3).map(text);
    expect(fields).toEqual(["a", "b", "c\x1fd"]);
  });

  test("pads nothing — fewer delimiters than fieldCount just yields fewer non-empty fields", () => {
    const fields = splitLimitedFields(bytes("only"), 0x1f, 3).map(text);
    expect(fields).toEqual(["only"]);
  });

  test("handles a delimiter as the very last byte", () => {
    const fields = splitLimitedFields(bytes("a\x1f"), 0x1f, 2).map(text);
    expect(fields).toEqual(["a", ""]);
  });
});
