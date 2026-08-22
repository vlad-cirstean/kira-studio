/**
 * `git stash list` (§4.4), reusing `git log`'s `-z`/`%x1f` machinery — a stash entry is a
 * commit, so the same NUL/field framing applies. `%P`'s first token is the commit the stash
 * was taken on top of; a `-u` stash has a third parent (the untracked-files tree) that this
 * model does not need to expose.
 */
import type { StashEntry } from "@kira-version/core";
import { splitLimitedFields } from "@kira-version/core";

const FIELD_DELIMITER = 0x1f;
const FIELD_COUNT = 5;

/** Message last, same reasoning as `log.ts`'s subject-last format: it is the one field that
 *  can contain arbitrary bytes, so nothing after it can be corrupted by a stray delimiter. */
export const STASH_FORMAT = "%H%x1f%P%x1f%gd%x1f%at%x1f%s";

// `--no-optional-locks` is not included here: driver.ts (W7) adds it structurally to every
// read, so a caller of this args builder does not need to remember it too.
export function stashListArgs(): string[] {
  return ["stash", "list", "-z", `--format=${STASH_FORMAT}`];
}

const decoder = new TextDecoder("utf-8", { fatal: false });

const STASH_INDEX = /^stash@\{(\d+)\}$/;

export function parseStashRecord(record: Uint8Array): StashEntry {
  const [sha, parentsRaw, ref, timestamp, message] = splitLimitedFields(
    record,
    FIELD_DELIMITER,
    FIELD_COUNT,
  ).map((field) => decoder.decode(field));
  const baseSha = parentsRaw?.split(" ").find((p) => p.length > 0) ?? "";
  const indexMatch = STASH_INDEX.exec(ref ?? "");

  return {
    index: indexMatch?.[1] ? Number(indexMatch[1]) : 0,
    sha: sha ?? "",
    baseSha,
    message: message ?? "",
    timestamp: Number(timestamp ?? 0),
  };
}
