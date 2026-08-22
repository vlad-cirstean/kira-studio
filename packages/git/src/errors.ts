/**
 * §4.3's typed error union, classified from exit code + stderr pattern matching. Every
 * pattern below was captured from a real, actually-failed git invocation (not invented) —
 * see the pattern comments — except `Conflict`, whose only P1-reachable source
 * (`git cherry-pick`) is verified; `git merge`'s own conflict text goes to *stdout*, not
 * stderr, which this classifier cannot see by design (§4.3 says stderr). That is a known gap
 * for whichever phase (P6+) first routes a real `git merge` through the driver — it will need
 * its own stdout-aware handling, the way `mergeTree.ts` already does for prediction.
 *
 * `GitCancelled` and `GitSpawnFailed` are driver-level, not git-level, and are deliberately
 * kept out of the domain union: a caller superseding its own query must not have to
 * pattern-match a `GitError.kind` to know its read was merely cancelled.
 */

export type GitErrorKind =
  | "AuthFailed"
  | "NonFastForward"
  | "Conflict"
  | "DirtyWorktree"
  | "LockHeld"
  | "NotFound"
  | "HookRejected"
  | "Unknown";

export class GitError extends Error {
  readonly kind: GitErrorKind;
  readonly argv: readonly string[];
  readonly exitCode: number | null;
  /** Preserved verbatim and always surfacable — an `Unknown` classification is only
   *  unactionable if this text is discarded, so it never is. */
  readonly stderr: string;

  constructor(
    kind: GitErrorKind,
    argv: readonly string[],
    exitCode: number | null,
    stderr: string,
  ) {
    const summary = stderr.trim().split("\n")[0] || `exited ${exitCode}`;
    super(`git ${argv.join(" ")} failed (${kind}): ${summary}`);
    this.name = "GitError";
    this.kind = kind;
    this.argv = argv;
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

/** Raised when an in-flight read's `AbortSignal` fires. Never a failure the UI should surface. */
export class GitCancelled extends Error {
  readonly argv: readonly string[];

  constructor(argv: readonly string[]) {
    super(`git ${argv.join(" ")} was cancelled`);
    this.name = "GitCancelled";
    this.argv = argv;
  }
}

/** The git binary itself could not be executed — distinct from any git-reported failure. */
export class GitSpawnFailed extends Error {
  readonly path: string;
  override readonly cause: unknown;

  constructor(path: string, cause: unknown) {
    super(
      `could not spawn git at '${path}': ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = "GitSpawnFailed";
    this.path = path;
    this.cause = cause;
  }
}

interface Pattern {
  readonly kind: GitErrorKind;
  readonly pattern: RegExp;
}

// Ordered most-specific-first: a candidate is checked against each in turn and the first
// match wins, which matters where two kinds' messages could otherwise both mention "rejected".
const PATTERNS: readonly Pattern[] = [
  // "fatal: Unable to create '.../index.lock': File exists." — a stale or contended lock.
  { kind: "LockHeld", pattern: /Unable to create '.*\.lock'.*File exists/s },
  // "! [remote rejected] main -> main (pre-receive hook declined)" — a server-side hook.
  { kind: "HookRejected", pattern: /hook declined/ },
  // "! [rejected]  main -> main (fetch first)" / "(non-fast-forward)" — needs a fetch/rebase.
  { kind: "NonFastForward", pattern: /! \[rejected\]|non-fast-forward/ },
  // GIT_TERMINAL_PROMPT=0 (§4.3) turns a credential prompt into this, always — the realistic
  // auth-failure shape in a driver that never allows an interactive prompt. A credential
  // helper supplying *wrong* creds instead produces "Authentication failed for '<url>'".
  {
    kind: "AuthFailed",
    pattern:
      /terminal prompts disabled|could not read (Username|Password) for|Authentication failed for/,
  },
  // "error: Your local changes to the following files would be overwritten by checkout:"
  { kind: "DirtyWorktree", pattern: /local changes to the following files would be overwritten/ },
  // "fatal: invalid reference: x" / "unknown revision or path" / "did not match any file(s)".
  {
    kind: "NotFound",
    pattern:
      /invalid reference:|unknown revision or path|did not match any file\(s\) known to git|bad revision/,
  },
  // "error: could not apply <sha>... <subject>" (cherry-pick/revert hitting a real conflict).
  { kind: "Conflict", pattern: /could not apply|CONFLICT \(/ },
];

export function classifyGitError(
  argv: readonly string[],
  exitCode: number | null,
  stderr: string,
): GitError {
  for (const { kind, pattern } of PATTERNS) {
    if (pattern.test(stderr)) return new GitError(kind, argv, exitCode, stderr);
  }
  return new GitError("Unknown", argv, exitCode, stderr);
}
