# v0.2.25

Branch `chapter/v0.2.25`. First `P` is 436 (highest in v0.2.24 is P435). Draft: opens after v0.2.24 merges.

Source: user request. Phases run top to bottom, two phases in parallel where file ownership allows (worktree per stream). Ends with two code review rounds, then close, then PR.

| Phase | Title | Status |
|---|---|---|
| P436 | ADE session tab context menu: close and restart a Claude session | Done |
| P437 | ADE sessions dropdown redesign | Done |
| P438 | Rename Automations to Runs; icon-only module tabs | Done |
| P439 | Kubernetes module (read only) | Done |
| P440 | Kubernetes MCP tools with per-cluster approval | Done |
| P441 | Restore previous Runs scripts and Docker containers after app close: shared dialog | Done |
| P442 | Dependency update, incl. Wails | Done |
| P443 | Slow test audit and speed-up: UI suites wait 30+ min per phase | Todo |
| P444 | Remove CLI credential reads: claude MCP headers | Done |
| P445 | Code review (2 rounds) | Todo |
| P446 | Close chapter v0.2.25 | Todo |

## Rows

### P436 ADE session tab context menu: close and restart a Claude session

- Right click on a session tab in the ADE module offers Close session and Restart session, next to the existing Copy session id.

Result: Close and Restart in the session tab menu beside Copy session ID. Backend `CloseSession` (`closeTUILocked`, `restartHeadless`, `queueResumeLocked` extracted); frontend `useCloseSession`; flow tests and UI spec cover TUI and background tabs. Space `ui` subset 36 passed.

### P437 ADE sessions dropdown redesign

- The sessions dropdown looks ugly and works clunkily. Redesign both looks and interactions.

Result: Sessions dropdown rebuilt as `AdeSessionsMenu`/`List`/`Row` with filter, keyboard and context-menu support; `AdeStopped*` removed; strip scrolls selected tab into view. Script run wording fixed in ADE copy and backend strings. New UI spec (9 tests) and `ade-sessions-menu` visual baseline; `branch-panel-details` baseline re-recorded. Space `ui` 949 passed; `go test` 56 packages ok.

### P438 Rename Automations to Runs; icon-only module tabs

- Module tabs (the mode strip, both apps) show icons only, no labels, to leave room for more modules. Each icon keeps an accessible name and a tooltip with the module name (and shortcut if any); active and attention states stay visible.

- The Automations module is renamed Runs everywhere the user sees it: mode label, tab, panel, dialogs, menus, palette commands, Settings, tooltips, docs.
- Internal identifiers (mode key `automations`, `<app home>/automations/<id>` folders, DB columns, i18n namespace) stay unless the plan finds a safe, worthwhile rename; the plan decides and justifies each.
- Check wording collisions with the existing "run" concept (step runs, script runs, Operations panel history) and resolve them in the copy.

Result: Module tabs icon-only (shadcn-vue tooltip, `aria-label`). Automations reads Runs in UI copy, READMEs, site (`shared/runs` with redirect) and docs; mode key, i18n keys, test IDs and `<app home>/automations` stay. Studio `ui` 681 passed; 2 `ui-timing` failures under load. Full-window baselines moved by the new tabs re-recorded after landing.

### P439 Kubernetes module (read only)

- New read-only Kubernetes module. Host app: Kira Studio next to Docker (the plan confirms or changes this).
- Pick a namespace, pick a resource kind, list resources, view describe and logs.
- Every list, describe and logs view supports filtering.
- UI design consistent with the app, taking its cues from the Studio (database) module.
- Read only: no create, edit, delete, exec or port-forward.

Result: Read-only Kubernetes module in Kira Studio: cluster store (migration 0049), client-go backend (namespaces, kinds, resources, describe with Secret redaction, logs), `KubernetesService` binding, module UI with filtering. Fake HTTPS API server and flow tests; UI spec (9). Binary +25.9 MB; all new Go modules permissive. Studio `ui` 686 of 688 first run; the 2 failures were tab-count asserts, fixed.

### P440 Kubernetes MCP tools with per-cluster approval

- Expose the P439 read operations (list namespaces, kinds, resources; describe; logs) through the Kira Studio DB MCP server, so the AI can request read data.
- A cluster works like a DB connection in the MCP server: per-cluster, per-operation permission (off, ask, allow) for each read operation, plus a free-text description shown to the AI in the list output. Default: ask.
- Off hides the operation's use for that cluster; ask shows an approve dialog per AI request; allow runs without asking.
- Mirror the DB connection `permissions` and `description` model (`dbmcp` `connectionPermissions`, connection `Description`); the plan decides the exact operation groups and UI placement.
- Read only, same as P439: no write, exec or port-forward tools.
- Reuse the existing DB MCP approval flow and P415 op-log origin stamping where they fit; the plan decides.

Result: Kubernetes MCP tools (`kube_list_clusters`, discover, list, describe, logs) in the Studio DB MCP server. Per-cluster description and per-operation off/ask/allow, default ask (migration 0051). Bounded reads, shared approval broker, flow test, settings and approval UI with spec, real `claude` test passes. Contracts regenerated.

### P441 Restore previous Runs scripts and Docker containers after app close: shared dialog

- After the app closes, on next start offer to reopen the scripts that were running in the Runs module, as the Docker module already does for containers.
- Docker and Runs share one dialog component. It lists the previous items, all selected by default; the user deselects any not to restart, then confirms.
- Redesign the dialog: current look is ugly. Tailwind and shadcn-vue primitives; consistent with the app.
- Depends on P438 (Runs naming) and the existing Docker restore flow; the plan finds that flow, extracts the shared dialog, and decides how "was running" is recorded for scripts.
- Docker restore files sit in Kira Studio, Runs code in `packages/workbench/src/automations`: the plan fixes file ownership across the streams.

Result: Shared restore dialog (`packages/workbench/src/restore`) used by Docker and a new Runs restore banner. Scripts running at quit recorded (Studio migration 0050, Space 0061) and offered for restart on next start. Flow, UI and visual tests; Studio `ui` 683/688 first run, failures pass alone.

### P442 Dependency update, incl. Wails

- Update Go modules, JS packages and tool versions across the monorepo to current releases.
- Upgrade Wails to the latest release. Regenerate bindings; fix any API or build changes in both apps.
- Check the license of every changed dependency against the open-source-only rule.
- Run the full suites after the bump (Go, typecheck, lint, UI, visual). Re-record visual baselines only if the upgrade shifts rendering.
- Scope for v0.2.25 is closed after P444: no further phases.

Result: Wails v3.1.0 (runtime lockstep), Go 1.27.3, golangci-lint v2.15 (four gocognit funcs split), Go modules, onnxruntime_go 1.38.0 with ORT 1.31.1, Biome 2.6, JS packages, @babel/parser 8, mutation tools, bun 1.4.4 and actions/cache v6.1.0 (workflow edits as `docs/pending-changes` patches). Deferred: TypeScript 7, backoff v5, go-git v6, flatbuffers 25.12, k8s 0.38, Docker test images. Studio `ui` 707 and Space `ui` 953 passed; 18 visual baselines re-recorded for Playwright 1.64; Go and e2e-real failures only Docker Hub 429 and a pre-existing dockerflow test. Mac packaging and Wails smoke test pending (user-run).

### P443 Slow test audit and speed-up: UI suites wait 30+ min per phase

- PR CI keeps running the full suite. Goal: cut the wait on each phase locally.
- Measure first. Run each UI suite (Studio, Space) once on an idle host with `--reporter=json`. Write the slowest 30 specs per app, plus total time per Playwright project, to a file under `plans/`.
- Static signals to check against the numbers: Studio has 68 `waitForTimeout` calls, Space 17; `workers: 1` projects in the Studio config (perf, budgets); `ade-v2-review.spec.ts` 15 s waits; large files (`ade-v2-workflows`, `api-ui-consistency`, `ade-v2-plan`, `ade-v2-panel`).
- Fix what the numbers show: replace fixed sleeps with condition waits, share setup and builds across specs, trim duplicate coverage, tune worker counts to the host (load-induced timeouts cost reruns).
- Local test selection, only if the numbers justify it: per-app selection (a Studio-only change skips Space specs and the reverse; `packages/**` runs both), path rules from a small hand-kept table, full suite as fallback for unknown paths. A coverage-based spec-to-source map was weighed and deferred; where to store it (gitignored local cache or CI artifact; not committed, not an orphan branch because `.githooks/pre-push` blocks it) stays open.
- Sharding (`--shard`) only if the host has spare cores.
- Before and after suite times recorded in the plan. No loss of coverage: each removed or merged spec is named with the spec that still covers it.
- Standing rule already in `CLAUDE.md`: one full run per phase, targeted reruns after.

### P444 Remove CLI credential reads: claude MCP headers

- Rule (CLAUDE.md, ARCHITECTURE.md "CLI credentials: never touched"): Kira never touches a credential a driven CLI owns. One known violation remains, tracked in Known open items (docker half fixed in v0.2.24 P429 Part 2).
- `internal/harness/claude/usermcp.go` reads `~/.claude.json` `mcpServers`, sends their stored headers (incl. `Authorization`) in `listTools` and copies them into the run's `--mcp-config` file. Replace with a path that never reads or forwards those headers (let `claude` load its own config); the plan decides.
- Extend guard G5 to the claude harness once clean: no `.claude.json` header reads or forwarding.

Result: Kira no longer reads `~/.claude.json` or forwards MCP headers. The picker lists servers from `claude mcp list` (name, transport, host or command name, health status); tool listing is gone and a ticked server grants all tools or named tools (`allTools`). A run that ticks a user server runs with `--setting-sources user` plus `--settings` (`disableAllHooks`, `allowedMcpServers`) and claude loads the server itself; no per-run copy on disk. `HeadlessSpec.UserMCP`/`GrantMCP` are provider-neutral. G5 now covers `internal/harness/claude` (five checks, `sandbox.go` exempt) and fails on the old `usermcp.go`. New Known open item: such a run loads the user's Claude settings. Flow tests (Studio and Space `termflow`, Space `adeflow`) sweep for sentinel credentials; real `claude` subtest passes (0.0011 USD). Studio `ui` 700 passed, 3 unrelated contract specs timed out under load and pass alone; Space `ui` 953 passed.

### P445 Code review (2 rounds)

Two rounds. Each round: one Opus review over the full diff since `main`, findings file under `plans/`, then one Sonnet fixer.

### P446 Close chapter v0.2.25

Hand-written close per CLAUDE.md "Closing a chapter". Push, open PR to `main`.
