import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProcessRunner, SpawnedProcess, SpawnRequest } from "../../packages/core/src/index.ts";
import { defaultSettings } from "../../packages/core/src/index.ts";
import { FakeLogger } from "../../packages/core/src/ports/testFakes.ts";
import { NodeFileWatcher } from "../../packages/git/src/nodeFileWatcher.ts";
import { NodeProcessRunner } from "../../packages/git/src/nodeProcessRunner.ts";
import type { GraphChunkPayload } from "../../packages/git/src/repoService.ts";
import { RepoService } from "../../packages/git/src/repoService.ts";
import { baseEnv, linear } from "../fixtures/generateRepo.ts";

/**
 * W7's own coverage of its "Done when" criteria (open/stream/loadMore/close; a resumed stream
 * spawns nothing; eviction then reveal spawns exactly one; a refsChanged marks stale and the
 * next stream restarts at row 0; a cancelled stream kills nothing a subsequent stream needs).
 * The fuller spawn-counting suite promised by the plan for W16 (`repoService.test.ts` against
 * `linear`/`branchy`/`withStash`, row-for-row store comparison) is that later item's job; this
 * file is W7's own bar, against real git and a real `NodeFileWatcher`.
 */

class CountingRunner implements ProcessRunner {
  readonly calls: Array<{ readonly executable: string; readonly argv: readonly string[] }> = [];
  readonly #inner = new NodeProcessRunner();

  spawn(executable: string, request: SpawnRequest): SpawnedProcess {
    this.calls.push({ executable, argv: request.argv });
    return this.#inner.spawn(executable, request);
  }

  get totalSpawnCount(): number {
    return this.calls.length;
  }

  get logSpawnCount(): number {
    return this.calls.filter((call) => call.argv.includes("log")).length;
  }
}

function settingsWithPageSize(pageSize: number) {
  return { ...defaultSettings(), "kiraVersion.graph.pageSize": pageSize };
}

async function streamAll(
  service: RepoService,
  repoId: string,
  resumeThroughRow?: number,
  signal?: AbortSignal,
): Promise<GraphChunkPayload[]> {
  const chunks: GraphChunkPayload[] = [];
  await service.streamGraph(repoId, {
    ...(resumeThroughRow !== undefined ? { resumeThroughRow } : {}),
    onChunk: async (chunk) => {
      chunks.push(chunk);
    },
    ...(signal !== undefined ? { signal } : {}),
  });
  return chunks;
}

function totalRows(chunks: readonly GraphChunkPayload[]): number {
  return chunks.reduce((sum, chunk) => sum + (chunk.to - chunk.from), 0);
}

async function waitFor(predicate: () => boolean, maxMs = 5000): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (!predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("RepoService", () => {
  test("open, stream, loadMore and close over a generated repo", async () => {
    const repo = linear(10);
    const runner = new CountingRunner();
    const service = await RepoService.create({
      runner,
      fileWatcher: new NodeFileWatcher(),
      logger: new FakeLogger(),
      settings: settingsWithPageSize(3),
      configuredGitCandidates: [],
    });
    try {
      const opened = await service.open(repo.dir);
      expect(opened.kind).toBe("ok");
      if (opened.kind !== "ok") throw new Error("unreachable");
      const { repoId } = opened;

      const first = await streamAll(service, repoId);
      expect(totalRows(first)).toBe(3);
      expect(first.every((chunk) => chunk.source === "git")).toBe(true);
      expect(service.status(repoId)).toEqual({ loaded: 3, remaining: 7, exhausted: false });

      await service.loadMore(repoId, 3);
      expect(service.status(repoId)).toEqual({ loaded: 10, remaining: 0, exhausted: true });

      const second = await streamAll(service, repoId, 3);
      expect(second.every((chunk) => chunk.source === "cache")).toBe(true);
      expect(totalRows(second)).toBe(7);

      service.close(repoId);
      expect(() => service.status(repoId)).toThrow();
    } finally {
      service.dispose();
    }
  });

  test("open() on a non-repository path reports notARepository", async () => {
    const service = await RepoService.create({
      runner: new NodeProcessRunner(),
      fileWatcher: new NodeFileWatcher(),
      logger: new FakeLogger(),
      settings: settingsWithPageSize(3),
      configuredGitCandidates: [],
    });
    try {
      const notARepo = mkdtempSync(join(tmpdir(), "kira-not-a-repo-"));
      const outcome = await service.open(notARepo);
      expect(outcome.kind).toBe("notARepository");
    } finally {
      service.dispose();
    }
  });

  test("re-opening an already-open root returns the same repoId without duplicating state", async () => {
    const repo = linear(2);
    const service = await RepoService.create({
      runner: new NodeProcessRunner(),
      fileWatcher: new NodeFileWatcher(),
      logger: new FakeLogger(),
      settings: settingsWithPageSize(10),
      configuredGitCandidates: [],
    });
    try {
      const first = await service.open(repo.dir);
      const second = await service.open(repo.dir);
      if (first.kind !== "ok" || second.kind !== "ok") throw new Error("unreachable");
      expect(second.repoId).toBe(first.repoId);

      const chunks = await streamAll(service, first.repoId);
      expect(totalRows(chunks)).toBe(2); // exactly one session's worth of rows, not two
    } finally {
      service.dispose();
    }
  });

  test("a resumed streamGraph on the same repo spawns no git process", async () => {
    const repo = linear(6);
    const runner = new CountingRunner();
    const service = await RepoService.create({
      runner,
      fileWatcher: new NodeFileWatcher(),
      logger: new FakeLogger(),
      settings: settingsWithPageSize(10),
      configuredGitCandidates: [],
    });
    try {
      const opened = await service.open(repo.dir);
      if (opened.kind !== "ok") throw new Error("unreachable");

      await streamAll(service, opened.repoId);
      const spawnsAfterFirstStream = runner.totalSpawnCount;

      const resumed = await streamAll(service, opened.repoId, service.status(opened.repoId).loaded);
      expect(runner.totalSpawnCount).toBe(spawnsAfterFirstStream);
      expect(resumed.every((chunk) => chunk.source === "cache")).toBe(true);
    } finally {
      service.dispose();
    }
  });

  test("eviction then a reveal spawns exactly one git log process", async () => {
    const repo = linear(6);
    const runner = new CountingRunner();
    const service = await RepoService.create(
      {
        runner,
        fileWatcher: new NodeFileWatcher(),
        logger: new FakeLogger(),
        settings: settingsWithPageSize(10),
        configuredGitCandidates: [],
      },
      { evictMs: 20 },
    );
    try {
      const opened = await service.open(repo.dir);
      if (opened.kind !== "ok") throw new Error("unreachable");

      await streamAll(service, opened.repoId);
      expect(runner.logSpawnCount).toBe(1);

      service.setUiVisible(false);
      await new Promise((resolve) => setTimeout(resolve, 200)); // let the eviction timer fire
      expect(service.status(opened.repoId).loaded).toBe(0); // evicted: store dropped

      service.setUiVisible(true);
      const afterReveal = await streamAll(service, opened.repoId);
      expect(runner.logSpawnCount).toBe(2);
      expect(totalRows(afterReveal)).toBe(6);
    } finally {
      service.dispose();
    }
  }, 10_000);

  test("a refsChanged during a session emits once and the next stream restarts at row 0", async () => {
    const repo = linear(4);
    const service = await RepoService.create({
      runner: new NodeProcessRunner(),
      fileWatcher: new NodeFileWatcher(),
      logger: new FakeLogger(),
      settings: settingsWithPageSize(10),
      configuredGitCandidates: [],
    });
    try {
      const opened = await service.open(repo.dir);
      if (opened.kind !== "ok") throw new Error("unreachable");
      await streamAll(service, opened.repoId);
      expect(service.status(opened.repoId).loaded).toBe(4);

      const seen: Array<{ repoId: string; kind: string }> = [];
      service.onChanged((e) => seen.push(e));

      execFileSync("git", ["tag", "v1"], { cwd: repo.dir, env: baseEnv(repo.dir) });
      await waitFor(() => seen.length > 0);
      await new Promise((resolve) => setTimeout(resolve, 300)); // let any trailing coalescing settle
      expect(seen.filter((e) => e.kind === "refsChanged")).toHaveLength(1);

      // The caller's `resumeThroughRow` reflects the pre-reset row count; the service must not
      // trust it once the repo is known stale.
      const restarted = await streamAll(
        service,
        opened.repoId,
        service.status(opened.repoId).loaded,
      );
      expect(restarted[0]?.from).toBe(0);
      expect(restarted.every((chunk) => chunk.source === "git")).toBe(true);
      expect(totalRows(restarted)).toBe(4);
    } finally {
      service.dispose();
    }
  }, 10_000);

  test("a cancelled stream kills nothing a subsequent stream needs", async () => {
    const repo = linear(9);
    const runner = new CountingRunner();
    const service = await RepoService.create({
      runner,
      fileWatcher: new NodeFileWatcher(),
      logger: new FakeLogger(),
      settings: settingsWithPageSize(4),
      configuredGitCandidates: [],
    });
    try {
      const opened = await service.open(repo.dir);
      if (opened.kind !== "ok") throw new Error("unreachable");

      const controller = new AbortController();
      let chunkCount = 0;
      await service.streamGraph(opened.repoId, {
        onChunk: async () => {
          chunkCount++;
          controller.abort();
        },
        signal: controller.signal,
      });
      expect(chunkCount).toBe(1);
      expect(service.status(opened.repoId).loaded).toBe(4); // the page already read stays cached

      // The paused `git log` process behind the LogSession must still be alive: a subsequent,
      // uncancelled read continues it rather than respawning.
      await service.loadMore(opened.repoId, 2);
      expect(service.status(opened.repoId)).toEqual({ loaded: 9, remaining: 0, exhausted: true });
      expect(runner.logSpawnCount).toBe(1);
    } finally {
      service.dispose();
    }
  });
});
