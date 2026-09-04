/**
 * The type map every transport (real or mock) and the UI client are checked against.
 *
 * This is the seam that makes Git mode host-agnostic: the contract is declared once, here, and a
 * host supplies a `Transport` (`transport.ts`) rather than a protocol of its own. In this
 * repository that host is Wails — a bound `bridge.GitService` behind generated TS bindings — where
 * in the source project it was a VS Code webview's `postMessage`. Neither is visible from this
 * file, which is the point.
 *
 * `git-core` and `git-ipc` both depend on nothing, so the wire shapes below are *structural
 * copies* of the corresponding `@kira/git-core` types, not imports of them. Drift between the two
 * sides is caught by an assignability test in both directions, not by an import the dependency
 * rule would reject anyway.
 *
 * The entry set below is what the source project's own host bridge phase settled on. Later phases
 * (`docs/v1.3/SPEC.md`) grow it — commit detail, refs, status, search, the operations and their
 * pre-flights — each entry arriving with a producer and a consumer rather than speculatively.
 */

/** Which shell mounted the UI bundle. `"harness"` is a real value, not a test-only stand-in —
 *  the mock-bridge harness is a first-class Transport consumer, and is what proves this package's
 *  whole reason for existing. */
export type HostKind = 'kira-studio' | 'harness';

// ---------------------------------------------------------------------------------------
// Structural copies of core's wire-relevant types — kept honest by wireConformance.test.ts.
// ---------------------------------------------------------------------------------------

export type HeadState =
  | { readonly kind: 'branch'; readonly name: string }
  | { readonly kind: 'detached'; readonly sha: string }
  | { readonly kind: 'unborn'; readonly name: string };

export type DecorationRef =
  | { readonly kind: 'branch'; readonly name: string; readonly isHead: boolean }
  | { readonly kind: 'remoteBranch'; readonly name: string }
  | { readonly kind: 'tag'; readonly name: string }
  | { readonly kind: 'head' }
  | { readonly kind: 'stash' };

/** The settings schema's keys and value types — a structural copy of `git-core`'s generated
 *  `Settings` type, kept in step by the wire-conformance assertion. */
export interface SettingsSnapshot {
  readonly 'git.path': string;
  readonly 'git.graph.pageSize': number;
  readonly 'git.graph.scope': 'all' | 'head';
  readonly 'git.log.level': 'off' | 'error' | 'warn' | 'info' | 'debug';
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
 * The wire shape for a slice of `CommitStore` rows — the packed, transferable representation
 * `CommitStore.packSlice`/`appendPacked` (`packages/git-core/src/store/commitStore.ts`) produce
 * and consume. Declared here (structurally, not imported) because it is the payload of the graph
 * stream's chunk below; `tests/wireConformance.test.ts` is what keeps the two in step.
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
  | { readonly kind: 'ok'; readonly path: string; readonly version: string }
  | { readonly kind: 'notFound'; readonly probed: readonly string[] }
  | {
      readonly kind: 'tooOld';
      readonly path: string;
      readonly detected: string;
      readonly required: string;
      readonly settingId: string;
    }
  | { readonly kind: 'unusable'; readonly path: string; readonly reason: string };

export type RepoOpenResult =
  | { readonly kind: 'ok'; readonly repo: RepoSummary }
  | { readonly kind: 'notARepository'; readonly path: string }
  | { readonly kind: 'gitUnavailable'; readonly git: GitStatus };

// ---------------------------------------------------------------------------------------
// The contract.
// ---------------------------------------------------------------------------------------

export type Contract = {
  requests: {
    'app.init': {
      params: Record<string, never>;
      result: {
        host: HostKind;
        contractVersion: number;
        settings: SettingsSnapshot;
        git: GitStatus;
      };
    };
    'repo.list': {
      params: Record<string, never>;
      result: { candidates: readonly RepoCandidate[]; activeRepoId: string | null };
    };
    'repo.pick': {
      params: Record<string, never>;
      result: { path: string | null };
    };
    'repo.open': {
      params: { path: string };
      result: RepoOpenResult;
    };
    'repo.close': {
      params: { repoId: string };
      result: Record<string, never>;
    };
    'graph.status': {
      params: { repoId: string };
      result: { loaded: number; remaining: number; exhausted: boolean };
    };
    'graph.loadMore': {
      params: { repoId: string; pages?: number };
      result: { started: boolean };
    };
    'graph.refresh': {
      params: { repoId: string };
      result: { restarted: boolean };
    };
  };
  events: {
    'repo.changed': { repoId: string; kind: 'refsChanged' | 'worktreeChanged' };
    'settings.changed': { settings: SettingsSnapshot };
  };
  streams: {
    'graph.stream': {
      params: { repoId: string; resumeThroughRow?: number };
      chunk: {
        readonly repoId: string;
        readonly seq: number;
        /** Absolute row indices, not chunk-relative. */
        readonly from: number;
        readonly to: number;
        /** Whether this chunk came from a live walk or from the host's per-repo cache — the
         *  caching behaviour made observable, so the UI can show it rather than infer it. */
        readonly source: 'git' | 'cache';
        readonly remaining: number;
        readonly exhausted: boolean;
        readonly commits: PackedCommitChunk;
      };
    };
  };
};

export type RequestKey = keyof Contract['requests'];
export type EventKey = keyof Contract['events'];
export type StreamKey = keyof Contract['streams'];

export type ParamsOf<K extends RequestKey> = Contract['requests'][K]['params'];
export type ResultOf<K extends RequestKey> = Contract['requests'][K]['result'];
export type EventPayload<K extends EventKey> = Contract['events'][K];
export type StreamParamsOf<K extends StreamKey> = Contract['streams'][K]['params'];
export type StreamChunkOf<K extends StreamKey> = Contract['streams'][K]['chunk'];
