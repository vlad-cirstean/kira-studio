/**
 * The binding from W1's contract keys to W7's `RepoService` and W5's ports (§3.1, W8). One
 * function, `createRepoHandlers`, that both hosts (W10, W11) and the harness (W14) call to get
 * a `ServerHandlers` ready for `createRpcServer`. This is the first file in `packages/git` that
 * imports `@kira-version/ipc` — deferred by P1/P2 only because there was no contract worth
 * binding to until now (§3.1 already permits the dependency).
 *
 * No policy beyond mapping: `repo.open` calls `service.open` and translates the outcome;
 * `repo.pick` calls `dialogs.pickFolder` and never opens the result itself (the UI decides);
 * `graph.stream` forwards chunks and lets a thrown `GitError` cross the wire via `rpc.ts`'s own
 * `toWireError` (already turns `{name, kind, message}` into `{code, kind, message}` with no
 * stderr attached — nothing here needs to catch it).
 */
import type {
  Dialogs,
  HeadState,
  Logger,
  RepoIdentity,
  Settings,
  WorkspaceRoots,
} from "@kira-version/core";
import type {
  HostKind,
  RepoOpenResult,
  RepoSummary,
  RequestHandler,
  ServerHandlers,
  SettingsSnapshot,
  StreamHandler,
  GitStatus as WireGitStatus,
} from "@kira-version/ipc";
import { CONTRACT_VERSION } from "@kira-version/ipc";
import type { GitStatus, GraphChunkPayload, RepoOpenOutcome, RepoService } from "./repoService.ts";

/** The slice of `RepoService` this file actually calls — structural, not the concrete class,
 *  so W8's own tests (and W16's) can drive a fake through the real `createRpcServer` without
 *  standing up a real repo (`RepoService`'s `#`-private fields make the class itself nominal). */
export type RepoServicePort = Pick<
  RepoService,
  "git" | "open" | "close" | "status" | "loadMore" | "streamGraph" | "refresh"
>;

export interface RepoHandlersDeps {
  readonly service: RepoServicePort;
  readonly roots: WorkspaceRoots;
  readonly dialogs: Dialogs;
  readonly settings: () => Settings;
  readonly host: HostKind;
  readonly logger: Logger;
}

/** The setting the UI should offer to edit when `git.kind === "tooOld"` — W1's own literal. */
const GIT_PATH_SETTING_ID = "kiraVersion.git.path";

function toSettingsSnapshot(settings: Settings): SettingsSnapshot {
  return {
    "kiraVersion.git.path": settings["kiraVersion.git.path"],
    "kiraVersion.graph.pageSize": settings["kiraVersion.graph.pageSize"],
    "kiraVersion.graph.scope": settings["kiraVersion.graph.scope"],
    "kiraVersion.log.level": settings["kiraVersion.log.level"],
  };
}

function toWireGitStatus(status: GitStatus): WireGitStatus {
  if (status.kind === "tooOld") {
    return { ...status, settingId: GIT_PATH_SETTING_ID };
  }
  return status;
}

function toHeadState(head: RepoIdentity["head"]): HeadState {
  return head;
}

function toRepoSummary(repoId: string, identity: RepoIdentity): RepoSummary {
  return {
    repoId,
    root: identity.root,
    gitDir: identity.gitDir,
    commonDir: identity.commonDir,
    isBare: identity.isBare,
    isLinkedWorktree: identity.isLinkedWorktree,
    head: toHeadState(identity.head),
  };
}

function toRepoOpenResult(outcome: RepoOpenOutcome): RepoOpenResult {
  switch (outcome.kind) {
    case "ok":
      return { kind: "ok", repo: toRepoSummary(outcome.repoId, outcome.identity) };
    case "notARepository":
      return { kind: "notARepository", path: outcome.path };
    case "gitUnavailable":
      return { kind: "gitUnavailable", git: toWireGitStatus(outcome.git) };
  }
}

export function createRepoHandlers(deps: RepoHandlersDeps): ServerHandlers {
  const logger = deps.logger.child("rpcHandlers");
  let activeRepoId: string | null = null;

  // biome-ignore lint/suspicious/noExplicitAny: a uniform wrapper over every handler shape.
  function logged<H extends (...args: any[]) => Promise<any>>(method: string, handler: H): H {
    return (async (...args: Parameters<H>) => {
      logger.log("debug", method);
      try {
        return await handler(...args);
      } catch (error) {
        logger.log("error", `${method} failed`, error);
        throw error;
      }
    }) as H;
  }

  const appInitImpl: RequestHandler<"app.init"> = async () => ({
    host: deps.host,
    contractVersion: CONTRACT_VERSION,
    settings: toSettingsSnapshot(deps.settings()),
    git: toWireGitStatus(deps.service.git),
  });

  const repoListImpl: RequestHandler<"repo.list"> = async () => ({
    candidates: await deps.roots.list(),
    activeRepoId,
  });

  const repoPickImpl: RequestHandler<"repo.pick"> = async () => ({
    path: await deps.dialogs.pickFolder({ title: "Open Repository" }),
  });

  const repoOpenImpl: RequestHandler<"repo.open"> = async ({ path }) => {
    const outcome = await deps.service.open(path);
    if (outcome.kind === "ok") activeRepoId = outcome.repoId;
    return toRepoOpenResult(outcome);
  };

  const repoCloseImpl: RequestHandler<"repo.close"> = async ({ repoId }) => {
    deps.service.close(repoId);
    if (activeRepoId === repoId) activeRepoId = null;
    return {};
  };

  const graphStatusImpl: RequestHandler<"graph.status"> = async ({ repoId }) =>
    deps.service.status(repoId);

  const graphLoadMoreImpl: RequestHandler<"graph.loadMore"> = async ({ repoId, pages }, ctx) => {
    if (deps.service.status(repoId).exhausted) return { started: false };
    await deps.service.loadMore(repoId, pages, ctx.signal);
    return { started: true };
  };

  const graphRefreshImpl: RequestHandler<"graph.refresh"> = async ({ repoId }) => ({
    restarted: deps.service.refresh(repoId),
  });

  const graphStreamImpl: StreamHandler<"graph.stream"> = async (
    { repoId, resumeThroughRow },
    ctx,
  ) => {
    await deps.service.streamGraph(repoId, {
      ...(resumeThroughRow !== undefined ? { resumeThroughRow } : {}),
      onChunk: (chunk: GraphChunkPayload) => ctx.emit(chunk),
      signal: ctx.signal,
    });
  };

  return {
    requests: {
      "app.init": logged("app.init", appInitImpl),
      "repo.list": logged("repo.list", repoListImpl),
      "repo.pick": logged("repo.pick", repoPickImpl),
      "repo.open": logged("repo.open", repoOpenImpl),
      "repo.close": logged("repo.close", repoCloseImpl),
      "graph.status": logged("graph.status", graphStatusImpl),
      "graph.loadMore": logged("graph.loadMore", graphLoadMoreImpl),
      "graph.refresh": logged("graph.refresh", graphRefreshImpl),
    },
    streams: {
      "graph.stream": logged("graph.stream", graphStreamImpl),
    },
  };
}
