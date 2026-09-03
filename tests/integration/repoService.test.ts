import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  CommitRecord,
  ProcessRunner,
  SpawnedProcess,
  SpawnRequest,
} from "../../packages/core/src/index.ts";
import { CommitStore, defaultSettings } from "../../packages/core/src/index.ts";
import { FakeLogger } from "../../packages/core/src/ports/testFakes.ts";
import { locateGit, resolveRepoIdentity } from "../../packages/git/src/discovery.ts";
import { GitCancelled } from "../../packages/git/src/errors.ts";
import { openLogSession } from "../../packages/git/src/logSession.ts";
import { NodeFileWatcher } from "../../packages/git/src/nodeFileWatcher.ts";
import { NodeProcessRunner } from "../../packages/git/src/nodeProcessRunner.ts";
import type { GraphChunkPayload } from "../../packages/git/src/repoService.ts";
import { RepoService } from "../../packages/git/src/repoService.ts";
import { baseEnv, branchy, linear, withStash } from "../fixtures/generateRepo.ts";

/**
 * W7's own coverage of its "Done when" criteria (open/stream/loadMore/close; a resumed stream
 * spawns nothing; eviction then reveal spawns exactly one; a refsChanged marks stale and the
 * next stream restarts at row 0; a cancelled stream kills nothing a subsequent stream needs).
 * W16 adds the fuller spawn-counting suite the plan promised for this file: open/stream/
 * loadMore/close over `branchy`/`withStash` (not just `linear`), and a row-for-row comparison
 * between a store built from streamed chunks and one built directly from `logSession`.
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

/**
 * Wraps a real `ProcessRunner` so the first `git log` process' entire stdout is collected and
 * then re-delivered to the reader as two artificial chunks, aborting `controller` between them
 * — deterministic regardless of how the OS actually chunks the pipe (which a real repo's output
 * arriving in a single `read()` would otherwise make this test's "abort strictly mid-page, with
 * some but not all rows already sunk" scenario flaky or untestable). `controller.abort()` runs
 * *before* the first chunk is yielded, so `readPage`'s own abort check (at the top of its loop,
 * before it asks for the next chunk) sees it in time to stop after that one chunk's rows are
 * sunk — not before them, and not after a second chunk sneaks in too.
 */
class MidPageAbortRunner implements ProcessRunner {
  readonly #inner: ProcessRunner;
  readonly #controller: AbortController;
  #armed = true;

  constructor(inner: ProcessRunner, controller: AbortController) {
    this.#inner = inner;
    this.#controller = controller;
  }

  spawn(executable: string, request: SpawnRequest): SpawnedProcess {
    const proc = this.#inner.spawn(executable, request);
    if (!this.#armed || !request.argv.includes("log")) return proc;
    this.#armed = false;
    const controller = this.#controller;

    async function* rechunk(): AsyncGenerator<Uint8Array> {
      const parts: Uint8Array[] = [];
      let total = 0;
      for await (const chunk of proc.stdout) {
        parts.push(chunk);
        total += chunk.length;
      }
      const all = new Uint8Array(total);
      let offset = 0;
      for (const part of parts) {
        all.set(part, offset);
        offset += part.length;
      }
      const mid = Math.max(1, Math.floor(all.length / 2));
      controller.abort();
      yield all.subarray(0, mid);
      yield all.subarray(mid);
    }

    // Not `{ ...proc, stdout: rechunk() }`: `write`/`kill` are prototype methods on the real
    // implementation, so a spread would silently drop them (spread copies only own enumerable
    // properties). Delegating explicitly keeps every other behaviour (kill's grace timer,
    // stderr collection) exactly as the real process provides it.
    return {
      stdout: rechunk(),
      stderr: proc.stderr,
      exit: proc.exit,
      write: (chunk) => proc.write(chunk),
      kill: (signal) => proc.kill(signal),
    };
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

/** The exact rev-set `logSessionArgs("all")` walks (`parse/log.ts`'s `revSetArgs`) — `--all
 *  --glob=refs/stash`, so a stash entry counts here too. Used instead of a hand-derived number
 *  so these tests assert against what git itself considers reachable, not against this file's
 *  own arithmetic. */
function revListAllCount(dir: string): number {
  const out = execFileSync("git", ["rev-list", "--count", "--all", "--glob=refs/stash"], {
    cwd: dir,
    env: baseEnv(dir),
    encoding: "utf8",
  });
  return Number(out.trim());
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

  test("open, stream, loadMore and close over a branchy repo", async () => {
    const repo = branchy({ mainCommits: 4, featureCommits: 3, mergeBack: true });
    const total = revListAllCount(repo.dir);
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

      // More pages than strictly needed: the last full page a repo's row count divides evenly
      // into does not by itself reveal exhaustion (§5.1.1 — that needs one more read that comes
      // back empty), and `loadMore`'s own loop already stops early once `exhausted` flips.
      await service.loadMore(repoId, total);
      expect(service.status(repoId)).toEqual({ loaded: total, remaining: 0, exhausted: true });

      const second = await streamAll(service, repoId, 3);
      expect(second.every((chunk) => chunk.source === "cache")).toBe(true);
      expect(totalRows(second)).toBe(total - 3);

      service.close(repoId);
      expect(() => service.status(repoId)).toThrow();
    } finally {
      service.dispose();
    }
  });

  test("open, stream, loadMore and close over a withStash repo", async () => {
    const repo = withStash({ includeUntracked: true });
    // `revSetArgs("all")` globs `refs/stash` too (parse/log.ts), so the stash's own WIP commit
    // (and its extra parents, for the -u variant) are reachable rows here, not just the one real
    // commit `repo.commits` records.
    const total = revListAllCount(repo.dir);
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
      expect(opened.kind).toBe("ok");
      if (opened.kind !== "ok") throw new Error("unreachable");
      const { repoId } = opened;

      const first = await streamAll(service, repoId);
      expect(totalRows(first)).toBe(total);
      expect(service.status(repoId)).toEqual({ loaded: total, remaining: 0, exhausted: true });

      await service.loadMore(repoId, 1); // a no-op past exhaustion, must not spawn or throw
      expect(service.status(repoId)).toEqual({ loaded: total, remaining: 0, exhausted: true });

      service.close(repoId);
      expect(() => service.status(repoId)).toThrow();
    } finally {
      service.dispose();
    }
  });

  test("the store built from streamed chunks matches one built directly from logSession, row for row", async () => {
    const repo = branchy({ mainCommits: 5, featureCommits: 4, mergeBack: true });
    const runner = new NodeProcessRunner();
    const service = await RepoService.create({
      runner,
      fileWatcher: new NodeFileWatcher(),
      logger: new FakeLogger(),
      settings: settingsWithPageSize(3),
      configuredGitCandidates: [],
    });
    try {
      const opened = await service.open(repo.dir);
      if (opened.kind !== "ok") throw new Error("unreachable");
      const { repoId } = opened;

      const chunks = await streamAll(service, repoId); // one page from git (pageSize 3)
      const firstCount = totalRows(chunks);
      // More pages than strictly needed — `loadMore`'s own loop stops early once exhausted.
      await service.loadMore(repoId, revListAllCount(repo.dir));
      // Every row loaded since the first stream, replayed from the store's cache — the first
      // stream already emitted rows [0, firstCount) as "git" chunks, so this resumes from there.
      const rest = await streamAll(service, repoId, firstCount);
      const allChunks = [...chunks, ...rest];

      const streamedStore = new CommitStore();
      for (const chunk of allChunks) streamedStore.appendPacked(chunk.commits);

      const gitResolution = await locateGit({ runner });
      if (gitResolution.kind !== "ok") throw new Error("no usable system git found for this test");
      const identityResolution = await resolveRepoIdentity(gitResolution.git, runner, repo.dir);
      if (identityResolution.kind !== "ok") throw new Error("expected a real repository");

      const session = openLogSession(gitResolution.git, runner, identityResolution.identity.root, {
        scope: "all",
      });
      const records: CommitRecord[] = [];
      try {
        for (;;) {
          const outcome = await session.readPage((record) => records.push(record));
          if (outcome.kind === "stale")
            throw new Error("unreachable: nothing else touches this repo");
          if (outcome.exhausted) break;
        }
      } finally {
        session.dispose();
      }
      const directStore = new CommitStore();
      directStore.appendPage(records);

      expect(streamedStore.rowCount).toBe(directStore.rowCount);
      expect(streamedStore.rowCount).toBe(revListAllCount(repo.dir));
      for (let row = 0; row < directStore.rowCount; row++) {
        expect(streamedStore.commitAt(row)).toEqual(directStore.commitAt(row));
      }
    } finally {
      service.dispose();
    }
  });

  // W2's regression suite: `dictionaryMarks` replacing a single `dictionaryCursor`, cancellable
  // `loadMore`, and `refresh()`.

  test("a resumeThroughRow:0 stream always replays correctly into a brand-new CommitStore, even well after the session has streamed and cached far more", async () => {
    const repo = linear(12);
    const service = await RepoService.create({
      runner: new NodeProcessRunner(),
      fileWatcher: new NodeFileWatcher(),
      logger: new FakeLogger(),
      settings: settingsWithPageSize(3),
      configuredGitCandidates: [],
    });
    try {
      const opened = await service.open(repo.dir);
      if (opened.kind !== "ok") throw new Error("unreachable");
      const { repoId } = opened;

      // A replay taken right after the very first page lands, while the session's dictionary
      // state is still small.
      await streamAll(service, repoId);
      const earlyReplayChunks = await streamAll(service, repoId, 0);
      const earlyStore = new CommitStore();
      for (const chunk of earlyReplayChunks) earlyStore.appendPacked(chunk.commits);

      // Load everything and drain a full cache replay too, advancing the session's internal
      // dictionary state far past where it was for the replay above.
      await service.loadMore(repoId, 10);
      await streamAll(service, repoId, service.status(repoId).loaded);
      expect(service.status(repoId)).toEqual({ loaded: 12, remaining: 0, exhausted: true });

      // A second, independent resumeThroughRow:0 replay taken well after the above — it must
      // still be self-consistent from a fresh dictionary base of 0, not whatever the session's
      // marks have advanced to internally in the meantime (the bug a single running
      // `dictionaryCursor` had: it would hand a `from: 0` chunk the *current*, far-advanced
      // cursor as its dictionary base instead of 0).
      const lateReplayChunks = await streamAll(service, repoId, 0);
      const lateStore = new CommitStore();
      for (const chunk of lateReplayChunks) lateStore.appendPacked(chunk.commits);

      expect(earlyStore.rowCount).toBe(3);
      expect(lateStore.rowCount).toBe(12);
      for (let row = 0; row < earlyStore.rowCount; row++) {
        expect(lateStore.commitAt(row)).toEqual(earlyStore.commitAt(row));
      }
    } finally {
      service.dispose();
    }
  });

  test("resuming at a real chunk boundary appends onto a store holding exactly those rows", async () => {
    const repo = linear(8);
    const service = await RepoService.create({
      runner: new NodeProcessRunner(),
      fileWatcher: new NodeFileWatcher(),
      logger: new FakeLogger(),
      settings: settingsWithPageSize(3),
      configuredGitCandidates: [],
    });
    try {
      const opened = await service.open(repo.dir);
      if (opened.kind !== "ok") throw new Error("unreachable");
      const { repoId } = opened;

      const first = await streamAll(service, repoId); // rows [0, 3) — a recorded mark at 3
      expect(totalRows(first)).toBe(3);
      const store = new CommitStore();
      for (const chunk of first) store.appendPacked(chunk.commits);
      expect(store.rowCount).toBe(3);

      await service.loadMore(repoId, 10); // load the rest into the session's own cache

      // Resume exactly at the boundary the first stream's chunks left the store at.
      const second = await streamAll(service, repoId, 3);
      expect(second[0]?.from).toBe(3);
      for (const chunk of second) store.appendPacked(chunk.commits);
      expect(store.rowCount).toBe(8);

      // Cross-check against a store built from a full resumeThroughRow:0 replay.
      const full = await streamAll(service, repoId, 0);
      const fullStore = new CommitStore();
      for (const chunk of full) fullStore.appendPacked(chunk.commits);
      for (let row = 0; row < store.rowCount; row++) {
        expect(store.commitAt(row)).toEqual(fullStore.commitAt(row));
      }
    } finally {
      service.dispose();
    }
  });

  test("resuming at a row with no recorded mark replays from row 0 instead of guessing", async () => {
    const repo = linear(5);
    const service = await RepoService.create({
      runner: new NodeProcessRunner(),
      fileWatcher: new NodeFileWatcher(),
      logger: new FakeLogger(),
      settings: settingsWithPageSize(10), // bigger than the repo: the whole fixture arrives as
      // a single chunk, so only rows {0, 5} ever get a dictionary mark — row 1 has none.
      configuredGitCandidates: [],
    });
    try {
      const opened = await service.open(repo.dir);
      if (opened.kind !== "ok") throw new Error("unreachable");
      const { repoId } = opened;

      const first = await streamAll(service, repoId);
      expect(first).toHaveLength(1);
      expect(totalRows(first)).toBe(5);

      const resumed = await streamAll(service, repoId, 1); // row 1 has no mark
      expect(resumed[0]?.from).toBe(0); // falls back to a full replay from 0, not a guess
      expect(totalRows(resumed)).toBe(5);
    } finally {
      service.dispose();
    }
  });

  test("refresh() forces the next stream to re-walk from row 0 and spawns exactly one new git log process", async () => {
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
      const { repoId } = opened;

      await streamAll(service, repoId);
      expect(runner.logSpawnCount).toBe(1);
      expect(service.status(repoId)).toEqual({ loaded: 6, remaining: 0, exhausted: true });

      expect(service.refresh("no-such-repo")).toBe(false);
      expect(service.refresh(repoId)).toBe(true);

      const restarted = await streamAll(service, repoId, service.status(repoId).loaded);
      expect(runner.logSpawnCount).toBe(2);
      expect(restarted[0]?.from).toBe(0);
      expect(restarted.every((chunk) => chunk.source === "git")).toBe(true);
      expect(totalRows(restarted)).toBe(6);
      expect(service.status(repoId)).toEqual({ loaded: 6, remaining: 0, exhausted: true });
    } finally {
      service.dispose();
    }
  });

  test("a loadMore aborted mid-page leaves the session usable, with the already-sunk rows readable", async () => {
    const repo = linear(20);
    const total = revListAllCount(repo.dir);
    const controller = new AbortController();
    const runner = new MidPageAbortRunner(new NodeProcessRunner(), controller);
    const service = await RepoService.create({
      runner,
      fileWatcher: new NodeFileWatcher(),
      logger: new FakeLogger(),
      // The whole walk is one page, so the abort lands squarely inside a single readPage()
      // call rather than at a page boundary.
      settings: settingsWithPageSize(total),
      configuredGitCandidates: [],
    });
    try {
      const opened = await service.open(repo.dir);
      if (opened.kind !== "ok") throw new Error("unreachable");
      const { repoId } = opened;

      await expect(service.loadMore(repoId, 1, controller.signal)).rejects.toBeInstanceOf(
        GitCancelled,
      );

      const partial = service.status(repoId).loaded;
      expect(partial).toBeGreaterThan(0);
      expect(partial).toBeLessThan(total);

      // The session is still usable: an uncancelled loadMore resumes via `--skip` from the
      // partial page rather than needing anything reset, and reaches full exhaustion.
      await service.loadMore(repoId, 5);
      expect(service.status(repoId)).toEqual({ loaded: total, remaining: 0, exhausted: true });
    } finally {
      service.dispose();
    }
  }, 10_000);
});
