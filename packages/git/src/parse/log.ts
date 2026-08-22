/**
 * The §4.4 history walk: format string and parser together, so a field added to one is a
 * type error in the other rather than a silent runtime shift of every field after it.
 *
 * `--decorate=full` is one addition over the spec's literal invocation: it makes `%D` emit
 * fully-qualified refnames (`refs/heads/main` rather than `main`), which is the only way to
 * classify a decoration entry by prefix instead of guessing from ref-name shape — a local
 * branch and a remote-tracking branch can both legally contain a `/`.
 */
import type { CommitIdentity, CommitRecord, DecorationRef } from "@kira-version/core";
import { splitLimitedFields } from "@kira-version/core";

const FIELD_DELIMITER = 0x1f;
const FIELD_COUNT = 10;

/** `%H %P %an %ae %at %cn %ce %ct %D %s` — subject last, so a stray delimiter inside a commit
 *  message can only corrupt the subject, never a field before it. */
export const LOG_FORMAT = "%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ce%x1f%ct%x1f%D%x1f%s";

export interface LogArgsOptions {
  readonly scope: "all" | "head";
  readonly maxCount: number;
}

// `--no-optional-locks` is not included here: driver.ts (W7) adds it structurally to every
// read, so a caller of this args builder does not need to remember it too.
export function logArgs(opts: LogArgsOptions): string[] {
  const args = ["log", "--decorate=full", "--topo-order", "-z", `--format=${LOG_FORMAT}`];
  if (opts.scope === "all") args.push("--all", "--glob=refs/stash");
  args.push(`--max-count=${opts.maxCount}`);
  return args;
}

/** Same format, for a single commit (`git show -s`) — reused rather than duplicated. */
export function showMetadataArgs(sha: string): string[] {
  return ["show", "-s", "--decorate=full", "-z", `--format=${LOG_FORMAT}`, sha];
}

const decoder = new TextDecoder("utf-8", { fatal: false });

function stripPrefix(value: string, prefix: string): string | undefined {
  return value.startsWith(prefix) ? value.slice(prefix.length) : undefined;
}

function parseDecorationToken(token: string): DecorationRef {
  if (token === "HEAD") return { kind: "head" };
  if (token.startsWith("HEAD -> ")) {
    const rest = token.slice("HEAD -> ".length);
    return { kind: "branch", name: stripPrefix(rest, "refs/heads/") ?? rest, isHead: true };
  }
  if (token.startsWith("tag: ")) {
    const rest = token.slice("tag: ".length);
    return { kind: "tag", name: stripPrefix(rest, "refs/tags/") ?? rest };
  }
  const branch = stripPrefix(token, "refs/heads/");
  if (branch !== undefined) return { kind: "branch", name: branch, isHead: false };
  const remote = stripPrefix(token, "refs/remotes/");
  if (remote !== undefined) return { kind: "remoteBranch", name: remote };
  // An unrecognised decoration prefix (a custom refs/ namespace) — keep it rather than drop it.
  return { kind: "branch", name: token, isHead: false };
}

function parseDecoration(raw: string): DecorationRef[] {
  return raw.length === 0 ? [] : raw.split(", ").map(parseDecorationToken);
}

function parseIdentity(
  name: string | undefined,
  email: string | undefined,
  ts: string | undefined,
): CommitIdentity {
  return { name: name ?? "", email: email ?? "", timestamp: Number(ts ?? 0) };
}

export function parseLogRecord(record: Uint8Array): CommitRecord {
  const [sha, parentsRaw, an, ae, at, cn, ce, ct, decorationRaw, subject] = splitLimitedFields(
    record,
    FIELD_DELIMITER,
    FIELD_COUNT,
  ).map((field) => decoder.decode(field));

  return {
    sha: sha ?? "",
    parents: parentsRaw ? parentsRaw.split(" ").filter((p) => p.length > 0) : [],
    author: parseIdentity(an, ae, at),
    committer: parseIdentity(cn, ce, ct),
    subject: subject ?? "",
    decoration: parseDecoration(decorationRaw ?? ""),
  };
}
