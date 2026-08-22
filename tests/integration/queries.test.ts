import { execFileSync } from "node:child_process";
import { describe, expect, test } from "bun:test";
import { locateGit } from "../../packages/git/src/discovery.ts";
import { openGitDriver } from "../../packages/git/src/driver.ts";
import { NodeProcessRunner } from "../../packages/git/src/nodeProcessRunner.ts";
import {
  commitDetail,
  countCommits,
  log,
  predictMerge,
  refs,
  stashList,
  status,
} from "../../packages/git/src/queries.ts";
import {
  conflicting,
  crissCross,
  linear,
  octopus,
  withRemote,
  withStash,
} from "../fixtures/generateRepo.ts";

const runner = new NodeProcessRunner();
const noopCatFile = { dispose: () => {} };

async function driverFor(repoRoot: string) {
  const resolution = await locateGit({ runner });
  if (resolution.kind !== "ok") throw new Error("no usable system git found for this test");
  return openGitDriver(resolution.git, runner, repoRoot, noopCatFile);
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of iterable) out.push(item);
  return out;
}

describe("log", () => {
  test("walks a linear history and reports every commit", async () => {
    const { dir, commits } = linear(5);
    const driver = await driverFor(dir);
    const records = await collect(log(driver, { scope: "all", pageSize: 100 }));
    expect(records.map((r) => r.sha).sort()).toEqual([...commits].sort());
  });

  test("an octopus merge's 4-parent commit parses correctly through the query layer", async () => {
    const { dir } = octopus();
    const driver = await driverFor(dir);
    const records = await collect(log(driver, { scope: "all", pageSize: 100 }));
    const merge = records.find((r) => r.parents.length >= 3);
    expect(merge?.parents).toHaveLength(4);
  });

  test("a criss-cross history's two merges both appear", async () => {
    const { dir } = crissCross();
    const driver = await driverFor(dir);
    const records = await collect(log(driver, { scope: "all", pageSize: 100 }));
    expect(records.filter((r) => r.parents.length === 2)).toHaveLength(2);
  });

  test("cancelling mid-stream kills the process within the SIGTERM grace", async () => {
    const { dir } = linear(50);
    const driver = await driverFor(dir);
    const controller = new AbortController();
    const start = Date.now();
    const seen: string[] = [];
    await expect(
      (async () => {
        for await (const record of log(driver, {
          scope: "all",
          pageSize: 50,
          signal: controller.signal,
        })) {
          seen.push(record.sha);
          if (seen.length === 2) controller.abort();
        }
      })(),
    ).rejects.toBeInstanceOf(Error);
    expect(Date.now() - start).toBeLessThan(3000);
    expect(seen.length).toBeGreaterThanOrEqual(2);
  }, 10_000);
});

describe("refs", () => {
  test("reports upstream and ahead/behind for a branch with a remote", async () => {
    const { dir } = withRemote({ localOnlyCommits: 1 });
    const driver = await driverFor(dir);
    const records = await refs(driver);
    const main = records.find((r) => r.refname === "refs/heads/main");
    expect(main?.upstream).toBe("refs/remotes/origin/main");
    expect(main?.track).toEqual({ ahead: 1, behind: 0 });
  });
});

describe("status", () => {
  test("reports a clean repo with no entries", async () => {
    const { dir } = linear(1);
    const driver = await driverFor(dir);
    const result = await status(driver);
    expect(result.entries).toHaveLength(0);
    expect(result.branch.head).toEqual({ kind: "branch", name: "main" });
  });
});

describe("stashList", () => {
  test("reports a stash entry's base and message", async () => {
    const { dir } = withStash();
    const driver = await driverFor(dir);
    const entries = await stashList(driver);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.message).toContain("On main:");
  });
});

describe("countCommits", () => {
  test("counts commits across all refs vs. just HEAD", async () => {
    // conflicting() leaves branch-theirs unmerged into main (they diverge), so --all sees a
    // commit HEAD alone does not.
    const { dir } = conflicting();
    const driver = await driverFor(dir);
    const all = await countCommits(driver, "all");
    const head = await countCommits(driver, "head");
    expect(all).toBeGreaterThan(head);
  });
});

describe("predictMerge", () => {
  test("a clean merge, cross-checked against an actual executed merge", async () => {
    const { dir, refs: shapeRefs } = linear(1);
    execFileSync("git", ["switch", "--quiet", "-c", "b1"], { cwd: dir });
    execFileSync("git", ["config", "user.name", "T"], { cwd: dir });
    execFileSync("git", ["config", "user.email", "t@t.com"], { cwd: dir });
    execFileSync("git", ["commit", "--quiet", "--no-gpg-sign", "--allow-empty", "-m", "b1"], {
      cwd: dir,
    });
    execFileSync("git", ["switch", "--quiet", "main"], { cwd: dir });

    const driver = await driverFor(dir);
    const main = shapeRefs.main;
    if (main === undefined) throw new Error("expected a main ref");
    const prediction = await predictMerge(driver, main, "b1");
    expect(prediction.kind).toBe("clean");

    // Cross-check: an actual merge in a throwaway clone should also succeed cleanly.
    const cloneDir = `${dir}-clone`;
    execFileSync("git", ["clone", "--quiet", dir, cloneDir]);
    execFileSync("git", ["config", "user.name", "T"], { cwd: cloneDir });
    execFileSync("git", ["config", "user.email", "t@t.com"], { cwd: cloneDir });
    execFileSync("git", ["merge", "--quiet", "--no-gpg-sign", "origin/b1"], { cwd: cloneDir });
  });

  test("a real conflict, cross-checked against an actual executed merge", async () => {
    const { dir, refs: shapeRefs } = conflicting();
    const driver = await driverFor(dir);
    const main = shapeRefs.main;
    const theirs = shapeRefs["branch-theirs"];
    if (main === undefined || theirs === undefined) throw new Error("expected both refs");
    const prediction = await predictMerge(driver, main, theirs);
    expect(prediction.kind).toBe("conflicts");
    if (prediction.kind === "conflicts") {
      expect(prediction.paths).toContain("conflict.txt");
    }

    let actuallyConflicted = false;
    try {
      execFileSync("git", ["merge", "--no-gpg-sign", "branch-theirs"], { cwd: dir });
    } catch {
      actuallyConflicted = true;
    }
    expect(actuallyConflicted).toBe(true);
  });
});

describe("commitDetail", () => {
  test("an ordinary commit's metadata, body and file changes", async () => {
    const { dir, commits } = linear(2);
    const driver = await driverFor(dir);
    const sha = commits[1];
    if (sha === undefined) throw new Error("expected a second commit");
    const detail = await commitDetail(driver, sha);
    expect(detail.sha).toBe(sha);
    expect(detail.signatureStatus).toBe("N");
    expect(detail.files.map((f) => f.path)).toContain("file.txt");
  });

  test("a root commit diffs against the empty tree", async () => {
    const { dir, commits } = linear(1);
    const driver = await driverFor(dir);
    const sha = commits[0];
    if (sha === undefined) throw new Error("expected a commit");
    const detail = await commitDetail(driver, sha);
    expect(detail.parents).toHaveLength(0);
    expect(detail.files.map((f) => f.kind)).toEqual(["added"]);
  });

  test("a rename's file change carries the original path and similarity", async () => {
    const { dir } = linear(1);
    execFileSync("git", ["mv", "file.txt", "renamed.txt"], { cwd: dir });
    execFileSync("git", ["commit", "--quiet", "--no-gpg-sign", "-m", "rename"], {
      cwd: dir,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "T",
        GIT_AUTHOR_EMAIL: "t@t.com",
        GIT_COMMITTER_NAME: "T",
        GIT_COMMITTER_EMAIL: "t@t.com",
      },
    });
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir }).toString("utf8").trim();
    const driver = await driverFor(dir);
    const detail = await commitDetail(driver, sha);
    const renamed = detail.files.find((f) => f.kind === "renamed");
    expect(renamed?.originalPath).toBe("file.txt");
    expect(renamed?.path).toBe("renamed.txt");
    expect(renamed?.similarity).toBeGreaterThan(0);
  });

  test("a merge commit's parent selector picks which parent to diff against", async () => {
    const { dir, refs: shapeRefs } = linear(1);
    const identity = { name: "T", email: "t@t.com" };
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: identity.name,
      GIT_AUTHOR_EMAIL: identity.email,
      GIT_COMMITTER_NAME: identity.name,
      GIT_COMMITTER_EMAIL: identity.email,
    };
    execFileSync("git", ["switch", "--quiet", "-c", "feature"], { cwd: dir });
    execFileSync("node", ["-e", "require('fs').writeFileSync('feature.txt','x\\n')"], { cwd: dir });
    execFileSync("git", ["add", "feature.txt"], { cwd: dir });
    execFileSync("git", ["commit", "--quiet", "--no-gpg-sign", "-m", "feature commit"], {
      cwd: dir,
      env,
    });
    execFileSync("git", ["switch", "--quiet", "main"], { cwd: dir });
    execFileSync(
      "git",
      ["merge", "--quiet", "--no-gpg-sign", "--no-ff", "-m", "merge", "feature"],
      {
        cwd: dir,
        env,
      },
    );
    const mergeSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: dir })
      .toString("utf8")
      .trim();

    const driver = await driverFor(dir);
    // Parent 0 (main, default) never had feature.txt — diffing against it shows the addition.
    const againstMain = await commitDetail(driver, mergeSha);
    expect(againstMain.files.map((f) => f.path)).toContain("feature.txt");
    // Parent 1 (feature) already had feature.txt — diffing against it shows no change to it,
    // proving the selector actually changes which parent is used, not just accepted and ignored.
    const againstFeature = await commitDetail(driver, mergeSha, { parentIndex: 1 });
    expect(againstFeature.files.map((f) => f.path)).not.toContain("feature.txt");
    void shapeRefs;
  });
});
