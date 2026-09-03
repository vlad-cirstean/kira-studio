import { CommitStore, defaultSettings } from "@kira-version/core";
import type {
  MessageChannelLike,
  RequestHandler,
  ServerHandlers,
  SettingsSnapshot,
  StreamChunkOf,
  StreamHandler,
  Transport,
} from "@kira-version/ipc";
import { CONTRACT_VERSION, createRpcClient, createRpcServer } from "@kira-version/ipc";
import { loadScenario } from "./scenarios/index.ts";
import type { Scenario } from "./scenarios/types.ts";

/**
 * Wires a real `createRpcServer`/`createRpcClient` pair over an in-memory channel to a
 * hand-written `ServerHandlers` (P3 W14) — not `@kira-version/git`'s `createRepoHandlers`,
 * which `biome.json`'s `noRestrictedImports` override forbids `apps/harness/**` from
 * importing (grouped with `packages/ui`'s own "core + ipc only" restriction, B3, §3.1). The
 * handlers below are this file's own translation from a `Scenario`'s fixture data to the same
 * wire shapes `packages/git/src/rpcHandlers.ts` produces, mirroring `RepoService.streamGraph`'s
 * cache-then-fresh-page split conceptually rather than by shared code — there is a real repo
 * fixture (`Scenario.commits`) but no real git process behind it.
 */

/** How many rows one `graph.stream` chunk carries, whether replayed from the mock's own
 *  `CommitStore` (`source: "cache"`) or newly "read" out of `Scenario.commits`
 *  (`source: "git"`) — the same constant `RepoService.CHUNK_ROWS` uses, kept independent since
 *  the harness may not import `@kira-version/git`. */
const CHUNK_ROWS = 500;

/** How many commits one simulated "page" adds — `defaultSettings()`'s own
 *  `kiraVersion.graph.pageSize`, so `hugeRepo`'s `graph.loadMore` genuinely needs more than one
 *  call to reach exhaustion, matching what a real host would do with the same setting. */
const PAGE_SIZE = defaultSettings()["kiraVersion.graph.pageSize"];

function toSettingsSnapshot(): SettingsSnapshot {
  const settings = defaultSettings();
  return {
    "kiraVersion.git.path": settings["kiraVersion.git.path"],
    "kiraVersion.graph.pageSize": settings["kiraVersion.graph.pageSize"],
    "kiraVersion.graph.scope": settings["kiraVersion.graph.scope"],
    "kiraVersion.log.level": settings["kiraVersion.log.level"],
    "kiraVersion.theme.kind": settings["kiraVersion.theme.kind"],
  };
}

/** A harness-local copy of `packages/ipc/src/rpc.test.ts`'s own `createInMemoryChannelPair` —
 *  a real in-memory pipe using `structuredClone` (with transfer support) so posting on one end
 *  synchronously invokes the other, mimicking real `postMessage`/transfer-detach semantics
 *  closely enough that `createRpcClient`/`createRpcServer` cannot tell this from a real host
 *  channel. */
function createInMemoryChannelPair(): readonly [MessageChannelLike, MessageChannelLike] {
  let handlerA: ((message: unknown) => void) | undefined;
  let handlerB: ((message: unknown) => void) | undefined;
  let closedA = false;
  let closedB = false;

  const a: MessageChannelLike = {
    post(message, transfer) {
      if (closedA) return;
      const cloned = transfer
        ? structuredClone(message, { transfer: transfer as ArrayBuffer[] })
        : structuredClone(message);
      handlerB?.(cloned);
    },
    onMessage(handler) {
      handlerA = handler;
      return () => {
        if (handlerA === handler) handlerA = undefined;
      };
    },
    close() {
      closedA = true;
    },
  };
  const b: MessageChannelLike = {
    post(message, transfer) {
      if (closedB) return;
      const cloned = transfer
        ? structuredClone(message, { transfer: transfer as ArrayBuffer[] })
        : structuredClone(message);
      handlerA?.(cloned);
    },
    onMessage(handler) {
      handlerB = handler;
      return () => {
        if (handlerB === handler) handlerB = undefined;
      };
    },
    close() {
      closedB = true;
    },
  };
  return [a, b];
}

interface RepoSession {
  readonly repoId: string;
  readonly commits: Scenario["commits"];
  readonly store: CommitStore;
  dictionaryCursor: number;
  nextSeq: number;
}

function createSession(repoId: string, commits: Scenario["commits"]): RepoSession {
  return { repoId, commits, store: new CommitStore(), dictionaryCursor: 0, nextSeq: 0 };
}

function requireSession(sessions: Map<string, RepoSession>, repoId: string): RepoSession {
  const session = sessions.get(repoId);
  if (!session) throw new Error(`mock bridge: no open repo '${repoId}'`);
  return session;
}

/** Appends exactly one page's worth of `session.commits` into `session.store`, or none if the
 *  scenario's fixture is already fully loaded — the mock's stand-in for `RepoService`'s
 *  "read one page from git into the store". */
function readPageIntoStore(session: RepoSession): void {
  const loaded = session.store.rowCount;
  const count = Math.min(PAGE_SIZE, session.commits.length - loaded);
  if (count <= 0) return;
  session.store.appendPage(session.commits.slice(loaded, loaded + count));
}

async function emitRange(
  session: RepoSession,
  from: number,
  to: number,
  source: "git" | "cache",
  emit: (chunk: StreamChunkOf<"graph.stream">) => Promise<void>,
): Promise<void> {
  const commits = session.store.packSlice(from, to, session.dictionaryCursor);
  session.dictionaryCursor += commits.dictionary.length;
  const remaining = session.commits.length - session.store.rowCount;
  await emit({
    repoId: session.repoId,
    seq: session.nextSeq++,
    from,
    to,
    source,
    remaining,
    exhausted: remaining === 0,
    commits,
  });
}

/** `createHandlers`'s own `ServerHandlers` plus a way to read its private `activeRepoId` closure
 *  variable from outside (P4 W12) — `createMockBridge`'s `triggerRefsChanged` hook needs to know
 *  which repo, if any, is open, without duplicating that tracking at its own level. */
interface MockHandlers {
  readonly serverHandlers: ServerHandlers;
  getActiveRepoId(): string | null;
}

function createHandlers(scenario: Scenario): MockHandlers {
  const sessions = new Map<string, RepoSession>();
  let activeRepoId: string | null = null;

  const appInit: RequestHandler<"app.init"> = async () => ({
    host: "harness",
    contractVersion: CONTRACT_VERSION,
    settings: toSettingsSnapshot(),
    git: scenario.git,
  });

  const repoList: RequestHandler<"repo.list"> = async () => ({
    candidates: [],
    activeRepoId,
  });

  const repoPick: RequestHandler<"repo.pick"> = async () => ({ path: null });

  // Ignores `path` deliberately: the mock has exactly one repo per scenario (`Scenario`'s own
  // doc comment), so there is nothing to branch on — every call returns the same fixed outcome.
  const repoOpen: RequestHandler<"repo.open"> = async () => {
    if (scenario.repoOpen.kind === "ok") {
      const { repoId } = scenario.repoOpen.repo;
      if (!sessions.has(repoId)) sessions.set(repoId, createSession(repoId, scenario.commits));
      activeRepoId = repoId;
    }
    return scenario.repoOpen;
  };

  const repoClose: RequestHandler<"repo.close"> = async ({ repoId }) => {
    sessions.delete(repoId);
    if (activeRepoId === repoId) activeRepoId = null;
    return {};
  };

  const graphStatus: RequestHandler<"graph.status"> = async ({ repoId }) => {
    const session = requireSession(sessions, repoId);
    const remaining = session.commits.length - session.store.rowCount;
    return { loaded: session.store.rowCount, remaining, exhausted: remaining === 0 };
  };

  const graphLoadMore: RequestHandler<"graph.loadMore"> = async ({ repoId, pages }) => {
    const session = requireSession(sessions, repoId);
    if (session.store.rowCount >= session.commits.length) return { started: false };
    for (let i = 0; i < (pages ?? 1); i++) readPageIntoStore(session);
    return { started: true };
  };

  // Mirrors `RepoService.refresh`'s observable effect (§6.2), simplified for a fixture-backed
  // session with no watcher and no lazy "next stream re-walks" staging: there is nothing to
  // re-query here (`Scenario.commits` is static), so the mock resets the store eagerly rather
  // than through a `staleReason` latch consumed on the next stream — the client sees the same
  // "next stream starts at `from: 0` with `source: git`" either way.
  const graphRefresh: RequestHandler<"graph.refresh"> = async ({ repoId }) => {
    const session = sessions.get(repoId);
    if (!session) return { restarted: false };
    session.store.clear();
    session.dictionaryCursor = 0;
    return { restarted: true };
  };

  // Mirrors `RepoService.streamGraph`'s cache-then-fresh-page split (see this file's own doc
  // comment): replay whatever this session's store already holds in `CHUNK_ROWS` chunks
  // (`source: "cache"`), then — only on this repo's very first stream, exactly as the real
  // service does — pull one page out of the scenario's fixture and stream the rows that adds.
  const graphStream: StreamHandler<"graph.stream"> = async ({ repoId, resumeThroughRow }, ctx) => {
    const session = requireSession(sessions, repoId);
    let cursor = Math.min(resumeThroughRow ?? 0, session.store.rowCount);
    const cachedThrough = session.store.rowCount;

    while (cursor < cachedThrough) {
      if (ctx.signal.aborted) return;
      const to = Math.min(cursor + CHUNK_ROWS, cachedThrough);
      await emitRange(session, cursor, to, "cache", ctx.emit);
      cursor = to;
    }
    if (ctx.signal.aborted) return;

    if (cachedThrough === 0 && session.store.rowCount < session.commits.length) {
      readPageIntoStore(session);
    }

    while (cursor < session.store.rowCount) {
      if (ctx.signal.aborted) return;
      const to = Math.min(cursor + CHUNK_ROWS, session.store.rowCount);
      await emitRange(session, cursor, to, "git", ctx.emit);
      cursor = to;
    }
  };

  return {
    serverHandlers: {
      requests: {
        "app.init": appInit,
        "repo.list": repoList,
        "repo.pick": repoPick,
        "repo.open": repoOpen,
        "repo.close": repoClose,
        "graph.status": graphStatus,
        "graph.loadMore": graphLoadMore,
        "graph.refresh": graphRefresh,
      },
      streams: {
        "graph.stream": graphStream,
      },
    },
    getActiveRepoId: () => activeRepoId,
  };
}

/** `Transport` plus one test-only hook (P4 W12) the harness's own `main.ts` wires to
 *  `window.__kiraHarness.triggerRefsChanged` — `W13`'s Playwright suite asserts the Refresh
 *  button's stale dot off this without waiting on (or building) a real filesystem watcher. */
export interface MockBridge extends Transport {
  /** Simulates the host noticing `.git/refs` changed underneath the currently open repo — a
   *  no-op with no repo open, matching `RepoState`'s own `repo.changed` handling, which ignores
   *  events for a repo that is not (or no longer) the active one. */
  triggerRefsChanged(): void;
}

export function createMockBridge(scenarioName: string): MockBridge {
  const scenario = loadScenario(scenarioName);
  const [serverChannel, clientChannel] = createInMemoryChannelPair();
  const { serverHandlers, getActiveRepoId } = createHandlers(scenario);
  const server = createRpcServer(serverChannel, serverHandlers);
  const client = createRpcClient(clientChannel);

  return {
    ...client,
    dispose(): void {
      client.dispose();
      server.dispose();
    },
    triggerRefsChanged(): void {
      const repoId = getActiveRepoId();
      if (repoId === null) return;
      server.emit("repo.changed", { repoId, kind: "refsChanged" });
    },
  };
}
