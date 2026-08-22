/**
 * `for-each-ref` (§4.4): heads, remote-tracking branches and tags are one record type
 * discriminated on the refname prefix, since that is how `for-each-ref` returns them.
 *
 * Unlike every other §4.4 query, `for-each-ref` has no `-z` mode — records are LF-terminated,
 * fields are `%1f`-separated. None of its fields can legally contain a raw LF (ref names and
 * hex object ids cannot), so line framing is safe here without the NUL-splitting machinery.
 */
import type { RefKind, RefRecord, RefTrack } from "@kira-version/core";
import { splitLimitedFields } from "@kira-version/core";

const FIELD_DELIMITER = 0x1f;
const FIELD_COUNT = 8;

/** for-each-ref has no `-z`; records are separated by this byte instead. */
export const REFS_RECORD_DELIMITER = 0x0a;

export const REFS_FORMAT =
  "%(refname)%1f%(objectname)%1f%(objecttype)%1f%(upstream)%1f%(upstream:track)%1f" +
  "%(committerdate:unix)%1f%(HEAD)%1f%(*objectname)";

// `--no-optional-locks` is not included here: driver.ts (W7) adds it structurally to every
// read, so a caller of this args builder does not need to remember it too.
export function refsArgs(): string[] {
  return ["for-each-ref", `--format=${REFS_FORMAT}`, "refs/heads", "refs/remotes", "refs/tags"];
}

const decoder = new TextDecoder("utf-8", { fatal: false });

function classify(refname: string): { kind: RefKind; shortName: string } {
  if (refname.startsWith("refs/heads/")) {
    return { kind: "branch", shortName: refname.slice("refs/heads/".length) };
  }
  if (refname.startsWith("refs/remotes/")) {
    return { kind: "remoteBranch", shortName: refname.slice("refs/remotes/".length) };
  }
  return { kind: "tag", shortName: refname.replace(/^refs\/tags\//, "") };
}

function parseTrack(raw: string): RefTrack | "gone" | undefined {
  if (raw.length === 0) return undefined;
  if (raw === "[gone]") return "gone";
  const aheadMatch = /ahead (\d+)/.exec(raw);
  const behindMatch = /behind (\d+)/.exec(raw);
  return {
    ahead: aheadMatch?.[1] ? Number(aheadMatch[1]) : 0,
    behind: behindMatch?.[1] ? Number(behindMatch[1]) : 0,
  };
}

export function parseRefRecord(record: Uint8Array): RefRecord {
  const [refname, objectId, objectType, upstream, track, committerDate, headMarker, peeled] =
    splitLimitedFields(record, FIELD_DELIMITER, FIELD_COUNT).map((field) => decoder.decode(field));

  const { kind, shortName } = classify(refname ?? "");
  return {
    refname: refname ?? "",
    kind,
    shortName,
    objectId: objectId ?? "",
    objectType: (objectType as RefRecord["objectType"] | undefined) ?? "commit",
    peeledObjectId: peeled && peeled.length > 0 ? peeled : undefined,
    upstream: upstream && upstream.length > 0 ? upstream : undefined,
    track: parseTrack(track ?? ""),
    committerDate: Number(committerDate ?? 0),
    isHead: headMarker === "*",
  };
}
