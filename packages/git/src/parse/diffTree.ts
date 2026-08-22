/**
 * `git diff-tree` (§4.4): two separate invocations, deliberately not merged into one, because
 * they need different flags. `numstat` runs *without* `-M`/`-C` — a rename shows up as an
 * independent full delete of the old path plus a full add of the new one — so its line counts
 * are always for a single path. `name-status` runs *with* `-M -C` and is the sole source of
 * rename/copy linkage; combining the two into a single per-file change list is queries.ts's
 * job (W10), once both results exist.
 *
 * A rename/copy `name-status` record carries two NUL-separated paths in one logical entry —
 * the same non-uniform-framing hazard as status.ts's `2` record, and for the same reason:
 * `-z` turns every field terminator into NUL, not just the record terminator.
 */
import type { FileChangeKind } from "@kira-version/core";
import { assert } from "@kira-version/core";

function diffTreeArgs(mode: string[], from: string | undefined, to: string): string[] {
  const base = ["--no-optional-locks", "diff-tree", "-r", "--no-commit-id", ...mode, "-z"];
  return from === undefined ? [...base, "--root", to] : [...base, from, to];
}

export function numstatArgs(from: string | undefined, to: string): string[] {
  return diffTreeArgs(["--numstat"], from, to);
}

export function nameStatusArgs(from: string | undefined, to: string): string[] {
  return diffTreeArgs(["--name-status", "-M", "-C"], from, to);
}

export interface NumstatEntry {
  readonly path: string;
  readonly additions: number | undefined;
  readonly deletions: number | undefined;
  readonly isBinary: boolean;
}

export interface NameStatusEntry {
  readonly kind: FileChangeKind;
  readonly path: string;
  readonly originalPath: string | undefined;
  readonly similarity: number | undefined;
}

const decoder = new TextDecoder("utf-8", { fatal: false });

function splitTabLimited(text: string, count: number): string[] {
  const fields: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length && fields.length < count - 1; i++) {
    if (text[i] === "\t") {
      fields.push(text.slice(start, i));
      start = i + 1;
    }
  }
  fields.push(text.slice(start));
  return fields;
}

export function parseNumstatRecords(records: readonly Uint8Array[]): NumstatEntry[] {
  const entries: NumstatEntry[] = [];
  for (const record of records) {
    if (record.length === 0) continue;
    const [addRaw, delRaw, path] = splitTabLimited(decoder.decode(record), 3);
    const isBinary = addRaw === "-" || delRaw === "-";
    entries.push({
      path: path ?? "",
      additions: isBinary ? undefined : Number(addRaw ?? 0),
      deletions: isBinary ? undefined : Number(delRaw ?? 0),
      isBinary,
    });
  }
  return entries;
}

function classifyLetter(letter: string): FileChangeKind {
  switch (letter) {
    case "A":
      return "added";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "T":
      return "typeChanged";
    case "U":
      return "unmerged";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    default:
      assert(false, `unrecognised diff-tree --name-status letter: ${JSON.stringify(letter)}`);
  }
}

export function parseNameStatusRecords(records: readonly Uint8Array[]): NameStatusEntry[] {
  const entries: NameStatusEntry[] = [];
  let i = 0;
  while (i < records.length) {
    const record = records[i];
    if (record === undefined || record.length === 0) {
      i++;
      continue;
    }
    const statusToken = decoder.decode(record);
    const letter = statusToken[0] ?? "";
    if (letter === "R" || letter === "C") {
      const originalPathRecord = records[i + 1];
      const pathRecord = records[i + 2];
      assert(
        originalPathRecord !== undefined && pathRecord !== undefined,
        "diff-tree --name-status rename/copy record missing its path chunks",
      );
      entries.push({
        kind: classifyLetter(letter),
        originalPath: decoder.decode(originalPathRecord),
        path: decoder.decode(pathRecord),
        similarity: Number(statusToken.slice(1)),
      });
      i += 3;
    } else {
      const pathRecord = records[i + 1];
      assert(pathRecord !== undefined, "diff-tree --name-status record missing its path chunk");
      entries.push({
        kind: classifyLetter(letter),
        path: decoder.decode(pathRecord),
        originalPath: undefined,
        similarity: undefined,
      });
      i += 2;
    }
  }
  return entries;
}
