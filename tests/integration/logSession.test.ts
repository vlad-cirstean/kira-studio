import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import type { CommitRecord } from "../../packages/core/src/model/commit.ts";
import { locateGit } from "../../packages/git/src/discovery.ts";
import { openLogSession } from "../../packages/git/src/logSession.ts";
import { NodeProcessRunner } from "../../packages/git/src/nodeProcessRunner.ts";
import { baseEnv, branchy, linear } from "../fixtures/generateRepo.ts";

const runner = new NodeProcessRunner();

async function resolvedGit() {
  const resolution = await locateGit({ runner });
  if (resolution.kind !== "ok") throw new Error("no usable system git found for this test");
  return resolution.git;
}

async function drainAll(dir: string, scope: "all" | "head", pageSize: number) {
  const git = await resolvedGit();
  const session = openLogSession(git, runner, dir, { scope, pageSize });
  const records: CommitRecord[] = [];
  try {
    for (;;) {
      const outcome = await session.readPage((r) => records.push(r));
      if (outcome.kind === "stale") throw new Error("unexpected stale during drain");
      if (outcome.exhausted) break;
    }
  } finally {
    session.dispose();
  }
  return records;
}

describe("logSession — page boundaries", () => {
  test("page boundaries are exact across 1, 2 and several pages on a generated repo", async () => {
    const { dir, commits } = linear(23);
    for (const pageSize of [1, 2, 5, 100]) {
      const records = await drainAll(dir, "all", pageSize);
      expect(records.map((r) => r.sha).sort()).toEqual([...commits].sort());
    }
  });

  test("exhausted is set precisely on the page that ends the walk; a further readPage is a no-op", async () => {
    const { dir, commits } = linear(7);
    const git = await resolvedGit();
    const session = openLogSession(git, runner, dir, { scope: "all", pageSize: 3 });
    try {
      const p1 = await session.readPage(() => {});
      expect(p1).toEqual({ kind: "page", appended: 3, exhausted: false });
      const p2 = await session.readPage(() => {});
      expect(p2).toEqual({ kind: "page", appended: 3, exhausted: false });
      const p3 = await session.readPage(() => {});
      expect(p3).toEqual({ kind: "page", appended: 1, exhausted: true });
      expect(session.loadedCount).toBe(commits.length);
      const p4 = await session.readPage(() => {});
      expect(p4).toEqual({ kind: "page", appended: 0, exhausted: true });
    } finally {
      session.dispose();
    }
  });

  test("no records are duplicated or skipped across a resume", async () => {
    const { dir, commits } = linear(19);
    const records = await drainAll(dir, "all", 4);
    expect(records).toHaveLength(commits.length);
    expect(new Set(records.map((r) => r.sha)).size).toBe(commits.length);
  });

  test("order is preserved (topo-order, newest first)", async () => {
    const { dir, commits } = linear(10);
    const records = await drainAll(dir, "all", 3);
    // linear() commits newest-last in its own array; the walk emits newest-first.
    expect(records.map((r) => r.sha)).toEqual([...commits].reverse());
  });
});

describe("logSession — the --skip fallback", () => {
  test("a reclaimed process yields a byte-identical sequence to an uninterrupted one", async () => {
    const { dir } = linear(30);
    const uninterrupted = await drainAll(dir, "all", 6);

    const git = await resolvedGit();
    // idleReclaimMs fires as soon as a page finishes, forcing every subsequent page through
    // the --skip restart path instead of the paused-process resume.
    const session = openLogSession(git, runner, dir, {
      scope: "all",
      pageSize: 6,
      idleReclaimMs: 1,
    });
    const reclaimed: CommitRecord[] = [];
    try {
      for (;;) {
        const outcome = await session.readPage((r) => reclaimed.push(r));
        if (outcome.kind === "stale") throw new Error("unexpected stale");
        // Give the idle timer a chance to actually fire before requesting the next page.
        await new Promise((resolve) => setTimeout(resolve, 20));
        if (outcome.exhausted) break;
      }
    } finally {
      session.dispose();
    }

    expect(reclaimed.map((r) => r.sha)).toEqual(uninterrupted.map((r) => r.sha));
  });
});

describe("logSession — staleness on a moved ref", () => {
  test("a ref moved mid-session (after a reclaim) yields stale rather than a spliced page", async () => {
    const { dir } = linear(10);
    const git = await resolvedGit();
    const session = openLogSession(git, runner, dir, {
      scope: "all",
      pageSize: 3,
      idleReclaimMs: 1,
    });
    try {
      const first = await session.readPage(() => {});
      expect(first.kind).toBe("page");
      // Let the idle timer reclaim the paused process.
      await new Promise((resolve) => setTimeout(resolve, 20));

      // Move HEAD underneath the session by committing directly with git.
      execFileSync(
        "git",
        ["commit", "--quiet", "--allow-empty", "--no-gpg-sign", "-m", "moved ref"],
        {
          cwd: dir,
          env: {
            ...baseEnv(dir),
            GIT_AUTHOR_NAME: "Kira Fixture",
            GIT_AUTHOR_EMAIL: "fixture@kira-version.test",
            GIT_COMMITTER_NAME: "Kira Fixture",
            GIT_COMMITTER_EMAIL: "fixture@kira-version.test",
          },
        },
      );

      const next = await session.readPage(() => {});
      expect(next).toEqual({ kind: "stale", reason: "refsChanged" });
    } finally {
      session.dispose();
    }
  });
});

describe("logSession — cancellation and disposal", () => {
  test("an aborted readPage rejects and leaves the session disposable", async () => {
    const { dir } = linear(200);
    const git = await resolvedGit();
    const session = openLogSession(git, runner, dir, { scope: "all", pageSize: 100_000 });
    const controller = new AbortController();
    queueMicrotask(() => controller.abort());
    await expect(session.readPage(() => {}, { signal: controller.signal })).rejects.toThrow();
    expect(() => session.dispose()).not.toThrow();
  });

  test("dispose() is idempotent and readPage() after dispose() throws", async () => {
    const { dir } = linear(5);
    const git = await resolvedGit();
    const session = openLogSession(git, runner, dir, { scope: "all", pageSize: 10 });
    await session.readPage(() => {});
    session.dispose();
    expect(() => session.dispose()).not.toThrow();
    await expect(session.readPage(() => {})).rejects.toThrow();
  });
});

describe("logSession — scope", () => {
  test('scope: "head" walks only the current branch', async () => {
    const { dir } = branchy({ mergeBack: false });
    const all = await drainAll(dir, "all", 100);
    const head = await drainAll(dir, "head", 100);
    expect(head.length).toBeLessThan(all.length);
    expect(head.every((h) => all.some((a) => a.sha === h.sha))).toBe(true);
  });
});

describe("logSession — remaining()", () => {
  test("remaining() decreases to exactly zero as pages load", async () => {
    const { dir, commits } = linear(11);
    const git = await resolvedGit();
    const session = openLogSession(git, runner, dir, { scope: "all", pageSize: 4 });
    try {
      expect(await session.remaining()).toBe(commits.length);
      await session.readPage(() => {});
      expect(await session.remaining()).toBe(commits.length - 4);
      await session.readPage(() => {});
      expect(await session.remaining()).toBe(commits.length - 8);
      await session.readPage(() => {});
      expect(await session.remaining()).toBe(0);
    } finally {
      session.dispose();
    }
  });
});
