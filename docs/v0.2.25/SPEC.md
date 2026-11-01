# v0.2.25

Branch `chapter/v0.2.25`. First `P` is 436 (highest in v0.2.24 is P435). Draft: opens after v0.2.24 merges.

Source: user request. Phases run top to bottom, two phases in parallel where file ownership allows (worktree per stream). Ends with two code review rounds, then close, then PR.

| Phase | Title | Status |
|---|---|---|
| P436 | ADE session tab context menu: close and restart a Claude session | Todo |
| P437 | ADE sessions dropdown redesign | Todo |
| P438 | Rename Automations to Runs; icon-only module tabs | Todo |
| P439 | Kubernetes module (read only) | Todo |
| P440 | Kubernetes MCP tools with per-cluster approval | Todo |
| P441 | Dependency update, incl. Wails | Todo |
| P442 | Slow test audit and speed-up: UI suites wait 30+ min per phase | Todo |
| P443 | Remove CLI credential reads: claude MCP headers | Todo |
| P444 | Code review (2 rounds) | Todo |
| P445 | Close chapter v0.2.25 | Todo |

## Rows

### P436 ADE session tab context menu: close and restart a Claude session

- Right click on a session tab in the ADE module offers Close session and Restart session, next to the existing Copy session id.

### P437 ADE sessions dropdown redesign

- The sessions dropdown looks ugly and works clunkily. Redesign both looks and interactions.

### P438 Rename Automations to Runs; icon-only module tabs

- Module tabs (the mode strip, both apps) show icons only, no labels, to leave room for more modules. Each icon keeps an accessible name and a tooltip with the module name (and shortcut if any); active and attention states stay visible.

- The Automations module is renamed Runs everywhere the user sees it: mode label, tab, panel, dialogs, menus, palette commands, Settings, tooltips, docs.
- Internal identifiers (mode key `automations`, `<app home>/automations/<id>` folders, DB columns, i18n namespace) stay unless the plan finds a safe, worthwhile rename; the plan decides and justifies each.
- Check wording collisions with the existing "run" concept (step runs, script runs, Operations panel history) and resolve them in the copy.

### P439 Kubernetes module (read only)

- New read-only Kubernetes module. Host app: Kira Studio next to Docker (the plan confirms or changes this).
- Pick a namespace, pick a resource kind, list resources, view describe and logs.
- Every list, describe and logs view supports filtering.
- UI design consistent with the app, taking its cues from the Studio (database) module.
- Read only: no create, edit, delete, exec or port-forward.

### P440 Kubernetes MCP tools with per-cluster approval

- Expose the P439 read operations (list namespaces, kinds, resources; describe; logs) through the Kira Studio DB MCP server, so the AI can request read data.
- Per-cluster setting decides whether each AI request shows an approve dialog first or runs without asking. Default: ask.
- Read only, same as P439: no write, exec or port-forward tools.
- Reuse the existing DB MCP approval flow and P415 op-log origin stamping where they fit; the plan decides.

### P441 Dependency update, incl. Wails

- Update Go modules, JS packages and tool versions across the monorepo to current releases.
- Upgrade Wails to the latest release. Regenerate bindings; fix any API or build changes in both apps.
- Check the license of every changed dependency against the open-source-only rule.
- Run the full suites after the bump (Go, typecheck, lint, UI, visual). Re-record visual baselines only if the upgrade shifts rendering.
- Scope for v0.2.25 is closed after P443: no further phases.

### P442 Slow test audit and speed-up: UI suites wait 30+ min per phase

- PR CI keeps running the full suite. Goal: cut the wait on each phase locally.
- Measure first. Run each UI suite (Studio, Space) once on an idle host with `--reporter=json`. Write the slowest 30 specs per app, plus total time per Playwright project, to a file under `plans/`.
- Static signals to check against the numbers: Studio has 68 `waitForTimeout` calls, Space 17; `workers: 1` projects in the Studio config (perf, budgets); `ade-v2-review.spec.ts` 15 s waits; large files (`ade-v2-workflows`, `api-ui-consistency`, `ade-v2-plan`, `ade-v2-panel`).
- Fix what the numbers show: replace fixed sleeps with condition waits, share setup and builds across specs, trim duplicate coverage, tune worker counts to the host (load-induced timeouts cost reruns).
- Local test selection, only if the numbers justify it: per-app selection (a Studio-only change skips Space specs and the reverse; `packages/**` runs both), path rules from a small hand-kept table, full suite as fallback for unknown paths. A coverage-based spec-to-source map was weighed and deferred; where to store it (gitignored local cache or CI artifact; not committed, not an orphan branch because `.githooks/pre-push` blocks it) stays open.
- Sharding (`--shard`) only if the host has spare cores.
- Before and after suite times recorded in the plan. No loss of coverage: each removed or merged spec is named with the spec that still covers it.
- Standing rule already in `CLAUDE.md`: one full run per phase, targeted reruns after.

### P443 Remove CLI credential reads: claude MCP headers

- Rule (CLAUDE.md, ARCHITECTURE.md "CLI credentials: never touched"): Kira never touches a credential a driven CLI owns. One known violation remains, tracked in Known open items (docker half fixed in v0.2.24 P429 Part 2).
- `internal/harness/claude/usermcp.go` reads `~/.claude.json` `mcpServers`, sends their stored headers (incl. `Authorization`) in `listTools` and copies them into the run's `--mcp-config` file. Replace with a path that never reads or forwards those headers (let `claude` load its own config); the plan decides.
- Extend guard G5 to the claude harness once clean: no `.claude.json` header reads or forwarding.

### P444 Code review (2 rounds)

Two rounds. Each round: one Opus review over the full diff since `main`, findings file under `plans/`, then one Sonnet fixer.

### P445 Close chapter v0.2.25

Hand-written close per CLAUDE.md "Closing a chapter". Push, open PR to `main`.
