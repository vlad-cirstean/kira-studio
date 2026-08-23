/**
 * §3.2's host-side object — the first thing in this project to compose P1's driver and P2's
 * paged log session into something with a lifetime. One `RepoService` per host process; one
 * `RepoSession` per open repo, holding exactly what §5.4 says the host holds: the `CommitStore`,
 * the `LogSession`, the `RepoWatcher`, the `GitDriver` (which itself owns the `CatFileSession`),
 * a `dictionaryCursor` for W3's delta, and a `staleReason`.
 *
 * `GitStatus`/`RepoOpenOutcome`/`GraphChunkPayload` below are structural copies of what
 * `packages/ipc`'s contract will eventually declare — this package cannot import `@kira-version/ipc`
 * until W8 binds this service to it, per §3.1's dependency rule (`git` may depend on `core` and
 * `ipc`, but nothing here needed `ipc` until now).
 */
import type {
  CommitStore,
  Disposable,
  FileWatcher,
  Logger,
  PackedCommitChunk,
  ProcessRunner,
  RepoIdentity,
  Settings,
} from "@kira-version/core";
import { CommitStore as CommitStoreImpl } from "@kira-version/core";
import { openCatFileSession } from "./catFile.ts";
import type { GitResolution, GitVersion, ResolvedGit } from "./discovery.ts";
import { locateGit, resolveRepoIdentity } from "./discovery.ts";
import type { GitDriver } from "./driver.ts";
import { openGitDriver } from "./driver.ts";
import type { LogSession } from "./logSession.ts";
import { openLogSession } from "./logSession.ts";
import type { RepoWatcher, WatchSignal } from "./watcher.ts";
import { watchRepo } from "./watcher.ts";

// ---------------------------------------------------------------------------------------
// Local wire-shaped types (see the module doc comment for why these live here, not in ipc).
// ---------------------------------------------------------------------------------------

export type GitStatus =
  | { readonly kind: "ok"; readonly path: string; readonly version: string }
  | { readonly kind: "notFound"; readonly probed: readonly string[] }
  | {
      readonly kind: "tooOld";
      readonly path: string;
      readonly detected: string;
      readonly required: string;
    }
  | { readonly kind: "unusable"; readonly path: string; readonly reason: string };

export type RepoOpenOutcome =
  | { readonly kind: "ok"; readonly repoId: string; readonly identity: RepoIdentity }
  | { readonly kind: "notARepository"; readonly path: string }
  | { readonly kind: "gitUnavailable"; readonly git: GitStatus };

export interface GraphChunkPayload {
  readonly repoId: string;
  readonly seq: number;
  readonly from: number;
  readonly to: number;
  readonly source: "git" | "cache";
  readonly remaining: number;
  readonly exhausted: boolean;
  readonly commits: PackedCommitChunk;
}

function versionString(version: GitVersion): string {
  return version.raw;
}

function toGitStatus(resolution: GitResolution): GitStatus {
  switch (resolution.kind) {
    case "ok":
      return {
        kind: "ok",
        path: resolution.git.path,
        version: versionString(resolution.git.version),
      };
    case "notFound":
      return { kind: "notFound", probed: resolution.probed };
    case "tooOld":
      return {
        kind: "tooOld",
        path: resolution.path,
        detected: versionString(resolution.detected),
        required: versionString(resolution.required),
      };
    case "unusable":
      return { kind: "unusable", path: resolution.path, reason: resolution.reason };
  }
}

// ---------------------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------------------

export interface RepoServiceDeps {
  readonly runner: ProcessRunner;
  readonly fileWatcher: FileWatcher;
  readonly logger: Logger;
  readonly settings: Settings;
  readonly configuredGitCandidates: readonly string[];
}

/** How many rows one `streamGraph` chunk carries, whether replayed from cache or freshly read
 *  from git — §5.1's "first commits painted" budget, not §5.1.1's page size. Exported so a test
 *  building a small generated repo can assert chunk boundaries without hard-coding 500. */
export const CHUNK_ROWS = 500;

/** §5.4/§5.5: how long a hidden repo's state survives before `setUiVisible(false)` evicts it.
 *  An exported named constant, not a literal in a closure — deliberately not a setting; see this
 *  file's `#evict` for what eviction actually discards. */
export const HIDDEN_EVICT_MS = 5 * 60 * 1000;

interface RepoServiceOptions {
  /** Testability hook for `HIDDEN_EVICT_MS` — the plan's given `RepoServiceDeps` has no other
   *  way to exercise real eviction timing without a 5-minute test. Additive, defaults to the
   *  real constant. */
  readonly evictMs?: number;
}

interface RepoSession {
  readonly repoId: string;
  readonly identity: RepoIdentity;
  readonly driver: GitDriver;
  logSession: LogSession;
  readonly store: CommitStore;
  readonly watcher: RepoWatcher;
  dictionaryCursor: number;
  staleReason: "refsChanged" | undefined;
  lastRemaining: number;
  nextSeq: number;
  evictTimer: ReturnType<typeof setTimeout> | undefined;
  readonly subscriptions: Disposable[];
}

export class RepoService {
  readonly #deps: RepoServiceDeps;
  readonly #resolution: GitResolution;
  readonly #evictMs: number;
  readonly #logger: Logger;
  readonly #sessions = new Map<string, RepoSession>();
  readonly #changeListeners = new Set<
    (e: { repoId: string; kind: "refsChanged" | "worktreeChanged" }) => void
  >();

  readonly git: GitStatus;

  private constructor(deps: RepoServiceDeps, resolution: GitResolution, evictMs: number) {
    this.#deps = deps;
    this.#resolution = resolution;
    this.#evictMs = evictMs;
    this.#logger = deps.logger.child("repoService");
    this.git = toGitStatus(resolution);
  }

  static async create(deps: RepoServiceDeps, opts: RepoServiceOptions = {}): Promise<RepoService> {
    const resolution = await locateGit({
      runner: deps.runner,
      configuredCandidates: deps.configuredGitCandidates,
    });
    return new RepoService(deps, resolution, opts.evictMs ?? HIDDEN_EVICT_MS);
  }

  #git(): ResolvedGit {
    if (this.#resolution.kind !== "ok") {
      throw new Error("RepoService: git is unavailable — check `.git` before calling this");
    }
    return this.#resolution.git;
  }

  async open(path: string): Promise<RepoOpenOutcome> {
    if (this.#resolution.kind !== "ok") return { kind: "gitUnavailable", git: this.git };

    const resolved = await resolveRepoIdentity(this.#resolution.git, this.#deps.runner, path);
    if (resolved.kind !== "ok") return { kind: "notARepository", path };

    const identity = resolved.identity;
    const repoId = identity.root;
    const existing = this.#sessions.get(repoId);
    if (existing) return { kind: "ok", repoId, identity: existing.identity };

    const session = this.#openSession(identity);
    this.#sessions.set(repoId, session);
    this.#logger.log("debug", "opened repo", { repoId, root: identity.root });
    return { kind: "ok", repoId, identity };
  }

  close(repoId: string): void {
    const session = this.#sessions.get(repoId);
    if (!session) return;
    this.#sessions.delete(repoId);
    this.#clearEvictTimer(session);
    for (const subscription of session.subscriptions) subscription.dispose();
    session.watcher.dispose();
    session.logSession.dispose();
    session.driver.dispose();
  }

  status(repoId: string): { loaded: number; remaining: number; exhausted: boolean } {
    const session = this.#requireSession(repoId);
    return {
      loaded: session.store.rowCount,
      remaining: session.lastRemaining,
      exhausted: session.logSession.exhausted,
    };
  }

  async streamGraph(
    repoId: string,
    opts: {
      resumeThroughRow?: number;
      onChunk: (chunk: GraphChunkPayload) => Promise<void>;
      signal?: AbortSignal;
    },
  ): Promise<void> {
    const session = this.#requireSession(repoId);
    await this.#ensureFresh(session);

    // Clamped, not trusted verbatim: a caller-supplied `resumeThroughRow` from before a stale
    // reset would otherwise point past the (now empty) store.
    let cursor = Math.min(opts.resumeThroughRow ?? 0, session.store.rowCount);
    const cachedThrough = session.store.rowCount;

    while (cursor < cachedThrough) {
      if (opts.signal?.aborted) return;
      const to = Math.min(cursor + CHUNK_ROWS, cachedThrough);
      await this.#emitRange(session, cursor, to, "cache", opts.onChunk);
      cursor = to;
    }
    if (opts.signal?.aborted) return;

    // A page is fetched from git here only on the very first stream for this repo — nothing is
    // cached yet at all. Every later page comes from an explicit `loadMore()` (§5.1.1: "the
    // host never loads a page the user did not ask for"), which is also what keeps a resumed
    // stream — a hide/reveal replaying the cache above — spawn-free.
    if (cachedThrough === 0 && !session.logSession.exhausted) {
      await this.#readPageIntoStore(session);
    }

    while (cursor < session.store.rowCount) {
      if (opts.signal?.aborted) return;
      const to = Math.min(cursor + CHUNK_ROWS, session.store.rowCount);
      await this.#emitRange(session, cursor, to, "git", opts.onChunk);
      cursor = to;
    }
  }

  async loadMore(repoId: string, pages = 1): Promise<void> {
    const session = this.#requireSession(repoId);
    await this.#ensureFresh(session);
    for (let i = 0; i < pages && !session.logSession.exhausted; i++) {
      await this.#readPageIntoStore(session);
    }
  }

  onChanged(
    fn: (e: { repoId: string; kind: "refsChanged" | "worktreeChanged" }) => void,
  ): Disposable {
    this.#changeListeners.add(fn);
    return { dispose: () => this.#changeListeners.delete(fn) };
  }

  setUiVisible(visible: boolean): void {
    for (const session of this.#sessions.values()) {
      if (visible) {
        this.#clearEvictTimer(session);
        session.watcher.resume();
      } else {
        session.watcher.pause();
        this.#armEvictTimer(session);
      }
    }
  }

  dispose(): void {
    for (const repoId of [...this.#sessions.keys()]) this.close(repoId);
  }

  // ---------------------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------------------

  #openSession(identity: RepoIdentity): RepoSession {
    const git = this.#git();
    const catFile = openCatFileSession(git, this.#deps.runner, identity.root);
    const driver = openGitDriver(git, this.#deps.runner, identity.root, catFile);
    const watcher = watchRepo(this.#deps.fileWatcher, identity);

    const session: RepoSession = {
      repoId: identity.root,
      identity,
      driver,
      logSession: this.#openLogSession(identity),
      store: new CommitStoreImpl(),
      watcher,
      dictionaryCursor: 0,
      staleReason: undefined,
      lastRemaining: 0,
      nextSeq: 0,
      evictTimer: undefined,
      subscriptions: [],
    };

    session.subscriptions.push(watcher.onSignal((signal) => this.#handleSignal(session, signal)));
    // §4.3: a completed write bumps `generation` and invalidates the graph cache the same way a
    // refs-changed filesystem event does — both funnel through the one handler.
    session.subscriptions.push(
      driver.onInvalidated(() => this.#handleSignal(session, "refsChanged")),
    );

    return session;
  }

  #openLogSession(identity: RepoIdentity): LogSession {
    return openLogSession(this.#git(), this.#deps.runner, identity.root, {
      scope: this.#deps.settings["kiraVersion.graph.scope"],
      pageSize: this.#deps.settings["kiraVersion.graph.pageSize"],
    });
  }

  #requireSession(repoId: string): RepoSession {
    const session = this.#sessions.get(repoId);
    if (!session) throw new Error(`RepoService: no open repo '${repoId}'`);
    return session;
  }

  #handleSignal(session: RepoSession, kind: WatchSignal): void {
    if (kind === "refsChanged") session.staleReason = "refsChanged";
    for (const listener of this.#changeListeners) listener({ repoId: session.repoId, kind });
  }

  /** Drops the store and swaps in a fresh `LogSession` when `session.staleReason` is set — the
   *  §5.4 recovery for both a watcher-observed `refsChanged` and a `logSession.readPage` "stale"
   *  outcome (see `#readPageIntoStore`). A no-op when nothing is stale. */
  async #ensureFresh(session: RepoSession): Promise<void> {
    if (!session.staleReason) return;
    session.staleReason = undefined;
    this.#resetSession(session);
  }

  #resetSession(session: RepoSession): void {
    session.store.clear();
    session.dictionaryCursor = 0;
    session.lastRemaining = 0;
    session.logSession.dispose();
    session.logSession = this.#openLogSession(session.identity);
  }

  async #readPageIntoStore(session: RepoSession): Promise<void> {
    const outcome = await session.logSession.readPage((record) => session.store.append(record));
    if (outcome.kind === "stale") {
      // P2's spliced-page guard: refs moved while this session was paused. Reset exactly as a
      // watcher-observed refsChanged would, then retry once against the now-current refs — the
      // caller sees the resulting rows as part of the same page read, starting over at row 0.
      this.#handleSignal(session, "refsChanged");
      await this.#ensureFresh(session);
      await session.logSession.readPage((record) => session.store.append(record));
    }
    // `loadMore()` calls this without ever emitting a chunk (#emitRange is the only other
    // place `lastRemaining` gets refreshed) — status() would otherwise report a remaining
    // count frozen at whatever it was the last time this repo was actually streamed.
    session.lastRemaining = await session.logSession.remaining();
  }

  async #emitRange(
    session: RepoSession,
    from: number,
    to: number,
    source: "git" | "cache",
    onChunk: (chunk: GraphChunkPayload) => Promise<void>,
  ): Promise<void> {
    const commits = session.store.packSlice(from, to, session.dictionaryCursor);
    session.dictionaryCursor += commits.dictionary.length;
    // Cached internally by `LogSession` after its first call ("run once per refresh") — this
    // does not spawn a process on every chunk, or on a cache-only replay after the first stream.
    const remaining = await session.logSession.remaining();
    session.lastRemaining = remaining;
    await onChunk({
      repoId: session.repoId,
      seq: session.nextSeq++,
      from,
      to,
      source,
      remaining,
      exhausted: session.logSession.exhausted,
      commits,
    });
  }

  #armEvictTimer(session: RepoSession): void {
    this.#clearEvictTimer(session);
    session.evictTimer = setTimeout(() => this.#evict(session), this.#evictMs);
  }

  #clearEvictTimer(session: RepoSession): void {
    if (session.evictTimer !== undefined) {
      clearTimeout(session.evictTimer);
      session.evictTimer = undefined;
    }
  }

  #evict(session: RepoSession): void {
    session.evictTimer = undefined;
    this.#resetSession(session);
    session.watcher.pause();
    this.#logger.log("debug", "evicted hidden repo", { repoId: session.repoId });
  }
}
