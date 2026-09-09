// Package gitprepare is the worktree prepare script's own execution seam (G25 D9/D12/D18) — the
// one place in this entire chapter that spawns a shell over a command the app did not build.
// Every other spawn in this codebase passes a fixed argv straight to os/exec with no shell
// involved at all (gitclient's own doc comment says so explicitly); this package is the deliberate,
// narrow exception, and its own safety argument rests on exactly one property: no app-supplied
// value is ever interpolated into the command string. The command string IS the user's own
// command, typed by the user, approved by the user (gitsession's own sha256-pinned approval, D11)
// — not app-generated data being smuggled through a shell. App data (the worktree path, its
// branch, the repo root) reaches the script ONLY through environment variable values, never
// through the command string, so even a maximally adversarial branch name can only ever be a
// word-split-able environment VALUE, never re-parsed as a command.
//
// This package imports nothing beyond the standard library (D18) — it knows nothing about
// repositories, sessions, approval, or settings storage. gitsession/worktree.go owns every policy
// decision (which script, whether it is approved, which paths are legal, the ≤1-per-repository
// slot); this package owns only the mechanism: building the exact argv, building the exact
// environment, and spawning it under the disciplines below. That split is testable: every test in
// this package runs against a fake Runner or pure functions, and gitsession's own tests fake
// Runner in turn — nothing in the whole feature spawns a real shell during `go test`.
//
// # What "sandboxing" actually means here — stated exactly, per D12
//
// There is no container, no seatbelt/AppArmor profile, and no capability dropping anywhere in this
// application. The prepare script runs as the same user, with the same filesystem access, as the
// Kira Studio server process itself. What IS actually implemented, all of it in this package or in
// gitsession's own orchestration around it, is:
//
//   - The working directory is validated against the repository's own `worktree list` output
//     before this package is ever invoked (gitsession) — never spawned against an arbitrary path.
//   - The script never runs implicitly: only right after a creation this app performed, or an
//     explicit user-initiated "Re-run" (gitsession's own policy, never this package's).
//   - An explicit, exhaustive environment scrub-and-add table (script.go) — no git/askpass
//     credential-handle variable is ever inherited into the child.
//   - stdin is closed (never a pty, never the parent's own stdin).
//   - The child runs in its own session (Setsid) so a group signal reaches its own descendants,
//     not just the direct shell process.
//   - A hard 15-minute timeout, unconditional, no setting raises it.
//   - Output is bounded (256 KiB / 500 lines retained) and sanitized (invalid UTF-8 replaced,
//     control bytes and ANSI escape sequences stripped) before it is ever stored or displayed.
//   - This spawn NEVER runs under the repository's own read or write gate (F3) — it can run for
//     minutes without blocking a single read in any other window.
//   - At most one prepare run per repository at a time (gitsession's own slot).
//   - A VS Code workspace-trust gate, extension-side (D14) — defence in depth, not the primary
//     control; the Go server itself has no notion of trust.
//   - The full script text is always shown to the user before an unapproved run (gitsession/the
//     dialog) — this package never runs anything the user has not seen.
//
// What is explicitly NOT true, and never claimed to be true: the script can read/write anywhere
// the server process can, make arbitrary network requests, and run for the full 15 minutes doing
// anything a normal shell command can do. The safety property this feature actually provides is
// narrower and more honest than a sandbox: it is that the app itself never turns untrusted DATA
// into an executed COMMAND. What the user's own approved command then does is the user's own
// responsibility, exactly as it would be typed into a real terminal.
package gitprepare
