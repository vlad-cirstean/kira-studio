import { describe, expect, test } from "bun:test";
import type { Settings } from "../../../packages/core/src/index.ts";
import { defaultSettings } from "../../../packages/core/src/index.ts";
import {
  FakeDialogs,
  FakeLogger,
  FakeWorkspaceRoots,
} from "../../../packages/core/src/ports/testFakes.ts";
import { GitError } from "../../../packages/git/src/errors.ts";
import type { GitStatus } from "../../../packages/git/src/repoService.ts";
import type { RepoServicePort } from "../../../packages/git/src/rpcHandlers.ts";
import { createRepoHandlers } from "../../../packages/git/src/rpcHandlers.ts";
import type {
  MessageChannelLike,
  RequestKey,
  ServerHandlers,
  StreamChunkOf,
} from "../../../packages/ipc/src/index.ts";
import { createRpcClient, createRpcServer } from "../../../packages/ipc/src/index.ts";

/**
 * W8's own "Done when": every contract key has a handler, and a fake `RepoService` drives a
 * full client-to-handler round trip over an in-memory channel — including a thrown `GitError`
 * arriving client-side as `{ code, kind }` with no stderr attached.
 */

function createInMemoryChannelPair(): readonly [MessageChannelLike, MessageChannelLike] {
  let handlerA: ((message: unknown) => void) | undefined;
  let handlerB: ((message: unknown) => void) | undefined;

  const a: MessageChannelLike = {
    post(message, transfer) {
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
    close() {},
  };
  const b: MessageChannelLike = {
    post(message, transfer) {
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
    close() {},
  };
  return [a, b] as const;
}

class FakeRepoService implements RepoServicePort {
  git: GitStatus;
  openResult: Awaited<ReturnType<RepoServicePort["open"]>> = {
    kind: "notARepository",
    path: "",
  };
  statusResult: ReturnType<RepoServicePort["status"]> = {
    loaded: 0,
    remaining: 0,
    exhausted: false,
  };
  readonly closedRepoIds: string[] = [];
  readonly loadMoreCalls: Array<{ repoId: string; pages: number | undefined }> = [];
  streamError: unknown;
  streamChunks: readonly StreamChunkOf<"graph.stream">[] = [];

  constructor(git: GitStatus) {
    this.git = git;
  }

  open(_path: string): ReturnType<RepoServicePort["open"]> {
    return Promise.resolve(this.openResult);
  }

  close(repoId: string): void {
    this.closedRepoIds.push(repoId);
  }

  status(_repoId: string): ReturnType<RepoServicePort["status"]> {
    return this.statusResult;
  }

  async loadMore(repoId: string, pages?: number): Promise<void> {
    this.loadMoreCalls.push({ repoId, pages });
  }

  async streamGraph(
    _repoId: string,
    opts: Parameters<RepoServicePort["streamGraph"]>[1],
  ): Promise<void> {
    for (const chunk of this.streamChunks) {
      await opts.onChunk(chunk);
    }
    if (this.streamError) throw this.streamError;
  }
}

function settingsFn(overrides: Partial<Settings> = {}): () => Settings {
  const settings = { ...defaultSettings(), ...overrides };
  return () => settings;
}

function setup(service: FakeRepoService) {
  const roots = new FakeWorkspaceRoots([{ path: "/repos/a", label: "a" }]);
  const dialogs = new FakeDialogs();
  const logger = new FakeLogger();
  const handlers: ServerHandlers = createRepoHandlers({
    service,
    roots,
    dialogs,
    settings: settingsFn(),
    host: "harness",
    logger,
  });
  const [a, b] = createInMemoryChannelPair();
  const server = createRpcServer(a, handlers);
  const client = createRpcClient(b);
  return { roots, dialogs, logger, server, client };
}

describe("createRepoHandlers", () => {
  test("every contract request and stream key has a handler", () => {
    const service = new FakeRepoService({ kind: "ok", path: "/usr/bin/git", version: "2.40.0" });
    const roots = new FakeWorkspaceRoots();
    const dialogs = new FakeDialogs();
    const handlers = createRepoHandlers({
      service,
      roots,
      dialogs,
      settings: settingsFn(),
      host: "harness",
      logger: new FakeLogger(),
    });
    const expectedRequests: RequestKey[] = [
      "app.init",
      "repo.list",
      "repo.pick",
      "repo.open",
      "repo.close",
      "graph.status",
      "graph.loadMore",
    ];
    for (const key of expectedRequests) expect(typeof handlers.requests[key]).toBe("function");
    expect(typeof handlers.streams["graph.stream"]).toBe("function");
  });

  test("app.init reports host, contract version, settings and git status", async () => {
    const service = new FakeRepoService({ kind: "ok", path: "/usr/bin/git", version: "2.40.0" });
    const { client, server } = setup(service);
    try {
      const result = await client.request("app.init", {});
      expect(result.host).toBe("harness");
      expect(result.contractVersion).toBe(2);
      expect(result.settings).toEqual(defaultSettings());
      expect(result.git).toEqual({ kind: "ok", path: "/usr/bin/git", version: "2.40.0" });
    } finally {
      client.dispose();
      server.dispose();
    }
  });

  test("app.init's tooOld git status gains the settingId the UI needs to render", async () => {
    const service = new FakeRepoService({
      kind: "tooOld",
      path: "/usr/bin/git",
      detected: "2.10.0",
      required: "2.38.0",
    });
    const { client, server } = setup(service);
    try {
      const result = await client.request("app.init", {});
      expect(result.git).toEqual({
        kind: "tooOld",
        path: "/usr/bin/git",
        detected: "2.10.0",
        required: "2.38.0",
        settingId: "kiraVersion.git.path",
      });
    } finally {
      client.dispose();
      server.dispose();
    }
  });

  test("repo.list forwards WorkspaceRoots' candidates with no active repo before any open", async () => {
    const service = new FakeRepoService({ kind: "ok", path: "git", version: "2.40.0" });
    const { client, server, roots } = setup(service);
    try {
      const result = await client.request("repo.list", {});
      expect(result.candidates).toEqual(await roots.list());
      expect(result.activeRepoId).toBeNull();
    } finally {
      client.dispose();
      server.dispose();
    }
  });

  test("repo.pick calls Dialogs.pickFolder and never opens the result itself", async () => {
    const service = new FakeRepoService({ kind: "ok", path: "git", version: "2.40.0" });
    const { client, server, dialogs } = setup(service);
    dialogs.queuedResults = ["/repos/picked"];
    try {
      const result = await client.request("repo.pick", {});
      expect(result).toEqual({ path: "/repos/picked" });
      expect(service.closedRepoIds).toEqual([]); // never touched RepoService
    } finally {
      client.dispose();
      server.dispose();
    }
  });

  test("repo.open translates an ok outcome into a RepoSummary and becomes the active repo", async () => {
    const service = new FakeRepoService({ kind: "ok", path: "git", version: "2.40.0" });
    service.openResult = {
      kind: "ok",
      repoId: "/repos/a",
      identity: {
        root: "/repos/a",
        gitDir: "/repos/a/.git",
        commonDir: "/repos/a/.git",
        isBare: false,
        isLinkedWorktree: false,
        head: { kind: "branch", name: "main" },
      },
    };
    const { client, server } = setup(service);
    try {
      const opened = await client.request("repo.open", { path: "/repos/a" });
      expect(opened).toEqual({
        kind: "ok",
        repo: {
          repoId: "/repos/a",
          root: "/repos/a",
          gitDir: "/repos/a/.git",
          commonDir: "/repos/a/.git",
          isBare: false,
          isLinkedWorktree: false,
          head: { kind: "branch", name: "main" },
        },
      });

      const list = await client.request("repo.list", {});
      expect(list.activeRepoId).toBe("/repos/a");
    } finally {
      client.dispose();
      server.dispose();
    }
  });

  test("repo.open translates notARepository and gitUnavailable outcomes verbatim", async () => {
    const service = new FakeRepoService({ kind: "ok", path: "git", version: "2.40.0" });
    const { client, server } = setup(service);
    try {
      service.openResult = { kind: "notARepository", path: "/not/a/repo" };
      expect(await client.request("repo.open", { path: "/not/a/repo" })).toEqual({
        kind: "notARepository",
        path: "/not/a/repo",
      });

      service.openResult = {
        kind: "gitUnavailable",
        git: { kind: "notFound", probed: ["/usr/bin/git"] },
      };
      expect(await client.request("repo.open", { path: "/anything" })).toEqual({
        kind: "gitUnavailable",
        git: { kind: "notFound", probed: ["/usr/bin/git"] },
      });
    } finally {
      client.dispose();
      server.dispose();
    }
  });

  test("repo.close closes the RepoService session and clears the active repo", async () => {
    const service = new FakeRepoService({ kind: "ok", path: "git", version: "2.40.0" });
    service.openResult = {
      kind: "ok",
      repoId: "/repos/a",
      identity: {
        root: "/repos/a",
        gitDir: "/repos/a/.git",
        commonDir: "/repos/a/.git",
        isBare: false,
        isLinkedWorktree: false,
        head: { kind: "branch", name: "main" },
      },
    };
    const { client, server } = setup(service);
    try {
      await client.request("repo.open", { path: "/repos/a" });
      expect(await client.request("repo.close", { repoId: "/repos/a" })).toEqual({});
      expect(service.closedRepoIds).toEqual(["/repos/a"]);
      expect((await client.request("repo.list", {})).activeRepoId).toBeNull();
    } finally {
      client.dispose();
      server.dispose();
    }
  });

  test("graph.status passes RepoService's status through unchanged", async () => {
    const service = new FakeRepoService({ kind: "ok", path: "git", version: "2.40.0" });
    service.statusResult = { loaded: 12, remaining: 3, exhausted: false };
    const { client, server } = setup(service);
    try {
      expect(await client.request("graph.status", { repoId: "r1" })).toEqual({
        loaded: 12,
        remaining: 3,
        exhausted: false,
      });
    } finally {
      client.dispose();
      server.dispose();
    }
  });

  test("graph.loadMore reports started:false without calling loadMore when already exhausted", async () => {
    const service = new FakeRepoService({ kind: "ok", path: "git", version: "2.40.0" });
    service.statusResult = { loaded: 10, remaining: 0, exhausted: true };
    const { client, server } = setup(service);
    try {
      expect(await client.request("graph.loadMore", { repoId: "r1" })).toEqual({
        started: false,
      });
      expect(service.loadMoreCalls).toEqual([]);
    } finally {
      client.dispose();
      server.dispose();
    }
  });

  test("graph.loadMore calls RepoService.loadMore and reports started:true when not exhausted", async () => {
    const service = new FakeRepoService({ kind: "ok", path: "git", version: "2.40.0" });
    service.statusResult = { loaded: 3, remaining: 7, exhausted: false };
    const { client, server } = setup(service);
    try {
      expect(await client.request("graph.loadMore", { repoId: "r1", pages: 2 })).toEqual({
        started: true,
      });
      expect(service.loadMoreCalls).toEqual([{ repoId: "r1", pages: 2 }]);
    } finally {
      client.dispose();
      server.dispose();
    }
  });

  test("graph.stream forwards chunks from RepoService.streamGraph verbatim", async () => {
    const service = new FakeRepoService({ kind: "ok", path: "git", version: "2.40.0" });
    service.streamChunks = [
      {
        repoId: "r1",
        seq: 0,
        from: 0,
        to: 2,
        source: "git",
        remaining: 0,
        exhausted: true,
        commits: {
          from: 0,
          to: 2,
          shaWidthBytes: 20,
          shas: new ArrayBuffer(0),
          parentOffsets: new ArrayBuffer(4),
          parentShas: new ArrayBuffer(0),
          identityIds: new ArrayBuffer(0),
          times: new ArrayBuffer(0),
          subjectBytes: new ArrayBuffer(0),
          subjectOffsets: new ArrayBuffer(4),
          dictionaryBase: 0,
          dictionary: [],
          decorations: [],
        },
      },
    ];
    const { client, server } = setup(service);
    try {
      const received: StreamChunkOf<"graph.stream">[] = [];
      await client.stream("graph.stream", { repoId: "r1" }, (chunk) => {
        received.push(chunk);
      });
      expect(received).toHaveLength(1);
      expect(received[0]?.repoId).toBe("r1");
      expect(received[0]?.exhausted).toBe(true);
    } finally {
      client.dispose();
      server.dispose();
    }
  });

  test("a thrown GitError crosses the wire as { code, kind } with no stderr attached", async () => {
    const service = new FakeRepoService({ kind: "ok", path: "git", version: "2.40.0" });
    service.streamError = new GitError("LockHeld", ["log"], 128, "fatal: Unable to create lock");
    const { client, server } = setup(service);
    try {
      await expect(client.stream("graph.stream", { repoId: "r1" }, () => {})).rejects.toMatchObject(
        {
          name: "RpcError",
          code: "GitError",
          kind: "LockHeld",
        },
      );
    } finally {
      client.dispose();
      server.dispose();
    }
  });
});
