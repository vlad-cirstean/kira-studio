/**
 * `git status --porcelain=v2 --branch -z` (§4.4): the five record kinds plus the `#` branch
 * header. The `2` (rename/copy) record is the hazard worth a dedicated test — it carries
 * *two* NUL-separated paths, so record framing here is not uniform: a `2` marker means the
 * parser must consume one extra NUL-delimited chunk beyond the current one.
 */
import type {
  FileStatusCode,
  IgnoredStatusEntry,
  OrdinaryStatusEntry,
  RenamedStatusEntry,
  StatusBranchInfo,
  StatusEntry,
  StatusResult,
  UnmergedEntry,
  UntrackedStatusEntry,
} from "@kira-version/core";
import { assert } from "@kira-version/core";

// `--no-optional-locks` is not included here: driver.ts (W7) adds it structurally to every
// read, so a caller of this args builder does not need to remember it too.
export function statusArgs(opts: { ignored?: boolean } = {}): string[] {
  const args = ["status", "--porcelain=v2", "--branch", "--untracked-files=normal", "-z"];
  if (opts.ignored) args.push("--ignored");
  return args;
}

const decoder = new TextDecoder("utf-8", { fatal: false });

/** Splits on ASCII space into at most `count` fields; the last field absorbs the rest (a
 *  path may itself contain spaces — porcelain v2's `-z` framing does not need to quote it). */
function splitSpaceLimited(text: string, count: number): string[] {
  const fields: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length && fields.length < count - 1; i++) {
    if (text[i] === " ") {
      fields.push(text.slice(start, i));
      start = i + 1;
    }
  }
  fields.push(text.slice(start));
  return fields;
}

function code(value: string | undefined): FileStatusCode {
  return (value as FileStatusCode | undefined) ?? ".";
}

function parseBranchHeader(lines: readonly string[]): StatusBranchInfo {
  let oid: string | undefined;
  let head: StatusBranchInfo["head"] = { kind: "detached" };
  let upstream: string | undefined;
  let ahead: number | undefined;
  let behind: number | undefined;

  for (const line of lines) {
    if (line.startsWith("branch.oid ")) {
      const value = line.slice("branch.oid ".length);
      oid = value === "(initial)" ? undefined : value;
    } else if (line.startsWith("branch.head ")) {
      const value = line.slice("branch.head ".length);
      head = value === "(detached)" ? { kind: "detached" } : { kind: "branch", name: value };
    } else if (line.startsWith("branch.upstream ")) {
      upstream = line.slice("branch.upstream ".length);
    } else if (line.startsWith("branch.ab ")) {
      const match = /^branch\.ab \+(\d+) -(\d+)$/.exec(line);
      if (match?.[1] !== undefined && match[2] !== undefined) {
        ahead = Number(match[1]);
        behind = Number(match[2]);
      }
    }
  }
  return { oid, head, upstream, ahead, behind };
}

function parseOrdinary(text: string): OrdinaryStatusEntry {
  const [xy, sub, headMode, indexMode, worktreeMode, headObjectId, indexObjectId, path] =
    splitSpaceLimited(text.slice(2), 8);
  return {
    kind: "ordinary",
    staged: code(xy?.[0]),
    unstaged: code(xy?.[1]),
    submodule: sub ?? "",
    headMode: headMode ?? "",
    indexMode: indexMode ?? "",
    worktreeMode: worktreeMode ?? "",
    headObjectId: headObjectId ?? "",
    indexObjectId: indexObjectId ?? "",
    path: path ?? "",
  };
}

function parseRenamed(text: string, originalPath: string): RenamedStatusEntry {
  const [
    xy,
    sub,
    headMode,
    indexMode,
    worktreeMode,
    headObjectId,
    indexObjectId,
    scoreToken,
    path,
  ] = splitSpaceLimited(text.slice(2), 9);
  const letter = scoreToken?.[0];
  return {
    kind: "renamed",
    renameOrCopy: letter === "C" ? "copy" : "rename",
    similarity: Number(scoreToken?.slice(1) ?? 0),
    staged: code(xy?.[0]),
    unstaged: code(xy?.[1]),
    submodule: sub ?? "",
    headMode: headMode ?? "",
    indexMode: indexMode ?? "",
    worktreeMode: worktreeMode ?? "",
    headObjectId: headObjectId ?? "",
    indexObjectId: indexObjectId ?? "",
    path: path ?? "",
    originalPath,
  };
}

function parseUnmerged(text: string): UnmergedEntry {
  const [xy, sub, m1, m2, m3, worktreeMode, h1, h2, h3, path] = splitSpaceLimited(
    text.slice(2),
    10,
  );
  return {
    kind: "unmerged",
    staged: code(xy?.[0]),
    unstaged: code(xy?.[1]),
    submodule: sub ?? "",
    base: { mode: m1 ?? "", objectId: h1 ?? "" },
    ours: { mode: m2 ?? "", objectId: h2 ?? "" },
    theirs: { mode: m3 ?? "", objectId: h3 ?? "" },
    worktreeMode: worktreeMode ?? "",
    path: path ?? "",
  };
}

/**
 * `records` is the full sequence of NUL-delimited chunks from one `status -z` invocation.
 * Synchronous and not streaming — status output is bounded by the size of the working tree,
 * not the history, so there is no reason to pay streaming's complexity here (unlike `log`).
 */
export function parseStatus(records: readonly Uint8Array[]): StatusResult {
  const headerLines: string[] = [];
  const entries: StatusEntry[] = [];

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (record === undefined || record.length === 0) continue;
    const text = decoder.decode(record);
    const marker = text[0];

    switch (marker) {
      case "#":
        headerLines.push(text.slice(2));
        break;
      case "1":
        entries.push(parseOrdinary(text));
        break;
      case "2": {
        const nextRecord = records[++i];
        assert(
          nextRecord !== undefined,
          "status '2' (rename/copy) record missing its origPath chunk",
        );
        entries.push(parseRenamed(text, decoder.decode(nextRecord)));
        break;
      }
      case "u":
        entries.push(parseUnmerged(text));
        break;
      case "?":
        entries.push({ kind: "untracked", path: text.slice(2) } satisfies UntrackedStatusEntry);
        break;
      case "!":
        entries.push({ kind: "ignored", path: text.slice(2) } satisfies IgnoredStatusEntry);
        break;
      default:
        assert(
          false,
          `unrecognised status --porcelain=v2 record marker: ${JSON.stringify(marker)}`,
        );
    }
  }

  return { branch: parseBranchHeader(headerLines), entries };
}
