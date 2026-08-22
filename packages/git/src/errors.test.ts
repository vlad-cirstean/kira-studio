import { describe, expect, test } from "bun:test";
import { classifyGitError, GitCancelled, GitError, GitSpawnFailed } from "./errors.ts";

/**
 * Every stderr string below is a real, captured message (see errors.ts's header comment) —
 * generated with the exact commands that produce it: a stale index.lock, `git switch` to an
 * unknown branch, `git show` on a bad sha, `git switch` with changes that would be
 * overwritten, a push to a repo with a rejecting pre-receive hook, a push that has diverged,
 * `GIT_TERMINAL_PROMPT=0` blocking a credential prompt, and a real cherry-pick conflict.
 */

describe("classifyGitError", () => {
  test("LockHeld — a stale index.lock", () => {
    const stderr = [
      "fatal: Unable to create '/tmp/errprobe/.git/index.lock': File exists.",
      "",
      "Another git process seems to be running in this repository, e.g.",
      "an editor opened by 'git commit'. Please make sure all processes",
      "are terminated then try again. If it still fails, a git process",
      "may have crashed in this repository earlier:",
      "remove the file manually to continue.",
    ].join("\n");
    expect(classifyGitError(["commit", "-m", "c1"], 128, stderr).kind).toBe("LockHeld");
  });

  test("NotFound — invalid reference on switch", () => {
    const stderr = "fatal: invalid reference: nonexistent-branch\n";
    expect(classifyGitError(["switch", "nonexistent-branch"], 128, stderr).kind).toBe("NotFound");
  });

  test("NotFound — unknown revision on show", () => {
    const stderr = [
      "fatal: ambiguous argument 'badsha1234': unknown revision or path not in the working tree.",
      "Use '--' to separate paths from revisions, like this:",
      "'git <command> [<revision>...] -- [<file>...]'",
    ].join("\n");
    expect(classifyGitError(["show", "badsha1234"], 128, stderr).kind).toBe("NotFound");
  });

  test("NotFound — pathspec did not match any files", () => {
    const stderr =
      "error: pathspec 'nonexistent-file.txt' did not match any file(s) known to git\n";
    expect(classifyGitError(["checkout", "--", "nonexistent-file.txt"], 1, stderr).kind).toBe(
      "NotFound",
    );
  });

  test("DirtyWorktree — switch would overwrite local changes", () => {
    const stderr = [
      "error: Your local changes to the following files would be overwritten by checkout:",
      "\ta.txt",
      "Please commit your changes or stash them before you switch branches.",
      "Aborting",
    ].join("\n");
    expect(classifyGitError(["switch", "other"], 1, stderr).kind).toBe("DirtyWorktree");
  });

  test("NonFastForward — push rejected, remote has diverged", () => {
    const stderr = [
      "To /tmp/nff.bare",
      " ! [rejected]        main -> main (fetch first)",
      "error: failed to push some refs to '/tmp/nff.bare'",
      "hint: Updates were rejected because the remote contains work that you do not",
      "hint: have locally. This is usually caused by another repository pushing to",
      "hint: the same ref. If you want to integrate the remote changes, use",
      "hint: 'git pull' before pushing again.",
      "hint: See the 'Note about fast-forwards' in 'git push --help' for details.",
    ].join("\n");
    expect(classifyGitError(["push", "origin", "main"], 1, stderr).kind).toBe("NonFastForward");
  });

  test("HookRejected — server-side pre-receive hook declined", () => {
    const stderr = [
      "To /tmp/nff.bare",
      " ! [remote rejected] main -> main (pre-receive hook declined)",
      "error: failed to push some refs to '/tmp/nff.bare'",
    ].join("\n");
    expect(classifyGitError(["push", "origin", "main"], 1, stderr).kind).toBe("HookRejected");
  });

  test("AuthFailed — GIT_TERMINAL_PROMPT=0 blocked a credential prompt", () => {
    const stderr =
      "fatal: could not read Username for 'https://github.com': terminal prompts disabled\n";
    expect(classifyGitError(["ls-remote", "https://github.com/x/y.git"], 128, stderr).kind).toBe(
      "AuthFailed",
    );
  });

  test("AuthFailed — a credential helper supplied wrong credentials", () => {
    const stderr =
      "remote: Invalid username or password.\nfatal: Authentication failed for 'https://example.com/x.git'\n";
    expect(classifyGitError(["fetch", "origin"], 128, stderr).kind).toBe("AuthFailed");
  });

  test("Conflict — a real cherry-pick conflict", () => {
    const stderr = [
      "error: could not apply 264650c... other",
      "hint: After resolving the conflicts, mark them with",
      'hint: "git add/rm <pathspec>", then run',
      'hint: "git cherry-pick --continue".',
      'hint: You can instead skip this commit with "git cherry-pick --skip".',
      'hint: To abort and get back to the state before "git cherry-pick",',
      'hint: run "git cherry-pick --abort".',
    ].join("\n");
    expect(classifyGitError(["cherry-pick", "264650c"], 1, stderr).kind).toBe("Conflict");
  });

  test("Unknown — an unrecognised stderr keeps its text intact", () => {
    const stderr = "fatal: something this classifier has never seen before\n";
    const error = classifyGitError(["frobnicate"], 1, stderr);
    expect(error.kind).toBe("Unknown");
    expect(error.stderr).toBe(stderr);
  });

  test("GitError preserves argv, exit code and raw stderr verbatim", () => {
    const error = classifyGitError(
      ["status", "--porcelain=v2"],
      129,
      "fatal: not a git repository\n",
    );
    expect(error.argv).toEqual(["status", "--porcelain=v2"]);
    expect(error.exitCode).toBe(129);
    expect(error.stderr).toBe("fatal: not a git repository\n");
    expect(error.name).toBe("GitError");
  });
});

describe("GitCancelled / GitSpawnFailed", () => {
  test("GitCancelled is not a GitError and carries no kind", () => {
    const error = new GitCancelled(["log", "--all"]);
    expect(error).not.toBeInstanceOf(GitError);
    expect(error.name).toBe("GitCancelled");
    expect(error.argv).toEqual(["log", "--all"]);
  });

  test("GitSpawnFailed carries the path and the underlying cause", () => {
    const cause = new Error("ENOENT");
    const error = new GitSpawnFailed("/no/such/git", cause);
    expect(error.name).toBe("GitSpawnFailed");
    expect(error.path).toBe("/no/such/git");
    expect(error.cause).toBe(cause);
  });
});
