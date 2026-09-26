# Kira Studio — v2.0

v1.9 closed with `P125` (root `README.md` rewritten as a user-facing entry point); every row
P96-P125 landed, none open (`docs/v1.9/SPEC.md`'s own closing note). This chapter continues `P`
numbering (`P126`+) rather than taking a fresh letter, per `CLAUDE.md`'s one-running-sequence rule.
The major version marks what P127-P129 build toward: Kira Space takes over Claude Code agent work
from Kira Studio — spawning agents, tracking their activity, and queueing their merges across git
worktrees — on a module system of its own.

**Two independent workstreams, one explicit, user-instructed deviation from `CLAUDE.md`'s
one-phase-at-a-time rule — recorded here so it isn't silently generalized.** P126 stands alone and
runs in parallel with P127. P127, P128 and P129 form a strict sequential chain: each starts only
after the previous one lands. The two workstreams own disjoint files (P126 the appearance/font-size
pipeline, P127 agent monitoring); whichever lands second rebases onto the other.

**P130-P133 were added after the chain was opened, from four user requests.** P130 and P131 have
no dependency on P127-P129 and touch no file the chain touches except where each row says so. They
are parallel-safe, but they run alongside the chain only on explicit user instruction, like P126;
the default is `P` order. P132 and P133 need P128's shared terminal module and Kira Space shell
changes first.

| Phase | Deliverable | Why here |
|---|---|---|
| **P126 Kira Space "Data font size" renders much smaller than set — find the cause live, then fix it** | User-reported: in `apps/kira-space`, Settings' "Data font size" (`packages/workbench/src/settings/fields/FontSizeField.vue`) set to 12 renders visibly much smaller than 12px. Three static research passes traced the whole pipeline — `packages/shared/domain/settings.ts` to `apps/kira-space/frontend/src/state/settingsDomain.ts` to `packages/workbench/src/state/createSettingsStore.ts`'s `applyAppearance()` to `packages/theme/src/tokens.css`'s `--kira-font-size`/`--kira-t-*` scale to the Monaco/xterm/`git-ui` consumers — and found it unit-correct: px throughout, no rem/em, no zoom/transform, no divide/multiply. The only quantifiable gap is P123's intentional 1-2px chrome-vs-data text-role split (`docs/v1.9/plans/P123-font-size-normalization.md`), far too small to explain "much smaller". Static tracing did not find the defect, so **this phase's plan and implementation start with a live runtime check, not another code read**: launch Kira Space (`bun run dev:space`, per `docs/DEV_ENVIRONMENT.md`'s Kira Space and Wails sections, or the `run` skill), open Settings, set Data font size to 12, then read `getComputedStyle` on the visibly-small text node and walk its cascade to the rule actually applied. Fix the cause found there, never an assumed one. Acceptance: root cause plus before/after computed-style evidence recorded in the result section; that same node computes to the configured size after the fix; a `test:ui:space` assertion on its computed font size guards it, same shape as Kira Studio's `tests/ui/control-sizing.spec.ts` | User-reported bug whose static diagnosis is exhausted — the next step is a runtime probe. Independent of P127-P129; runs in parallel with P127 as its own workstream, no shared files |
| **P127 Extract agent-activity monitoring into a shared package; Kira Studio stops consuming it** | P86 (`docs/v1.8/SPEC.md`'s P85/P86 rows and result sections) built Claude Code hook monitoring inside Kira Studio: the Go hook listener `apps/kira-studio/internal/agenthooks/{agenthooks,config,http,shim}.go` that Claude Code's own hooks POST to (`SessionStart`/`PreToolUse`/`PostToolUse`/`Notification`/`Stop`/`SessionEnd`), its bound surface `apps/kira-studio/internal/bridge/agenthooks.go`, the `AgentHooks` collaborator on `bridge/terminal.go`'s `TerminalService`; wire types in `packages/shared/domain/agent.ts` (`AgentSession`, `AgentEvent`, `AgentPhase`, `AgentActivity`); the Pinia store plus `reduceAgentActivity` in `apps/kira-studio/frontend/src/state/agentSessions.ts`, unit-tested by `apps/kira-studio/tests/unit/agent-activity-reducer.spec.ts`; the `ChannelAgentSessions` event (`bridge/events.go`, `packages/shared/protocol/events.ts`). The live agent-session registry is already shared: repo-root `internal/terminal/session.go`'s `Registry.AgentSessions`/`OnChange`. **User decision: extract as a shared package, used for now only from Kira Space; Kira Studio stops using it.** (1) Move the Go listener to a shared Go home (repo-root `internal/`, beside `internal/terminal` — the P100/P103 hoist precedent) and the reducer/store to a shared TS package (`packages/workbench`'s `create*Store` factory pattern, or a new `packages/agent-monitor`); the planning pass picks per existing package boundaries and records why. The reducer spec moves with the reducer. No Kira Studio coupling left: no Studio settings leaf, bridge import or `control` binding hard-wired — the host app injects its own settings, emitter and bridge seams. Exported and documented, consumable by one import plus configuration. (2) Remove every Kira Studio consumer: `workbench/StatusBar.vue`'s agent widget, `workbench/settings/ClaudeCodePane.vue`'s hooks toggle (hosted by `SettingsDialog.vue`), `state/agentHooks.ts`, `state/agentSessions.ts` and `main.ts`'s `initAgentSessions` boot call, `workbench/host.ts`'s terminal-tab attention badge, `views/terminal/TerminalView.vue`'s hooks-enable path, `bridge/agenthooks.go`, `TerminalService.AgentHooks` and `main.go`'s wiring, plus any `claudeCode` settings leaf left orphaned. The planning pass builds the full inventory with `codegraph_explore` rather than trusting this list. One coupling needs an explicit call in the plan: Studio's P87 keep-awake agent reason (`bridge/keepawake.go`'s `KeepAwakeAgentSessionsChanged`, `ClaudeCode.KeepAwakeWithAgents`) reads the terminal registry's agent count, not the hooks — the plan states whether it stays or goes, and why. (3) Not wired into Kira Space's UI; P129 does that. Acceptance: Kira Studio lints, typechecks, builds and passes its suites with no reference to the moved code; the shared package imports nothing from `apps/`; both apps' `internal/layering_test.go` pass | First link of the P127-P129 chain; runs in parallel with P126. P129's `ade` module consumes this package, so it lands first. Removing Studio's `AgentHooks` composition from `bridge/terminal.go` also clears P128's terminal extraction |
| **P128 Kira Space module system; terminal module shared by both apps; `ade` slot registered** | Kira Space has no module system. Mirror Kira Studio's: `packages/shared/domain/mode.ts`'s `AppMode`, `apps/kira-studio/frontend/src/workbench/modes.ts`'s `MODES: Record<AppMode, ModeDef>` registry (one panel and one start component per module), `state/mode.ts`'s persisted per-window mode. (1) **Registry.** Kira Space gets its own mode union and `MODES` registry. `ModeDef` and the mode-switch plumbing hoist to `packages/workbench` where both apps can share them without special-casing (P103's shared-app-base precedent). Adding a module means one registry entry, its panel/start components, and a Go-side transport only if it needs one — never scattered per-module branches through either app. (2) **`git` module.** Formalize Kira Space's existing git workspace as its registered `git` module. No behavior change. (3) **`terminal` module, extracted once and shared, not re-implemented per app.** Move `apps/kira-studio/frontend/src/terminal/{TerminalPanel,TerminalStart}.vue` into a shared package beside what is already shared (`packages/workbench/src/terminal/*`, `state/createTerminalsStore.ts`, `state/createTerminalTabs.ts`). The Go PTY layer already lives at repo-root `internal/terminal` (P103 Part 3); the two per-app bound surfaces (`apps/kira-studio/internal/bridge/terminal.go`, `apps/kira-space/internal/bridge/terminal.go`), which differ mainly by P86's `AgentHooks` composition P127 removes, converge into one shared surface. Kira Studio imports the shared module with no behavior change; Kira Space registers the same implementation as its own `terminal` module. `TerminalPanel.vue`'s Studio-only custom-scripts coupling (`state/customScripts`, P85) becomes an optional injected seam, not a hard import. The plan states whether Kira Space's existing in-repo terminal tab (`views/repo/RepoTerminalView.vue`) folds into the shared module or stays. (4) **`ade` slot.** Register a placeholder entry (label, icon, empty-state panel/start) with no functionality. Acceptance: both apps' `test:ui` suites pass unchanged for existing surfaces; Kira Studio's terminal behaves exactly as before; the `ade` entry touches only the registry and its own components | Second link: starts only after P127 lands, since P127 strips the `AgentHooks` difference between the two terminal bridges. Same one-implementation-many-consumers pattern as P127. P129 needs the `ade` slot to live in |
| **P129 `ade` module: agent merge queue in Kira Space** | Implement the `ade` module — a UI for running many Claude Code CLI agents in parallel across git worktrees, tracking merge order, stacking and conflicts — per the user-supplied design `docs/v2.0/design/SPEC.md` and the approved mockup `docs/v2.0/design/mockup.html` (both placed before this phase's planning pass). **User instruction: adapt the mock's visual style to Kira Space's existing theme (`packages/theme` tokens, shadcn-vue components); follow the mock exactly for everything else** — markup structure, data model, interaction logic and behavior. Kira Space spawns the agents (user decision) and tracks each session through P127's shared agent-monitoring package, wired into P128's `ade` registry slot. Git operations reuse Kira Space's existing git session/worktree layer, not a parallel path. The planning pass reads both design documents in full; scope comes from them, not this row. Acceptance: every behavior in the design spec implemented; a live Kira Space run compared against `mockup.html` screen by screen, differing only in theme-adapted visual tokens | Last link: needs P127's package and P128's registry slot. The only phase that needs the design documents |
| **P130 Focused input flashes a white ring before turning blue** | User-reported: clicking a text input shows a white border for a fraction of a second, then the blue focus colour. Cause, found by source reading plus Tailwind 4.3.3's compiled `transition-colors` property list: `packages/theme/src/base.css:192-201` gives every `:focus-visible` element P122's one focus ring, `outline: var(--kira-border-width) solid var(--kira-focus)`. `inputVariants` (`packages/theme/src/components/ui/input/index.ts:12`) carries `transition-colors`, and Tailwind v4's list for it includes `outline-color`. Unfocused, `outline-color` sits at its initial `currentcolor`: `--kira-fg` (`base.css:217`), near-white on the dark theme. On focus, `outline-style` flips to `solid` at once while `outline-color` animates from that white to `--kira-focus` over Tailwind's default 150ms. A text input matches `:focus-visible` on mouse click, so every click shows it. The border's own `border-strong`-to-`focus` transition (grey to blue) is not the white. Same pairing in `textarea/Textarea.vue:24`, `input-group/index.ts`'s `default` variant (the fieldset's `has-[…:focus-visible]:focus-ring` plus `transition-colors`), and on keyboard focus in `button/index.ts`, `toggle/index.ts` and `checkbox/Checkbox.vue`. Fix once, at the ring, not per component: the ring's colour must never animate from `currentcolor` — e.g. a base-layer `outline-color: var(--kira-focus)` so the transition has nothing to interpolate, or `outline-color` dropped from those components' transition lists. The plan picks one and says why. Both apps inherit the fix through `packages/theme`. Acceptance: the plan's live check confirms the mechanism first, since this research pass had no display: `getComputedStyle(input).outlineColor`, sampled right after `focus()`, reads interpolated or white before the fix and `--kira-focus` after; a `test:ui` assertion on that sample guards it, in both apps' suites | Independent of P127-P129; touches only `packages/theme`'s focus/transition rules. P126 may touch `packages/theme`'s font-size tokens; disjoint rules, and whichever lands second rebases. First of P130-P133: smallest, and P131's migrated git-ui controls then inherit the fixed ring |
| **P131 Git graph and review view onto shadcn-vue** | User-reported: the git graph "doesn't seem to use shadcn at all", probably the review tab too. **Premise correction:** neither is hand-rolled markup. Both use `packages/kira-ui`'s `Kui*` primitives, and `kira-ui` is not a shadcn-vue wrapper: it is its own cva-plus-Floating-UI component set with no `reka-ui` dependency (`packages/kira-ui/package.json`, `src/index.ts`). shadcn-vue lives in `packages/theme/src/components/ui/*`. **Why it diverged:** P104's plan excluded `git-ui`/`kira-ui` because neither had a Tailwind build then (`docs/v1.9/plans/P104-primitive-swap.md:160-162`). P110 A1 later gave `git-ui` its `kv:`-prefixed build (`packages/git-ui/src/theme/tailwind.css:1-30`) but never revisited the component swap. The prefix is a collision guard, not the cause: `git-ui` mounts inside Kira Space's document, beside Kira Space's own unprefixed root. The real constraint is the second host. `git-ui` also renders the graph and review views in the VS Code extension's webview (`apps/kira-space-vscode/src/webview/main.ts`), which has no `--kira-*` tokens and no `packages/theme` Tailwind root (`docs/ARCHITECTURE.md`'s "never `--kira-*`" note on `git-ui`'s checkbox rule). **Inventory** (`packages/git-ui/src`, 43 `.vue` files plus `refBadges.ts`): `KuiButton` 122, `v-kui-tooltip` 81, `KuiDialog` 15, `KuiSelect` 7, `KuiSearchInput` 7, `KuiSegmented` 6, `KuiMenuList` 6, `data-kui-tip` 5, `KuiColumnResizeHandle` 5, `KuiPopoverPanel` 4, `KuiContextMenu` 3, `KuiTooltip` 2, `KuiTextInput` 2. "The graph" is `App.vue`'s whole tree: toolbar, ref lists, detail panes, 14 dialogs. The review view is `components/review/*.vue`: `ReviewView.vue` 19 uses, `ReviewCommentsPane.vue` 9, `BaseSelector.vue` 6, `ReviewCommitRow.vue` 4, `ReviewFilesPane.vue` 1. `CommitGrid.vue` itself holds only three `KuiColumnResizeHandle`s (lines 1275, 1284, 1294). Everything else in it is SlickGrid DOM: ref/PR badges built as raw elements in `refBadges.ts` (`buildPrBadge` :289, `buildRefBadges` :321), styled by `.kv-badge*` CSS (`CommitGrid.vue:1557-1700`), with tooltips through kira-ui's delegated `data-kui-tip`. **Scope:** (1) Settle first how shadcn's unprefixed utilities and tokens reach both hosts. In Kira Space, `packages/theme/src/base.css:23` already scans the components, but `git-ui` call-site class overrides need scanning too, and `tailwind-merge` cannot resolve a `kv:` override against an unprefixed base. The VS Code webview needs its own root for the shadcn components plus a `--vscode-*`-to-shadcn token bridge, the reverse of `packages/theme/src/vscode-bridge.css`. The plan decides and records it. (2) Swap every `Kui*` call site in the files above for its `packages/theme` counterpart (Button, Tooltip, Dialog, NativeSelect/DropdownMenu, Input/InputGroup, ToggleGroup, Popover). The plan maps each component. (3) SlickGrid cells cannot mount a Vue component per row. Badges take shadcn's `badgeVariants` classes (`packages/theme/src/components/ui/badge/index.ts:11`). Cell tooltips go through one shadcn Tooltip driven by P104's `packages/workbench/src/components/TooltipAnchorBridge.vue` pattern, built for exactly SlickGrid's DOM. (4) `KuiColumnResizeHandle` has no shadcn counterpart (Resizable is a panel splitter), so it stays. The `kv:` token scale stays for sizing and theming. Delete each `Kui*` component left with no consumer; `apps/kira-studio/frontend/src/views/stream/StreamView.vue` and `packages/workbench/src/util/floatingPosition.ts` still import `kira-ui`. Acceptance: no `Kui*` import left in `git-ui` except `KuiColumnResizeHandle`. `test:ui:space`, `test:webview` and `test:unit` pass. A live Kira Space run and a VS Code webview run of graph and review both show shadcn controls, each in its own host's theme | Independent of P127-P129 in dependencies. **Overlap risk with P129:** P131 rewrites nearly every `git-ui` `.vue` file. If P129's `ade` module mounts or imports any `git-ui` component, never run the two concurrently — P131 goes wholly before P129 starts or after it lands. After P130: both touch `packages/theme`, and migrated inputs then inherit the fixed ring. Largest of P130-P133; the plan may split it into parts (graph, review, dialogs) under `CLAUDE.md`'s part naming |
| **P132 Operations panel: shared component, full-width dock, and a Kira Space op log** | The Operations panel is Kira Studio's op-log dock: `apps/kira-studio/frontend/src/workbench/panels/OperationsPanel.vue` (427 lines) over `state/ops.ts`'s store and `packages/shared/domain/ops.ts`'s `OpRecord`. It is mounted through the shared shell's `#dock` slot (`packages/workbench/src/components/WorkbenchShell.vue:193-205`) and toggled from `workbench/TitleBar.vue:98-105`, the `view.toggleOperationsPanel` shortcut (`packages/shared/domain/shortcuts.ts:28`, Cmd+J) and the Go menu (`App.vue:81`). **Layout bug, cause found:** the ops panel sits nested inside main's own `ResizablePanel` (`WorkbenchShell.vue:169-206`), so it spans only main's column. Instead of extending under the project panel, it gives the project panel a `margin-bottom` of the ops height (`opsMarginPx`, lines 118-121 and 154), leaving blank chrome under the left panel. The file's own comment (lines 25-32) claims this matches the pre-P104 CSS grid, where ops spanned the full width; it does not. The obvious fix, an outer vertical group, is the nesting lines 14-23 record as hanging the render process under reka-ui, never root-caused (now `reka-ui` 2.10.5, root `package.json:108`). The plan either re-proves that nesting against 2.10.5 behind the same `tree.spec.ts`/`interaction.spec.ts`/`leaks.spec.ts` gate, or moves the dock out of the horizontal group into a full-width flex sibling with its own px-height resize handle, dropping the margin hack. Evidence for the choice is recorded. (1) **Extract.** The panel shell (virtualized list, status filter, expand-to-detail, cancel, copy) and a `create*Store` factory move into `packages/workbench`. Studio-only behaviour becomes injected seams: console re-run, reveal tab, connection colour, SQL-dialect detail through `MonacoHost`, `ensureConnectedOnce`. The record contract is generalized off `OpKind`'s DB-specific enum. `toggleOperationsPanel`/`setOperationsHeight` hoist from `apps/kira-studio/frontend/src/state/layout.ts:7-17` into `createLayoutStore`; the shared `Layout` schema already carries `panel.operations` (`packages/shared/domain/layout.ts:13,43`). Kira Studio behaves as before, bar the width fix. (2) **Fix the full-width bug**, per the choice above. (3) **Kira Space.** It has no op log at all (`apps/kira-space/frontend/src/state/layout.ts:6-8`, `TitleBar.vue:11-12`). The producer is Kira Space's user-initiated git operations — `gitsession.RepoEntry.RunOp`/`UndoRun` (`apps/kira-space/internal/gitsession/ops.go:1157,1266`) and the remote ops in `gitsession/remote.go` — not `gitclient.Runner`, whose every read spawn would flood the list. Wire the `#dock` slot, a title-bar toggle, and a local Cmd+J binding (Kira Space binds shortcuts by keydown, `workbench/WorkbenchShell.vue:30`). The plan decides persisted versus in-memory history; Studio's is SQLite `op_log` with pruning. Acceptance: a `test:ui` bounding-box assertion that the dock's left edge equals the project panel's left edge in both apps; both apps' suites pass; Studio's existing ops coverage (`tests/ui/operations.spec.ts`, `tests/unit/ops-*.spec.ts`) moves with the code | The dock is workbench chrome, not a module panel, so P128's module system is not a dependency. The overlap is in files: P128 rewrites Kira Space's `workbench/WorkbenchShell.vue` (module panel lookup) and `TitleBar.vue` (mode switcher), the same two files part (3) edits, so P132 runs after P128. P129 also edits `apps/kira-space/main.go`, `internal/bridge/events.go` and `frontend/src/main.ts`; run P132 after P129 (default order) or, on user instruction, alongside it and expect rebase conflicts there |
| **P133 Custom scripts configured only from the terminal module; Settings' Scripts pane removed** | User: scripts are only used from the terminal module, so configure them there, not in the app Settings dialog. **Current state:** the only launch surface is the Terminal module's "Quick commands" panel (`apps/kira-studio/frontend/src/terminal/TerminalPanel.vue:98-104`). The tab strip's "+" no longer lists scripts: `workbench/WorkbenchShell.vue:40-53` offers "Terminal" only, and the `'script'` launch kind is set only at `TerminalPanel.vue:102`. That makes the tab-strip copy stale at `ScriptsPane.vue:142,213`, `TerminalPanel.vue:109` and `internal/storage/model/customscript.go:10`. The panel already adds (lines 79-93) and removes (lines 107-113) inline. Only full editing (rename, command, working directory, colour) deep-links to `Settings > Scripts`, through "Manage scripts…" (lines 158-164) and "Edit…" (lines 118-124). P91 §11.3's stated reason: a 180-480px panel cannot hold four labelled fields legibly (`TerminalPanel.vue:25-27`). **Decision:** move the configuration UI into the shared terminal module, not just delete the pane. Deleting alone would strand renaming, working directory and colour, which exist nowhere else. Add a shadcn Dialog edit form, launched from the panel's "Edit…" and a replacement for "Manage scripts…", carrying `ScriptsPane.vue`'s field rules (blur-commit, empty-reverts, rejected-edit revert, immediate colour). This answers P91's width concern without a Settings detour. Storage stays per app, behind P128's optional custom-scripts seam, which grows from list/create/remove to include update: Kira Studio keeps its `custom_scripts` table, `internal/bridge/customscripts.go` and `state/customScripts.ts` unchanged. Kira Space gains no script storage here, since that was not asked; its terminal module keeps no Quick commands section until a later phase injects a store. Remove `workbench/settings/ScriptsPane.vue`, its mount (`SettingsDialog.vue:15,89-90`) and the `'Scripts'` section (`state/settings.ts:17`, plus the header comment at lines 6-11), and prune stale comments (`packages/workbench/src/components/SettingsShell.vue:63,132`, `state/createSettingsStore.ts:71`). `openSettingsAt` stays; the Api panes still call it. Move `tests/ui/settings-scripts.spec.ts`'s coverage into `tests/ui/terminal-module.spec.ts`, and drop `'Scripts'` from `tests/visual/settings.spec.ts:13`. Acceptance: no Settings reference to scripts in either app; every script field editable from the terminal module; Kira Studio's suites pass | Needs P128: the shared terminal module and its custom-scripts seam must exist, because this phase edits the shared `TerminalPanel` P128 creates, not Studio's current copy. After P128 in dependencies. Default order puts it after P129, which it does not overlap. Last of P130-P133 |
| **P134 Fix intermittent flake in api-secret-reveal-isolation.spec.ts** | Pre-existing flake, found and left unfixed by P128 per `CLAUDE.md`'s own exception clause (a different subsystem, not this phase's design decision to make). `apps/kira-studio/tests/ui/api-secret-reveal-isolation.spec.ts:63`'s `.uncheck()` on the Variables dialog's secret checkbox (`data-testid="variable-secret"`, `VariableRow.vue`, a `packages/theme` `Checkbox` over reka-ui's `CheckboxRoot` — a role-based ARIA toggle, not a native `<input>`) fails intermittently with `locator.uncheck: Clicking the checkbox did not change its state`. Confirmed via `git stash` against the commit before P128 landed that it reproduces identically with none of P128's changes applied, and via `--repeat-each=3` that it fails roughly 2 times in 3 — a real, reproducible flake, not a one-off. **Starting hypothesis for whoever picks this up, not yet root-caused live:** a genuine race between the click and the checkbox's visible postcondition. Unticking fires `onUpdateSecret` (`VariableSetView.vue:380`), which first `await`s `revealVariable` (`state/variables.ts:665`, itself an IPC round-trip via `runReveal`, `reveal.ts:16`) before setting `draft.isSecret = false` and `await`ing `commitDraft`'s own separate `upsertVariable` IPC call (`VariableSetView.vue:391-397`) — the checkbox's own `aria-checked` only flips once that two-hop async chain resolves and the row re-renders from the refreshed query, not synchronously on click. Playwright's `.uncheck()` clicks once and verifies the checked-state postcondition without waiting out a multi-hop async chain, so any slow tick in that chain reads as "did not change its state" even though it later does settle. The same spec file's own second test (line 185) already documents dropping `.uncheck()` for a plain `.click()` on this exact checkbox for a related reason, calling it out explicitly as "a controlled ARIA toggle, not a native input" whose postcondition a plain click doesn't assert — line 63's test never received that same fix. Whoever picks this up confirms the mechanism with a live run first (per `CLAUDE.md`'s own rule for this class of bug), then fixes at whichever layer the live check actually shows is wrong — most likely the test's own wait/assertion shape, not real app behaviour, unless the live check finds an actual bug in the checkbox or the reveal chain. Acceptance: the test passes 20/20 consecutive runs under `--repeat-each=20`; any fix preserves the test's own cross-dialog re-auth isolation guarantee rather than weakening it to hide the flake | Independent of every other phase, no dependency either direction. Pre-existing before P128, in a subsystem (the Api client's Variables-dialog secret-reveal UI) none of P126-P133 touches — confirmed via `git stash` against the commit before P128 landed. Runs whenever picked up; nothing here blocks or is blocked by P126-P133 |

## Layout

- **`SPEC.md`** — this file, one row per phase, updated as phases land or split.
- **`plans/`** — one implementation plan per phase, committed before that phase's implementation
  starts, written by an Opus subagent per `CLAUDE.md`'s own process, never edited afterward.
- **`design/`** — P129's user-supplied design spec and approved mockup.

## P127 result

Plan: `docs/v2.0/plans/P127-agent-monitor-extraction.md`. One Opus planning pass, one sequential
Sonnet implementer, no stream split (the plan's own §3: one continuous, order-dependent chain).
11 commits, `4a8ec2b9`..`29240de1` plus this result commit (`git log --oneline
21cd546e..29240de1`); two unrelated docs commits from a concurrent background task
(`4d75e78f`/`c6af1850`) land interleaved and touch none of this phase's files.

**Commits, in the plan's own §4 order, plus one unplanned fixup:**

1. `4a8ec2b9` — move the hook listener to repo-root `internal/agenthooks` (`git mv`, import fixes
   in `bridge/agenthooks.go`/`bridge/terminal.go`, app-neutral package/shim comments).
2. `d3271a1f` — add `agenthooks.Manager` (start/stop/status, `ComposeLaunch` for the `--settings`
   flag and hook env), `New` now quotes the settings path once so `ComposeLaunch` has no error
   path; Studio's `AgentHooksService` rewired onto it, behaviour unchanged.
3. `6c12720d` — split `agentActivity.ts` (the reducer) out of `createAgentSessionsStore.ts` (the
   store), both moved from Studio's `state/agentSessions.ts` to `packages/workbench/src/state/`;
   the reducer spec moved with it (`git mv`), a `biome.json` rule bans `@bindings*` imports from
   `packages/workbench`.
4. `2370dbee` — pre-existing bug fix folded in per the task: `Stop` now clears `toolName` too (P86
   §13 rule 4, "clears everything"), with the missing assertion added to the reducer spec.
5. `c2dc2a14` — every Kira Studio UI/state consumer removed: `StatusBar.vue`'s agent widget,
   `ClaudeCodePane.vue`'s hooks toggle, `host.ts`'s tab-attention wiring, `TerminalView.vue`'s
   hooks banner, `state/agentHooks.ts`/`state/agentSessions.ts` deleted, `main.ts`'s boot call
   removed, matching UI/IPC test fixtures updated.
6. `d20bc970` — the Go bridge surface dropped: `bridge/agenthooks.go` deleted,
   `TerminalService` loses `AgentHooks`/the sessions projection/`AgentSessions()`/
   `TerminalAgentSessionsChanged`, the two channel constants hoist to `internal/appevent`,
   `main.go` rewired; bindings regenerated (28 → 27 services). Kira Space's own comments touched
   only to stop describing Studio as still having hooks.
7. `a3dcce73` — `claudeCode.hooksEnabled`/`hooksPromptDismissed` dropped from
   `ClaudeCodeSettings`/`ClaudeCodePatch` (Go) and `claudeCodeSettingsSchema` (TS); migration
   `0029` deletes both rows from an existing `settings` table.
8. `309f5b45` — `settings-claude-code-visual-linux.png` re-recorded (only the keep-awake checkbox
   remains), confirmed against an untouched `P127_START` run first.
9. `5fe34502` — `docs/ARCHITECTURE.md`: bound-service count 28 → 27 with the terminal surface's
   own count now two (`AgentHooksService` gone); the stale "nineteen"
   `appcore.Deps`-embedding claim corrected to a re-measured twenty-one; a new paragraph on the
   shared `internal/agenthooks` package and what a host still supplies; one sentence on repo-root
   `internal/` sitting outside both `layering_test.go` scopes.
10. `29240de1` — **unplanned fixup**, found running the closing audit below: six explanatory
    comments (in `settings.go`, `settingsDomain.ts`, `events.go`, `keepawake.go`, `embedded.go`,
    `StatusBar.vue`) named the moved-out feature using the exact identifiers §6's own audit greps
    for (`agenthooks`, `AgentHooksService`, `hooksEnabled`, `hooksPromptDismissed`,
    `ChannelAgent*`, `agent-sessions`) — reworded to describe it generically; meaning unchanged.

**What landed**, matching the plan's own §1/§2 scope. `internal/agenthooks` (`Manager`, `Event`,
the socket protocol, its documented bounds unchanged) is a shared, host-neutral Go package now,
importable from either app under Go's own `internal/` visibility rule without importing anything
back from `apps/`. The reducer and Pinia-store factory live at
`packages/workbench/src/state/{agentActivity,createAgentSessionsStore}.ts`. Wire types stayed put
at `packages/shared/domain/agent.ts` — already shared since P86, nothing to move. The two
event-channel strings hoisted to `internal/appevent`. Kira Studio consumes none of it: no settings
leaf, no bound service, no store, no UI reference anywhere. Keep-awake's own agent-aware reason
(`ClaudeCode.KeepAwakeWithAgents`, `KeepAwakeAgentSessionsChanged`) is untouched and confirmed to
read only `internal/terminal`'s own registry count (`OpenParams.Agent`), never the session
monitor — exactly the §2.5 call the plan asked for. Nothing wires the shared package into Kira
Space's UI yet, by design; that is P129's job.

**Closing audit (plan §6), final state, all 7 checks:**

| Check | Result |
|---|---|
| Kira Studio references none of the moved/removed code | Only `internal/storage/migrations/0029_*.sql`'s own literal settings keys, as expected. (First pass also matched six explanatory comments; fixed in commit 10 above, re-run clean.) |
| Shared Go imports nothing from `apps/` | Empty |
| Shared TS imports nothing from `apps/` or bindings | Empty |
| Channel strings: one Go, one TS copy | `internal/appevent/appevent.go` and `packages/shared/protocol/events.ts` only |
| No dead binding import | Empty |
| Kira Space: comments only | One legitimate exception: both apps' `tsconfig.tests.json` gained the same `"../../packages/workbench/src/**/*.spec.ts"` exclude line — needed because the moved reducer spec is a `bun:test` file under a `types: ["node"]` project (same precedent as the existing `testing/unit/**` exclude), not a comment and not a behavior change |
| Keep-awake intact | `main.go`'s `OnChange`, `bridge/keepawake.go`, `bridge/terminal.go`'s `Agent:` field — exactly the three named |

**Verification (plan §5), run once near phase end, against the phase's own final commit:**

- `go build ./...`, `go vet ./...` — clean.
- `bun run lint:go` — 0 issues.
- `go test ./internal/agenthooks/ ./internal/terminal/ ./internal/appevent/
  ./apps/kira-studio/internal/... ./apps/kira-space/internal/...` — all pass, both
  `layering_test.go` packages included, no exemption-set change.
- `bun run typecheck`, `bun run lint` — clean.
- `bun run lint:dead` — 7 pre-existing duplicate-export findings (6 as of P117's own result), none
  in a file this phase touched.
- `bun run build:studio`, `bun run build:space` — clean.
- `bun run test:unit` — 1662 pass, 0 fail — the 7 reducer tests moved, not added, so the total is
  unchanged.
- `bun run test:ui:studio` — 299 tests, matching the baseline exactly: `settings-claude-code.spec.ts`
  dropped from 4 tests (confirmed against `21cd546e`) to 1, the minus-3 the plan predicted, no
  other count change. Two full-suite runs each hit a different, unrelated failure
  (`data-view.spec.ts`'s page crash, then `console-format.spec.ts`/`sql-schema.spec.ts`), each
  passing cleanly alone — the same worker-contention flake pattern P117's own result documented,
  not caused by this phase.
- `bun run test:ui:space` — 34/34 pass, unchanged.
- `bun run test:ipc:fe:studio` — 7/7 pass, unchanged.
- `bun run test:visual:studio` — 14/14 pass. Confirmed against an untouched `P127_START`
  (`21cd546e`) run in this same sandbox first, also 14/14 including the old Claude Code pane, so
  the sandbox renders like the checked-in baselines and the one re-recorded snapshot (commit 8) is
  the real UI change, not drift. One run mid-verification showed a transient 26px diff on
  `schema-dialog.png` (Monaco's own scrollbar rendering), gone on a clean re-run — confirmed a
  flake, not a regression, since `git diff --stat 21cd546e..HEAD` touches no file under that spec,
  its snapshot, or the editor package.
- `bun run test:visual:space` — 4/4 pass, unchanged.

**§5.2 live run: not checked.** No Wails runtime or display in this sandbox — stated plainly here
rather than implied as verified, per the plan's own instruction for exactly this case.

**Known open item, not this phase's to close.** The shared package is unwired from every app until
P129 wires it into Kira Space's `ade` module.

## P128 result

Plan: `docs/v2.0/plans/P128-space-module-system-shared-terminal.md`. One Opus planning pass, one
sequential Sonnet implementer, no stream split (the plan's own §3: steps regenerate bindings later
steps typecheck against, no zero-overlap ownership table). 13 commits, `3be4969e`..`74b27231`, plus
this result commit (`git log --oneline 195815f2..HEAD`); `f18900cb` (the plan doc) lands first,
outside the count below.

**Commits, in the plan's own §4 order, plus three unplanned fixups:**

1. `3be4969e` — `refactor(terminal): one shared bound terminal surface`. `internal/terminal/bound.go`
   (§2.1); both `bridge/terminal.go` to embedding-only; `OpenArgs` gains json tags and becomes the
   wire type directly. FQN gate confirmed (below).
2. `69bd15b1` — `refactor(storage): hoist window mode read/write to appstorage`. `WindowModes`,
   `GetMode`, `SetMode` land in `internal/appstorage/window.go`; Studio's model/repo delegate,
   behaviour unchanged.
3. `f816e3f5` — `refactor(windows): one shared bound windows surface; Kira Space persists per-window
   mode`. `internal/windowsvc`, both `bridge/windows.go` to embedding, Space migration `0003` (no
   new test — an `ALTER TABLE` default, covered by Studio's existing migration-pattern test), both
   `main.go`.
4. `617e5032` — `refactor(workbench): shared mode registry, store and switcher`. §2.3 files land in
   `packages/workbench`; Studio's `state/mode.ts` onto the factory, `TitleBar.vue` renders
   `ModeSwitcher`.
5. `790f3b39` — `refactor(workbench): shared terminal module`. §2.4 files; `git mv` of Studio's
   panel/start into the shared package; Studio's `terminal/`, `views/terminal/TerminalView.vue`
   deleted.
6. `f6df8e24` — `feat(space): module registry with the git module`. §2.6: `state/mode.ts`,
   `workbench/modes.ts` (git only), `GitNewTab.vue`, `visibleWorkspace()`, `host.ts`/`tabs.ts` read
   it. **Unplanned, same commit:** `createModeStore.ts`'s default type parameter changed from
   `Record<string, never>` to `Record<never, never>` — a real TypeScript bug the plan's own factory
   design didn't anticipate: spreading an `E` with a `[key: string]: never` index signature last in
   the store's return object literal resolved every key (`hydrateMode`, `setMode`, `active`
   included) to `never`, breaking every reader. Needed for Kira Space's call (the first with nothing
   to `extend`) to compile at all; doc comment on the type parameter records why.
7. `cd5246eb` — `feat(space): register the shared terminal module`. `workbench/terminalModule.ts`
   (no `scripts`), `App.vue` provides it, `MODES.terminal`, `tabViews.ts` to `TerminalTabView`;
   `views/repo/RepoTerminalView.vue` deleted.
8. `c2c4873a` — `feat(space): ade module placeholder`. §2.7: `AdePanel.vue`/`AdeStart.vue`, no Go,
   no store, no bridge.
9. `3f8addd9` — `test(space): module switching`. §5.2's `modules.spec.ts`, 3 tests.
10. `3a089c0b` — `docs: ARCHITECTURE records the shared module system and terminal module (P128)`.
    §4.2's five bullets, plus two pre-existing staleness fixes found while writing it (below).
11. `44757c34` — **unplanned fixup**, found running the closing audit's `rg -l 'TerminalHostView'
    apps` (expected empty): one comment in `repo-workspace.spec.ts` named the shared component and
    the already-deleted `RepoTerminalView.vue` directly. Reworded generically, no behavior change.
12. `74b27231` — **unplanned fixup**, found running `bun run lint:dead`: both apps' `TerminalTabRecord`
    (`state/tabDomain.ts`) went unused the moment `TerminalTabView.vue` (step 5/7) started typing its
    `tab` prop against `TerminalHostView`'s own shape instead (plan §2.4's own reasoning) — the type's
    only reader in each app was the now-deleted `TerminalView.vue`/`RepoTerminalView.vue`. Removed in
    both apps; `lint:dead` clean again.
13. This result commit.

**What landed**, matching the plan's own §1/§2 scope. `packages/workbench` now carries the whole
mode system (`modes.ts`, `state/createModeStore.ts`, `components/{ModeSwitcher,
TabStripNewButton}.vue`) and the whole terminal module (`terminal/{module.ts, TerminalPanel,
TerminalStart, TerminalNewTab, TerminalTabView}.vue`, beside the already-shared
`TerminalHostView.vue`). Repo-root `internal/terminal.BoundService` and `internal/windowsvc.Service`
carry the one bound method set each; both apps' `bridge.{Terminal,Windows}Service` are one-line
embeddings, keeping each app's own FQN (§1.7's promoted-method rule, confirmed live by the FQN gate
below). Kira Space has three registered modules — `git` (the existing workspace, unchanged
behavior), `terminal` (the same five shared components Studio uses, no `scripts` seam), `ade` (a
placeholder, no functionality) — a persisted per-window mode (`windows.mode`, migration `0003`), and
`visibleWorkspace()` as the one function reading across the mode and workspace stores.
`openRepoWorkspace` forces the mode to `git`; `activateWorkspace` deliberately does not (deviation
from the plan's own §2.6 wording, disclosed below). Kira Studio's own terminal module is
byte-identical in rendered behavior; its custom-scripts coupling is now the optional `scripts` seam
on `TerminalModuleContext`, injected only by Studio's own `workbench/terminalModule.ts`.

**Deviations from the plan, disclosed:**

- **`state/modeDomain.ts` (Kira Space), a leaf file not named in the plan's own §4.1 inventory.**
  `SpaceMode` moved into its own zero-import file rather than living directly in `state/mode.ts`,
  mirroring `tabDomain.ts`/`settingsDomain.ts`'s existing precedent and Kira Studio's own
  `@shared/domain/mode.ts` header comment for `AppMode` — needed because `bridge/index.ts`'s
  `createCoreControl<…, SpaceMode>` call needs the type without importing `state/mode.ts` itself
  (which imports `control` from `bridge/index.ts`). Same shape the plan's own inventory would have
  named had it gone one file deeper; every non-bridge importer keeps reading `SpaceMode` from
  `state/mode.ts` unchanged via its re-export.
- **`openRepoWorkspace` forces the mode to `git`; `activateWorkspace` does not.** The plan's own
  §2.6 text reads "`openRepoWorkspace`/`activateWorkspace` switch mode to `git`" — both. The
  implementation (see `state/workspace.ts`'s own comment on `openRepoWorkspace`) deliberately
  narrows this to `openRepoWorkspace` alone: `activateWorkspace`'s own callers are already
  git-mode-only UI (`GitPanel`'s row click, `closeRepoWorkspace`'s own fallback) or the boot-time
  fall-forward onto the first restored repo (`main.ts`), which must honour whatever mode
  `windowsEnsure` persisted rather than silently overriding it back to `git` on every relaunch.
  Widening `activateWorkspace` itself to force `git` would make a relaunch into a persisted
  `terminal`/`ade` mode snap back to `git` the moment a restored repo activates — the opposite of
  what per-window mode persistence (§2.2) is for. Covered by `modules.spec.ts`'s round-trip test
  (switch to `terminal`, open a tab, switch back to `git` — the repo's own tabs return without a
  forced mode change on the way).
- **`createModeStore`'s call signature is positional `(control, defaultMode, extend)`, `extend`
  required**, not the plan's own sketched `{control, defaultMode, extend?}` options object with
  `extend` optional. `extend` stays required even for a caller with nothing to add (Kira Space
  passes `() => ({})`) because leaving it optional/uninferred broke Pinia's own action/state
  extraction for the whole store — same constraint `createKeepAwakeStore.ts`'s own existing pattern
  already worked around, cited directly in the new file's doc comment. The `Record<string, never>`
  → `Record<never, never>` default-type-parameter fix (commit 6, above) is the other half of making
  this shape actually sound.
- **The saved `P128_START` FQN snapshot (`terminal_fqn_before.txt`/`windows_fqn_before.txt`,
  taken before step 1 per the plan's own §4 instruction) came back empty** — found this session,
  cause not established (bindings are gitignored build output; the capture likely ran before a
  generate step, or the command silently produced nothing). Reconstructed the same comparison a
  different way instead of skipping it: checked out `f18900cb` (`P127` landed, plan committed, no
  code touched yet) in a throwaway worktree and diffed the **Go source's own bound-method receivers**
  against today's — Wails' FQN is `package path + type + promoted method name` (plan §1.7's own
  citation of the generator/runtime source), so a source-level diff proves the same fact the
  generated-bindings diff would have. Result: Studio's `TerminalService`
  (`Shutdown`/`DefaultCwd`/`Open`/`Write`/`Resize`/`Close`) and Space's own copy are byte-identical
  before and after; Studio's `WindowsService` (`Ensure`/`SetMode`/`OpenNew`) is unchanged; Space's
  `WindowsService` had only `OpenNew` before and has `Ensure`/`OpenNew`/`SetMode` now — exactly the
  plan's own predicted "Windows: Space adds `Ensure`, `SetMode`; nothing else changes." Current
  generated bindings (`rg -o 'ByName\("[^"]+'` on both apps' `terminalservice.ts`/`windowsservice.ts`)
  confirm the same six/three method sets land in the actual FQNs.

**Closing audit (plan §6), final state, all 12 checks:**

| Check | Result |
|---|---|
| Studio terminal module gone from the app | `apps/kira-studio/frontend/src/terminal`, `.../views/terminal`, `apps/kira-space/frontend/src/views/repo/RepoTerminalView.vue` all absent |
| One terminal tab view | Empty on re-run. First pass hit one comment in `repo-workspace.spec.ts` naming `TerminalHostView` directly; fixed in commit 11 above |
| No per-app terminal/windows bound methods | Empty |
| Per-app bridge files embedding only | `terminal.go`/`windows.go`: empty diff for both, each file one struct embedding one field |
| Mode SQL in one place | `internal/appstorage/window.go` (`GetMode`/`SetMode`) plus Studio's `List` column list (`SELECT key, "order", bounds_json, mode`, not matched by the check's own literal grep but confirmed present, exactly as the plan predicted); test files' own literal SQL strings are assertions, not a second implementation |
| No app-side mode plumbing | Empty |
| No per-module branches | Two hits, both expected: a comment stating no such branch exists, and `visibleWorkspace()`'s own single `git`-mode check — the plan's own named exception ("the one reader that sees module keys") |
| `ade` isolated | `workbench/modes.ts` only |
| Shared TS code imports no app | Empty |
| Shared Go imports no app | Empty |
| Scripts only behind the seam | Empty |
| Existing specs untouched | Empty for Studio. Space: `modules.spec.ts` new (expected); `repo-workspace.spec.ts` comment-only (`git diff -U0 … \| rg '^[+-][^+-]' \| rg -v '^[+-]\s*//'` empty) |
| Stale biome override | Empty |

**Verification (plan §5), run once near phase end, against the phase's own final commit:**

- `go build ./...`, `go vet ./...` — clean.
- `bun run lint:go` — 0 issues.
- `go test ./internal/terminal/ ./internal/appstorage/ ./internal/windowsvc/
  ./apps/kira-studio/internal/... ./apps/kira-space/internal/...` — all pass, both `layering_test.go`
  packages included (`git diff --stat` against them empty — exemption sets unchanged).
- FQN gate — confirmed via source-level reconstruction, not the literal saved-file diff; see the
  deviations note above for method.
- `bun run typecheck`, `bun run lint` — clean.
- `bun run lint:dead` — clean after commit 12 above (the phase's own `TerminalTabRecord` regression,
  found and fixed same-phase); 7 pre-existing duplicate-export findings remain, none in a file this
  phase touched (same 7 P127's own result documented).
- `bun run build:studio`, `bun run build:space` — clean; both apps' `TerminalPanel-*.js` chunk still
  splits on its own (the plan's own §7 chunking risk, confirmed not triggered).
- `bun run test:unit` — 1662 pass, 0 fail — unchanged from P127's own baseline.
- `bun run test:ui:studio` — 299 tests total, matching P127's own baseline exactly; no spec file
  edited. One full-parallel run hit 3 failures plus 4 not-run in `data-view.spec.ts`/
  `sql-schema.spec.ts` (neither touched by this phase — `git diff --stat` against them empty); all
  13 of those tests passed cleanly re-run together in isolation. Same cross-file worker-contention
  flake class this sandbox's own history documents extensively (`docs/v1.9/SPEC.md`, P117/P127's own
  results) — not a regression.
- `bun run test:ui:space` — 37/37 (34 baseline + the 3 new `modules.spec.ts` tests). One
  full-parallel run flaked once on `repo-workspace.spec.ts`'s own pre-existing search test (unrelated
  subsystem, untouched by this phase); passed 3/3 repeated in isolation and 37/37 with `--workers=1`
  — the same worker-contention class, confirmed directly this time by removing the contention.
- `bun run test:ipc:fe:studio` — 7/7 pass, unchanged.
- `bun run test:visual:studio` — 14/14 pass, no re-record needed: `ModeSwitcher`/
  `TabStripNewButton` render Studio's exact prior markup, confirming the plan's own §5.1
  byte-identical-markup claim.
- `bun run test:visual:space` — 4/4 pass, unchanged (Settings-only coverage, untouched by this
  phase).

**§5.3 live run: not checked.** No Wails runtime or display in this sandbox — stated plainly here
rather than implied as verified, per the plan's own instruction for exactly this case.

**Pre-existing staleness found and fixed while documenting this phase (`docs/ARCHITECTURE.md`,
commit 10), not caused by it:** Kira Space's bound-service count was documented as **10**; the real
count (`grep -c application.NewService apps/kira-space/main.go`) is **13**, and was already 13
before this phase touched `main.go` — P116 G6 had already added `WindowsService` without the doc
being updated; P128 added zero new services, only two new methods to an existing one. Corrected in
place. Separately: the per-window mode persistence mechanism (P22) and the entire Terminal module
(P83/P91) had no prior documentation anywhere in the file — confirmed by exhaustive grep for their
own identifiers before writing commit 10's new paragraphs, which fill both gaps as part of
documenting this phase's own changes to the same mechanisms.

**Known open item, not this phase's to close, carried from P127.** The shared agent-monitoring
package P127 extracted is still unwired from Kira Space's UI; P129 wires it into the `ade` module
this phase only placeholders.

**Candidate follow-up, found during this phase's regression testing, out of this phase's scope.**
`apps/kira-studio/tests/ui/api-secret-reveal-isolation.spec.ts:63` ("a secret revealed via Copy as
curl does not skip re-auth in the later-opened Variables dialog") failed intermittently
(`locator.uncheck: Clicking the checkbox did not change its state`) in earlier runs during this
phase's work, in a subsystem (the Api client's Variables dialog secret-reveal UI) this phase never
touches. Confirmed via `git stash` against the pre-phase base commit that it reproduces identically
with none of this phase's changes applied, and via `--repeat-each=3` that it fails roughly 2 times in
3 — a real, pre-existing flake, not a one-off. Per `CLAUDE.md`'s own exception clause (root-causing
this belongs to a different subsystem, not a design decision this phase can make), left unfixed here
and named as a candidate for its own follow-up `P` phase rather than folded into this result section
as a footnote.
