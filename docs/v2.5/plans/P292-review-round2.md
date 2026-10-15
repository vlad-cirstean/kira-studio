# P292 code review, round 2

Base: `0de2692c4` (`docs: mark P282 done`), same base as round 1. Head reviewed: `4a98d38f3`
(`docs: mark P291 done`). Scope: full diff since base: P283-P291 plus round-1 fixer commits
`c49bf0647`..`aa3cc4341` (incl. `20c4e6550` trailing-timer flush), all treated as unreviewed.

One reviewer, three dimensions: (1) architecture, structure, security; (2) correctness and business
logic; (3) performance and resources. Findings only. Groups follow file or root cause.

Not re-reported (already in `docs/ARCHITECTURE.md` "Known open items" or recorded gap): loopback ports
under network off, short-lived child denial loss, `~/.claude.json` writable, hooks and build scripts
run unsandboxed later (covers `push_branch` running repo `pre-push` hooks in the app), `~/../x`
passing both path validators.

Severity counts: High 1, Medium 0, Low 4.

## Clean areas

Nothing real found in:
- Round-1 fixes: plain-HTTP 403 in the proxy (`c49bf0647`), `Release` on every Prepare/launch failure path
  (ADE and smart runs), batched denial count with trailing timer (`20c4e6550`; stop flushes and stops the
  timer, delta 0 is a no-op), hub cap past `MaxDenials`, watcher `giveUp` (guarded by `ctx.Err()`, cannot
  clobber a newer loop), vanished-pid attribution by name, `wireBatch` (per-task caches, nil-safe without
  `RunSandbox`), live-task `Reviews()` query, one-statement `MarkSent`.
- Review step engine (P286): send, held rounds, fallback, resume, reply grant, finish. Sent comments stay
  `open`, so a failed launch after `MarkSent` is retried by the next send.
- Return limits (P288): `countReturns`, `FillReturnLimits` on every snapshot read, parser/writer
  round-trip of `max_returns` and legacy `max`, inspector switching review and non-review limits.
- Sandbox git tools: remote checked against `Remotes`, push bound to the run's branch and worktree HEAD,
  protected-branch preflight, lease on force push.
- Memory P285 Parts 2-4 and P291: distill core, bridge, MCP tool (stdio child of a sandboxed claude, so
  the profile applies), `RenderDoc`/`ApplyDoc`, `sourceLocator`, `textloss`.
- P289 prompts, screenshots tooling (no reference to the dropped raw PNGs; site and README use `framed/`
  and `-detail.png`), P290 site.

## Group A: sandbox (`internal/agentsandbox`, `apps/kira-space/internal/ade/sandbox.go`)

### A1. High. Enforced run cannot read its own MCP config

- File: `apps/kira-space/internal/ade/runs.go:670-697` (`Register` and `WriteUserConfig` write into
  `AgentDir`); `apps/kira-space/internal/appwire/wire.go:238` (`AgentDir` = `~/.kira-space/ade/runs`);
  `internal/claudeheadless/mcp.go:354` (config at `<AgentDir>/<run>-<n>.mcp.json`);
  `internal/agentsandbox/profile.go:47-80`; `internal/scriptruns/smart_run.go:49,147`
  (`<Home>/automations-mcp`).
- Defect: profile denies `file-read-data` under `/Users`; allow list has scratch
  (`<AgentDir>/sandbox/<run>`) and cache, not `AgentDir` itself, so `--mcp-config` files are unreadable
  inside `sandbox-exec`.
- Failure: on macOS every enforced run (agent step, review round, rebase, worktree smart run) starts claude,
  which cannot open its `--mcp-config`. Claude exits on the bad config, or runs without `finish_step`,
  `git`, `push_branch` and `reply_review_comment`. Either way no sandboxed run can report. Linux tests use
  the declared-only enforcer, so nothing catches it; golden `testdata/write_main.sb` shows the gap.
- Fix: add the run's config paths to the policy as literal read allows (`Policy.ReadFiles`, emitted as
  `(literal ...)`, not writable), or write the configs under the run scratch dir. Add a generator test:
  every `--mcp-config` path of a sandboxed spec falls under an allow-read rule of its profile.

### A2. Low. `~/.claude` root scripts stay writable

- File: `internal/agentsandbox/profile.go:12-14`, `:99`, `:127-143`.
- Defect: writes to all of `~/.claude` are allowed; denies cover only named config files and extension
  dirs. Scripts a user's `settings.json` points at outside those dirs stay writable.
- Failure: `/statusline` setup writes `~/.claude/statusline-command.sh`, run by every interactive
  session. A sandboxed agent rewrites it; next interactive `claude` runs it unsandboxed. Same class as the
  known `~/.claude.json` item, so Low.
- Fix: invert the rule: allow writes only to the `~/.claude` subdirs the CLI needs (`projects`, `todos`,
  `shell-snapshots`, `statsig`, `session-env` and similar), deny the rest. Else add the gap to the
  `~/.claude.json` known item.

### A3. Low. Absolute home paths pass save, fail every launch

- File: `apps/kira-space/internal/adeflow/parse.go:469-478`; `apps/kira-space/frontend/src/ade/v2/board/stepSandbox.ts:44-55`;
  `internal/agentsandbox/policy.go:181-224`.
- Defect: parser and editor refuse only the `~` spelling of home, `~/Library` and `~/.claude`.
  `ResolvePolicy` refuses the absolute spelling (`/Users/me`, `/Users/me/Library`, `/Users/me/.claude`)
  only at launch.
- Failure: `allow: [/Users/me/Library]` saves clean and shows valid. Every run of the step then fails
  `could not start: agentsandbox: path ... is not allowed`.
- Fix: map a leading home prefix to `~` before `protectedSandboxPath` (parser knows home in-app); send
  home in the workflows `sandbox` support payload so `pathsValid` does the same.

### A4. Low. Toolchain presets grant writes to toolchain binaries

- File: `apps/kira-space/frontend/src/ade/v2/board/stepSandbox.ts:9-14`; `internal/agentsandbox/launch.go:31-46`.
- Defect: presets add write paths `~/go`, `~/.nvm`, `~/.bun`, `~/.cargo`, `~/.rustup`, `~/.pyenv`
  (binary roots). `Env` already redirects Go, npm, bun and pip caches to `sandbox-cache`; toolchain
  roots are readable through `PathPrefixes`.
- Failure: one click on "Node" lets an agent replace `~/.nvm/versions/node/*/bin/node` or a global
  bin; the user runs it unsandboxed later.
- Fix: presets list cache dirs only (`~/.cargo/registry`, `~/.cargo/git`, `~/Library/Caches/go-build`),
  or redirect `CARGO_HOME`-style caches in `Env`; drop the redundant Go/npm/bun/pip entries. Plan
  decision P287; changing it needs the user.

### A5. Low. Runtime probe caches an empty PATH set

- File: `internal/agentsandbox/runtime.go:38-52`, `:88-101`.
- Defect: the probe is cached once claude resolves, even when the login-shell PATH probe timed out
  (5 s) and `PathPrefixes` is empty. `rtMu` is held across the whole probe (up to 20 s).
- Failure: a slow `zsh -l -i` (nvm, conda) on the first launch leaves every later run of the session
  without toolchain reads; `go`/`node` under home fail with read denials until restart.
- Fix: cache only when the PATH probe succeeded (or `SHELL` is unset), else retry that half on the next
  launch.
