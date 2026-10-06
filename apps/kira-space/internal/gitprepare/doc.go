// Package gitprepare spawns user-authored shell scripts: the worktree prepare script, ADE
// setup/stage/deploy scripts and the ADE agent command (via adeagent). Callers pick the script,
// directory and environment; this package owns only the mechanism.
//
// Safety argument: the app never interpolates app data into the command string. The command is
// the user's own text from app settings or workflows, never repo files. App data (worktree path,
// branch, repo root) reaches the script only as environment values.
//
// Guards, all in this package:
//   - Environment scrub (script.go): no git or askpass redirect variable is inherited.
//   - stdin is the null device, never a pty.
//   - Setsid, so a group signal reaches descendants; SIGKILL to the whole group after timeout.
//   - Spec.Timeout is required; callers choose it (worktree prepare reads a per-repo setting).
//   - Output is sanitized (invalid UTF-8, control bytes, ANSI escapes) and capped at 256 KiB and
//     500 lines retained.
//   - OnBatch is never called after Run returns.
//
// Guards that live in callers, not here:
//   - gitsession/worktree.go: directory validated against `worktree list`, sha256 staleness guard
//     against the text the client showed, at most one run per repository, no repository gate held.
//   - Confirmation dialog and workspace trust: extension-side.
//   - ade: one setup claim per branch, independent of gitsession's slot, so several runs can
//     overlap; no sha256 check, since ADE runs the stored script on branch creation and launch.
//
// There is no container, seatbelt or capability dropping. The script runs as the server's user
// with its filesystem and network access. Tests here spawn /bin/sh with an explicit minimal
// environment.
package gitprepare
