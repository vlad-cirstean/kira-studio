/**
 * The type map every transport (real or mock) and the UI client are checked against.
 * P0 seeded four entries "enough to exercise all three mechanisms"; P3 grows this into the
 * surface §3.5 describes, restricted to what P3 or an immediately following phase calls —
 * every entry here has a producer and a consumer in P3 (`docs/plans/P3.md`, W1).
 *
 * `core` and `ipc` both depend on nothing (§3.1), so the wire shapes below are *structural
 * copies* of the corresponding `@kira-version/core` types, not imports of them — `ipc` may
 * not import `@kira-version/core` (B3). Drift between the two sides is caught by
 * `tests/unit/ipc/wireConformance.test.ts`, which asserts assignability in both directions,
 * not by an import the lint rule would reject anyway.
 */

/** Which shell mounted the UI bundle. `"harness"` is a real value, not a test-only stand-in —
 *  the harness is a first-class Transport consumer (§8.4, C4). */
export type HostKind = "vscode" | "harness";

// ---------------------------------------------------------------------------------------
// Structural copies of core's wire-relevant types — kept honest by wireConformance.test.ts.
// ---------------------------------------------------------------------------------------

export type HeadState =
  | { readonly kind: "branch"; readonly name: string }
  | { readonly kind: "detached"; readonly sha: string }
  | { readonly kind: "unborn"; readonly name: string };

export type DecorationRef =
  | { readonly kind: "branch"; readonly name: string; readonly isHead: boolean }
  | { readonly kind: "remoteBranch"; readonly name: string }
  | { readonly kind: "tag"; readonly name: string }
  | { readonly kind: "head" }
  | { readonly kind: "stash" };

/** The settings schema's keys and value types (D25, W4) — a structural copy of `core`'s
 *  generated `Settings` type, kept in step by wireConformance.test.ts. */
export interface SettingsSnapshot {
  readonly "kiraVersion.git.path": string;
  readonly "kiraVersion.graph.pageSize": number;
  readonly "kiraVersion.graph.scope": "all" | "head";
  readonly "kiraVersion.log.level": "off" | "error" | "warn" | "info" | "debug";
}

export interface RepoSummary {
  readonly repoId: string;
  readonly root: string;
  readonly gitDir: string;
  readonly commonDir: string;
  readonly isBare: boolean;
  readonly isLinkedWorktree: boolean;
  readonly head: HeadState;
}

export interface RepoCandidate {
  readonly path: string;
  readonly label: string;
}

/**
 * W3's wire shape for a slice of `CommitStore` rows — the packed, transferable representation
 * `CommitStore.packSlice`/`appendPacked` (`packages/core/src/store/commitStore.ts`) produce and
 * consume. Declared here (structurally, not imported) because it is the payload of
 * `GraphChunk.commits` below; `wireConformance.test.ts` is what keeps the two in step.
 */
export interface PackedCommitChunk {
  readonly from: number;
  readonly to: number;
  readonly shaWidthBytes: number;
  /** `(to - from) * shaWidthBytes` bytes, binary (§5.5). */
  readonly shas: ArrayBuffer;
  /** `Uint32Array`, `(to - from) + 1` entries, chunk-relative CSR offsets. */
  readonly parentOffsets: ArrayBuffer;
  /** Binary shas in CSR order — parents travel as shas, not row indices (W3). */
  readonly parentShas: ArrayBuffer;
  /** `Uint32Array`, 4 per row (authorName, authorEmail, committerName, committerEmail), into
   *  `dictionary`. */
  readonly identityIds: ArrayBuffer;
  /** `Uint32Array`, 2 per row (authorTime, committerTime). */
  readonly times: ArrayBuffer;
  readonly subjectBytes: ArrayBuffer;
  readonly subjectOffsets: ArrayBuffer;
  /** The first dictionary id this chunk's `dictionary` array defines — the receiver's interner
   *  must be at exactly this size, or the chunk is out of order (W3). */
  readonly dictionaryBase: number;
  /** Only the strings interned since `dictionaryBase` — a delta, not the whole dictionary. */
  readonly dictionary: readonly string[];
  readonly decorations: readonly (readonly [row: number, refs: readonly DecorationRef[]])[];
}

// ---------------------------------------------------------------------------------------
// Discriminated unions the UI renders explicitly rather than infers.
// ---------------------------------------------------------------------------------------

export type GitStatus =
  | { readonly kind: "ok"; readonly path: string; readonly version: string }
  | { readonly kind: "notFound"; readonly probed: readonly string[] }
  | {
      readonly kind: "tooOld";
      readonly path: string;
      readonly detected: string;
      readonly required: string;
      readonly settingId: string;
    }
  | { readonly kind: "unusable"; readonly path: string; readonly reason: string };

export type RepoOpenResult =
  | { readonly kind: "ok"; readonly repo: RepoSummary }
  | { readonly kind: "notARepository"; readonly path: string }
  | { readonly kind: "gitUnavailable"; readonly git: GitStatus };

// ---------------------------------------------------------------------------------------
// The contract.
// ---------------------------------------------------------------------------------------

export type Contract = {
  requests: {
    "app.init": {
      params: Record<string, never>;
      result: {
        host: HostKind;
        contractVersion: number;
        settings: SettingsSnapshot;
        git: GitStatus;
      };
    };
    "repo.list": {
      params: Record<string, never>;
      result: { candidates: readonly RepoCandidate[]; activeRepoId: string | null };
    };
    "repo.pick": {
      params: Record<string, never>;
      result: { path: string | null };
    };
    "repo.open": {
      params: { path: string };
      result: RepoOpenResult;
    };
    "repo.close": {
      params: { repoId: string };
      result: Record<string, never>;
    };
    "graph.status": {
      params: { repoId: string };
      result: { loaded: number; remaining: number; exhausted: boolean };
    };
    "graph.loadMore": {
      params: { repoId: string; pages?: number };
      result: { started: boolean };
    };
    "graph.refresh": {
      params: { repoId: string };
      result: { restarted: boolean };
    };
  };
  events: {
    "repo.changed": { repoId: string; kind: "refsChanged" | "worktreeChanged" };
    "settings.changed": { settings: SettingsSnapshot };
  };
  streams: {
    "graph.stream": {
      params: { repoId: string; resumeThroughRow?: number };
      chunk: {
        readonly repoId: string;
        readonly seq: number;
        /** Absolute row indices, not chunk-relative. */
        readonly from: number;
        readonly to: number;
        /** §5.4 made observable; W9 renders it, P4 keeps it. */
        readonly source: "git" | "cache";
        readonly remaining: number;
        readonly exhausted: boolean;
        readonly commits: PackedCommitChunk;
      };
    };
  };
};

export type RequestKey = keyof Contract["requests"];
export type EventKey = keyof Contract["events"];
export type StreamKey = keyof Contract["streams"];

export type ParamsOf<K extends RequestKey> = Contract["requests"][K]["params"];
export type ResultOf<K extends RequestKey> = Contract["requests"][K]["result"];
export type EventPayload<K extends EventKey> = Contract["events"][K];
export type StreamParamsOf<K extends StreamKey> = Contract["streams"][K]["params"];
export type StreamChunkOf<K extends StreamKey> = Contract["streams"][K]["chunk"];
