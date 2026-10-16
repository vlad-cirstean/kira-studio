# P127 — extract agent-activity monitoring into shared packages; Kira Studio stops consuming it

Plan for `docs/v2.0/SPEC.md`'s P127 row. Planned against `v1.9` at `bef995d5`.

P86 (`docs/v1.8/plans/P86-claude-hooks-agent-status-widget.md`) built Claude Code hook monitoring
inside Kira Studio. User decision: Kira Space becomes the app that spawns Claude Code agents (P129's
`ade` module), so the monitoring moves to a shared home, used by no app after this phase, and Kira
Studio drops every consumer. Pure extraction plus Studio cleanup. No Kira Space wiring (P129).

Every path, symbol and count below was measured in this container against `bef995d5`:
`codegraph_explore` for call graphs and blast radius, `rg` over the whole repo (not only
`apps/kira-studio`) for every consumer, `go list -f '{{.Imports}}'` for package import closures,
`bun test`/`go test` for the baselines. `apps/kira-studio-vscode` does not exist; the one VS Code
app, `apps/kira-space-vscode`, has zero references.

---

## 0. What SPEC left open, and how each is resolved

| Open | Resolution | Where |
|---|---|---|
| Go home for the listener | **Repo-root `internal/agenthooks/`**, beside `internal/terminal`, `internal/localsock`, `internal/keepawake` | §2.1 |
| TS home for reducer/store | **`packages/workbench/src/state/`**: `agentActivity.ts` (pure reducer) + `createAgentSessionsStore.ts` (Pinia factory over an injected control seam). Wire types stay in `packages/shared/domain/agent.ts`. New `packages/agent-monitor` declined | §2.2 |
| "Host injects its own settings, emitter and bridge seams" | Go: a new `agenthooks.Manager` owns lifecycle + launch composition, built from code moved out of Studio's bridge; setting read, emit and bound methods stay host-side. TS: the factory takes a control interface, imports no bridge | §2.1, §2.2 |
| P87 keep-awake agent reason | **Stays in Kira Studio.** Reads `internal/terminal`'s registry count, never the hooks | §2.5 |
| Orphaned `claudeCode` leaves | `hooksEnabled`, `hooksPromptDismissed` dropped (Go model, repo, TS schema) plus migration `0029`. `keepAwakeWithAgents` stays, so the `claudeCode` section and the "Claude Code" settings pane stay | §2.6 |
| Channel strings | Go `ChannelAgentSessions`/`ChannelAgentEvent` hoist to repo-root `internal/appevent`; TS `CHANNEL.agentSessions`/`agentEvent` stay in `packages/shared/protocol/events.ts` | §2.3 |
| Does `layering_test.go` cover the new package? | **No.** Both copies scan only their own app's `internal/...`. Repo-root `internal/` never importing `apps/` is structural (Go's `internal/` rule; every non-internal package under `apps/` is `main`), checked by §6's `go list -deps` audit | §1.10 |
| One pass or parts? | One pass, one sequential Sonnet subagent | §3 |

---

## 1. Confirmed current state

### 1.1 Go listener — `apps/kira-studio/internal/agenthooks/`

| File | Lines | Contents |
|---|---|---|
| `agenthooks.go` | 165 | `Event` (JSON-tagged, 10 fields), `Options{OnEvent}`, `Server`, `New`, `SettingsPath`, `Env`, `Close` |
| `http.go` | 124 | `POST /hook`: bearer-token check (constant-time), `X-Kira-Terminal`, 4 MiB body bound, 200-byte rune-safe message truncation |
| `shim.go` | 38 | `buildShim` — the curl shim; header line hard-codes `# Kira Studio agent hook (P86)` |
| `config.go` | 71 | `hooks.json` builder, `ShellSingleQuote` |
| `server_test.go` | 290 | 8 tests over a real unix socket. Baseline: pass |

Imports (`go list`): stdlib plus repo-root `internal/localsock` only. Nothing Studio-specific.
Movable as-is. Its package comment claims `layering_test.go` "picks this package up
automatically"; true only while it lives under `apps/kira-studio/internal/`.

### 1.2 Go consumers in Kira Studio

| File | Symbol / site | Fate |
|---|---|---|
| `internal/bridge/agenthooks.go` (157) | `AgentHooksService` (bound: `Status`, `SetEnabled`), `NewAgentHooksService`, `AgentHooksStatus`, `AgentEventWire`, `onEvent`, `startIfEnabled`/`StartAgentHooksIfEnabled`, `stop`/`StopAgentHooks`, `launchFor` | Lifecycle + `launchFor` logic → `agenthooks.Manager` (§2.1); file deleted |
| `internal/bridge/embedded.go` | `embeddedService[S, ST]` — generic lifecycle shared by `AgentHooksService` **and `DbMcpService`** | Stays, DbMcp-only; doc comment updated (§2.7) |
| `internal/bridge/terminal.go` | `AgentHooks *AgentHooksService` field; `agenthooks` import; `--settings`/env composition in `Open`; `AgentSessionWire`, `AgentSessionsEvent`, `toWireAgentSessions`, bound `AgentSessions()`, `emitAgentSessions`, `TerminalAgentSessionsChanged` | All removed. `agent := LaunchKind == claude-code` and `OpenParams.Agent` **stay** (keep-awake input, §2.5) |
| `internal/bridge/events.go` | `ChannelAgentSessions`, `ChannelAgentEvent`; `ChannelKeepAwake`'s comment cites `ChannelAgentSessions` | Constants removed (hoisted, §2.3); comment rewritten |
| `internal/bridge/keepawake.go` | `KeepAwakeAgentSessionsChanged`, `recomputeAgent`, `SetAgentAware`; 5 comments cite `AgentHooksService`/`StartAgentHooksIfEnabled` | Logic stays; comments rewritten to stand alone |
| `main.go` | `embeddedWired.agentHooksSvc`, `NewAgentHooksService`, `StartAgentHooksIfEnabled`, `application.NewService(agentHooksSvc)`, `TerminalService{…AgentHooks: agentHooksSvc}`, `OnChange` calling `TerminalAgentSessionsChanged`, `wireLifecycle`'s `agentHooksSvc` param, `StopAgentHooks`, F13 comment | All agent-hooks wiring removed; `OnChange` keeps only `KeepAwakeAgentSessionsChanged` |
| `internal/storage/model/settings.go` | `ClaudeCodeSettings.{HooksEnabled,HooksPromptDismissed}`, `ClaudeCodePatch` same, defaults, doc comment | Removed (§2.6) |
| `internal/storage/repos/settings.go` | 2 `appsettings.Leaf` reads, 2 `UpsertOptional` writes for those keys | Removed |
| `internal/mcpauth/token.go:130`, `internal/connections/service.go:155` | Comments citing agenthooks | Rewritten (`localsock`'s 0700 dir; "after DB MCP stops") |

### 1.3 TS wire types, store, reducer spec

- `packages/shared/domain/agent.ts` (45): `AgentSession`, `AgentSessionsEvent`, `AgentEvent`,
  `AgentPhase`, `AgentActivity`. Types only. Already shared. Comments point at Studio files.
- `apps/kira-studio/frontend/src/state/agentSessions.ts` (109): `MAX_RUNNING_TOOLS`,
  `reduceAgentActivity`, `useAgentSessionsStore` (`applySessions`, `applyEvent`,
  `agentActivityFor`, `initAgentSessions`). Imports `../bridge/control` at module scope.
- `apps/kira-studio/tests/unit/agent-activity-reducer.spec.ts` (119): 7 tests, pass. Needs
  `@workbench/testing/unit/window` plus dynamic-import-after-mock only because the store module
  reaches `bridge/control.ts` → `/wails/runtime.js`. Test 6's title says Stop clears "the tool
  name"; neither the reducer nor the assertion does (P86 §13 rule 4: "`Stop` clears everything").

### 1.4 Kira Studio frontend consumers

| File | Site | Fate |
|---|---|---|
| `state/agentHooks.ts` | `useAgentHooksStore` (hooks-toggle status: hydrate, `setAgentHooksEnabled`) | Deleted, not moved (SPEC (2) lists it as a consumer) |
| `state/agentSessions.ts` | §1.3 | Moved to `packages/workbench` (§2.2), then deleted |
| `main.ts` | imports + `hydrateAgentHooks()`, `initAgentSessions()` in boot `Promise.all` | Removed |
| `bridge/index.ts` | `AgentHooksService` binding import; `agentHooksStatus`, `agentHooksSetEnabled`, `terminalAgentSessions`, `onAgentSessions`, `onAgentEvent`; `AgentEvent`/`AgentSessionsEvent` import | Removed |
| `workbench/StatusBar.vue` | agent-sessions widget (`data-testid="agent-sessions"`), `basename`, `agentCount`, `activityText`, `agentTooltip` | Removed |
| `workbench/host.ts` | `tabAttention` (Claude Code "waiting for you" dot) | Removed |
| `views/terminal/TerminalView.vue` | hooks banner (`claude-code-hooks-prompt`), `hooksJustEnabled`, `showHooksPrompt`, enable/dismiss handlers, default slot content | Removed; file keeps only `deps` + `<TerminalHostView>` |
| `workbench/settings/ClaudeCodePane.vue` | hooks checkbox (`settings-claude-code-hooks`), status error/path lines | Removed; **keep-awake checkbox stays** (§2.5) |
| `state/settingsDomain.ts` | `claudeCodeSettingsSchema.{hooksEnabled,hooksPromptDismissed}`, schema default, `defaultSettings` | Removed (§2.6) |
| `state/keepAwake.ts` | comment cites `setAgentHooksEnabled` | Rewritten |

`workbench/SettingsDialog.vue` only hosts `ClaudeCodePane`; untouched.

### 1.5 Kira Studio test consumers

| File | Site | Fate |
|---|---|---|
| `tests/ui/settings-claude-code.spec.ts` | 4 tests: 3 hooks-toggle, 1 keep-awake | 3 hooks tests deleted; keep-awake test and file stay; header rewritten |
| `tests/ui/support/ipcChannels.ts` | `agentHooksStatus`, `agentHooksSetEnabled`, `terminalAgentSessions`, `agentSessions`, `agentEvent` + comments | Removed; `keepAwake` comment rewritten (cites `agentSessions`' shape) |
| `tests/ui/support/mockRuntime.ts` | 3 `FQN_SUFFIX_BY_IPC_KEY` entries; 2 default responses + comment | Removed |
| `tests/visual/settings.spec.ts-snapshots/settings-claude-code-visual-linux.png` | Claude Code pane baseline | Re-recorded (§4 step 8) |
| `tests/unit/agent-activity-reducer.spec.ts` | §1.3 | Moved (§2.2) |

`tests/ipc`, `tests/e2e-real`, `terminal-module.spec.ts`: no reference.

### 1.6 Comment-only references outside Studio

Stale once Studio drops the feature; each rewritten so it names no Studio agent-hooks surface:

- `internal/terminal/service.go:13-15,58-60,111-113`, `validate.go:25-26` — "Studio's own
  AgentHooks composition".
- `internal/localsock/localsock.go:1,24,29` — `agenthooks.New`: still correct after the move. Keep.
- `packages/shared/domain/agent.ts`, `protocol/events.ts:58-66`, `domain/tabs.ts:46-48`.
- `packages/workbench/src/host.ts:64-67` (`tabAttention` doc), `components/TabStrip.vue:16-17`,
  `components/StatusBar.vue:6`, `terminal/TerminalHostView.vue:2-7`,
  `state/createTerminalsStore.ts:140-141`.
- Kira Space: `internal/bridge/terminal.go:10-17,82`, `main.go:133-135`,
  `frontend/src/main.ts:22-26`, `frontend/src/workbench/host.ts:20-24`,
  `views/repo/RepoTerminalView.vue:9-17`, `tests/ui/repo-workspace.spec.ts:777-780`. These
  describe Space's own lack, still true; only phrases asserting Studio *has* hooks change.
  Comment-only diff in `apps/kira-space` (§6 audit).

### 1.7 Keep-awake coupling (P87)

`KeepAwakeService.recomputeAgent` holds `ReasonAgent` iff
`settings.ClaudeCode.KeepAwakeWithAgents && agentCount > 0`. `agentCount` comes from
`main.go`'s `Registry.OnChange` → `len(terminalSvc.Registry.AgentSessions())`. `Registry`,
`AgentSessions`, `OnChange` and `OpenParams.Agent` all live in repo-root `internal/terminal`;
`internal/keepawake` is repo-root too (P116). **No dependency on `agenthooks`, `ChannelAgent*`,
the reducer or any frontend agent store.** Toggle UI: `ClaudeCodePane.vue`'s second checkbox,
`state/keepAwake.ts`'s `setKeepAwakeAgentAware` (`createKeepAwakeStore`'s `extend`).

### 1.8 Settings leaves

`claudeCode.{hooksEnabled,hooksPromptDismissed,keepAwakeWithAgents}`: Go model + patch + defaults,
`repos/settings.go` leaf reads/upserts, Studio `settingsDomain.ts` schema/default. No Go or TS test
names them. Last Studio migration: `0028_p120_drop_git_settings.sql` — the exact precedent for
deleting orphaned keys.

### 1.9 Already shared — do not re-move

Repo-root `internal/terminal` (`Registry.AgentSessions`/`OnChange`, `OpenParams.Agent`,
`LaunchKind*`, `Service`, `ValidateOpen`), `internal/localsock`, `internal/keepawake`,
`internal/appevent`; `packages/shared/domain/agent.ts`, `protocol/events.ts` `CHANNEL.agent*`,
`domain/tabs.ts` `terminalLaunchKindSchema`; `packages/workbench` `TabStrip`/`WorkbenchHost`
(`tabAttention` seam), `TerminalHostView` (default slot), `createKeepAwakeStore`,
`createTerminalsStore`. Kira Space's own terminal (`views/repo/RepoTerminalView.vue`,
`internal/bridge/terminal.go`) launches `claude` with no hooks; P127 does not touch its code.

### 1.10 Layering guards that exist

- **Go**: `apps/kira-studio/internal/layering_test.go` and `apps/kira-space/internal/layering_test.go`,
  both over repo-root `internal/layeringtest.Run` — every `<app>/internal/...` package except an
  exempt set must not depend on `/internal/bridge`. Neither scans repo-root `internal/`. Baseline:
  both pass. Moving `agenthooks` out removes it from Studio's scan; that is fine, since it never
  imported bridge and repo-root code cannot (Go's `internal/` rule makes `apps/*/internal/...`
  unimportable from outside `apps/<app>/`; `go list -e ./apps/...` shows every other package
  there is `main`).
- **TS**: `biome.json` `noRestrictedImports` — `packages/workbench/**` bans `**/apps/**` and
  `@/*`; `packages/shared/**` bans `**/apps/**` and `@kira/api-core`. Workbench has no `@bindings*`
  ban (api-core has one); `rg '@bindings' packages/workbench/src` finds only strings in
  `viteAppConfig.ts`, no import.

### 1.11 Where the pre-planning summary was off

- `ClaudeCodePane.vue` hosts the keep-awake checkbox too — the pane survives.
- Missed consumers: bound `AgentHooksService` + `TerminalService.AgentSessions` (bindings,
  `mockRuntime.ts` FQN entries, `ipcChannels.ts`), `settings-claude-code.spec.ts`, the visual
  baseline, Go/TS settings leaves, `embeddedService`'s DbMcp co-tenancy, the comment sites in §1.6.
- `layering_test.go` does not cover repo-root `internal/` (§1.10).
- Reducer spec test 6's title/behaviour mismatch (§1.3).

---

## 2. Scope decision

### 2.1 Go: repo-root `internal/agenthooks`

**Why here.** Cross-app Go lives in repo-root `internal/` (P100 §4.3's hoists; P103 §6.1 hoisted
`internal/terminal` the same way). Go's `internal/` rule makes that the only place both
`apps/kira-studio` and `apps/kira-space` can import. The package already depends only on repo-root
`internal/localsock`.

**What moves.** The five files, `git mv`, content unchanged except: package comment (layering
claim, §1.1); shim header → `# Kira agent hook.` (app-neutral; it is written into the generated
script); `ShellSingleQuote` → unexported `shellSingleQuote` (its one outside caller,
`bridge/terminal.go`, moves into the package).

**What is added: `Manager`, from moved code, not new behaviour.** Today the settings-agnostic half
of P86's lifecycle is spread over `embeddedService` (start-once/stop-and-clear under a mutex),
`AgentHooksService.launchFor` (path + env under that mutex) and `TerminalService.Open` (quote,
append `--settings`, attach env). Deleting it with Studio's bridge would leave P129 to re-derive
the token-bearing launch composition. `Manager` holds it once:

```go
// manager.go — the host's entry point. Holds at most one running Server.
type Manager struct{ mu sync.Mutex; srv *Server; opts Options }

func NewManager(opts Options) *Manager
func (m *Manager) Start() error  // no-op while running; New's error returned as-is
func (m *Manager) Stop() error   // Close's error returned; host logs it
func (m *Manager) Status() Status

type Status struct {
	Running      bool
	SettingsPath string // "" while stopped
}

// ComposeLaunch returns command + " --settings '<hooks.json>'" and the three hook env vars while
// running; command unchanged and nil env while stopped. Env carries KIRA_AGENT_HOOK_TOKEN: a host
// must never return it from a bound method. Deciding which launches get hooks (claude-code only) is
// the host's call.
func (m *Manager) ComposeLaunch(terminalID, command string) (string, []string)
```

`New` quotes the settings path once (stored on `Server`), so `ComposeLaunch` has no error path.
Safe: `hooks.json` shares `ln.Dir` with the shim, whose quoting `New` already fails on, so no
directory that passed before fails now. Studio's current "quote failed → log, launch without
hooks" branch becomes unreachable and goes.

**What stays host-side** (the seams SPEC names): which setting gates `Start`, reading it at boot,
persisting the toggle, emitting `Event` on `appevent.ChannelAgentEvent`, the bound
`Status`/`SetEnabled` surface and its wire struct, the sessions projection (§2.3).

No new Go test: `Manager` is a mutex around `New`/`Close` plus string concatenation — restates its
body (`CLAUDE.md`'s bar). `server_test.go` keeps covering the socket protocol.

### 2.2 TS: `packages/workbench`

**Why workbench.** It is the established home for app-agnostic Pinia store factories over an
injected control seam — `createKeepAwakeStore`, `createAppMetricsStore` (the pushed-from-Go shape
this store copies), `createTerminalsStore`, `createTerminalTabs` — which is the SPEC row's own
suggested pattern. Both apps already alias `@workbench/*`, include its sources in every tsconfig,
and biome already bans `apps/` imports there.

**Declined: `packages/agent-monitor`.** Named cost: a new vite alias, tsconfig `paths` + `include`
in four tsconfigs per app, root `workspaces`, a knip block, a biome block — for ~150 lines with the
same consumers `@workbench` already reaches. A standalone package earns that when it has a distinct
layering rule (api-core: DOM-free; git-core: host-free). This code needs Pinia and Vue, exactly
workbench's layer.

**Declined: reducer/store into `packages/shared`.** `shared` is the Vue-free base layer mirroring
Go wire shapes; the store needs Pinia. The reducer alone could live there, but its one consumer is
the store and `shared` has no `test:unit` path or runnable tsconfig of its own.

**Files.**

- `packages/workbench/src/state/agentActivity.ts` — `MAX_RUNNING_TOOLS`, `emptyActivity`
  (private), `reduceAgentActivity`, verbatim. Only a type import from `@shared/domain/agent`.
- `packages/workbench/src/state/createAgentSessionsStore.ts`:

```ts
export interface AgentSessionsControl {
  terminalAgentSessions(): Promise<AgentSessionsEvent>;
  onAgentSessions(cb: (event: AgentSessionsEvent) => void): () => void;
  onAgentEvent(cb: (event: AgentEvent) => void): () => void;
}

// createAppMetricsStore's shape: no `extend` — nothing app-specific to add.
export function createAgentSessionsStore(control: AgentSessionsControl) {
  return defineStore('agentSessions', () => { /* today's body, verbatim */ });
}
```

  Method names match Studio's existing `control` members, so step 3's temporary Studio call site
  (`createAgentSessionsStore(control)`) typechecks structurally, and P129's Space control
  implements the same three.
- `packages/workbench/src/state/agent-activity-reducer.spec.ts` — `git mv` of the Studio spec.
  Static `import { MAX_RUNNING_TOOLS, reduceAgentActivity } from './agentActivity'`; the
  `window` shim import and dynamic-import-after-mock go (nothing reaches `/wails/runtime.js` any
  more). Colocated, as in `packages/git-core/src`. Typechecked by every app tsconfig that already
  includes `packages/workbench/src/**/*.ts` (all have `bun-types`); covered by knip's existing
  `src/**/*.{ts,vue}` entry.
- Root `package.json` `test:unit`: add `packages/workbench/src`. It holds no other `*.spec.ts` or
  `*.test.ts` today. CI's `pr.yml` already runs `bun run test:unit` — no workflow change.
- `biome.json`: add `"@bindings*/**"` to the `packages/workbench/**` `noRestrictedImports` group
  (api-core's exact pattern). Makes "no bridge binding hard-wired" a lint rule; zero current hits.

### 2.3 Wire contract

- **TS types** stay in `packages/shared/domain/agent.ts`; comments repointed at the shared homes.
- **Channels**: Go `ChannelAgentSessions = "kira:agent:sessions"`, `ChannelAgentEvent =
  "kira:agent:event"` move into `internal/appevent`'s shared constant block (P103/P116 precedent:
  `ChannelKeepAwake`, `ChannelTerminal`). No Go consumer until P129; an exported const is not an
  `unused` finding. TS `CHANNEL.agentSessions`/`agentEvent` stay.
- **Event payload**: `agenthooks.Event`'s JSON tags already equal `AgentEvent` field for field. A
  host emits it as-is; `AgentEventWire` (a same-package decoupling copy) is deleted, not moved.
  `Emit` takes `any`, so this generates no binding.
- **Sessions payload**: `AgentSessionWire`/`AgentSessionsEvent` stay a host bridge concern, since
  a bound method returns them and a bound return type drives binding generation (P103 §2.3). Studio
  deletes its copy; P129 declares Space's from `agent.ts`'s contract (~15 lines).

### 2.4 Deleted, not moved

SPEC (2)'s consumers: `AgentHooksService` (bound surface + settings leaf coupling),
`state/agentHooks.ts`, the status-bar widget, the tab attention dot, the terminal banner, the hooks
checkbox, `TerminalService.AgentSessions`/`TerminalAgentSessionsChanged`, Studio's
`ChannelAgent*`. None carries logic P129 needs that §2.1/§2.2 don't already hold.

### 2.5 Keep-awake: stays in Kira Studio

1. **It is not the moved code.** It reads `internal/terminal`'s agent count (§1.7), already shared,
   not moving. Removing the hooks leaves it fully functional.
2. **Its premise survives.** Studio still launches `claude-code` tabs (P85 launch kind; P128's own
   acceptance: "Kira Studio's terminal behaves exactly as before").
3. **Removing it is a user-facing feature removal the SPEC row never asks for.** The row only asks
   for a stated call; the evidence says keep.

Consequences: Studio `Open` keeps `agent`/`OpenParams.Agent`; `OnChange` keeps
`KeepAwakeAgentSessionsChanged`; `claudeCode.keepAwakeWithAgents` stays; the "Claude Code"
settings pane keeps one checkbox; its UI test and README's "Claude Code" settings mention stay
true. After P127 the two apps' `TerminalService.Open` differ only by `Agent: agent` — noted for
P128's convergence.

### 2.6 Settings leaves

Drop `hooksEnabled`/`hooksPromptDismissed` from Go `ClaudeCodeSettings`, `ClaudeCodePatch`,
defaults, `repos/settings.go` (2 reads, 2 upserts) and Studio's `claudeCodeSettingsSchema` +
defaults. Add `apps/kira-studio/internal/storage/migrations/0029_p127_drop_agent_hooks_settings.sql`:

```sql
-- P127: agent-hooks monitoring left Kira Studio; its two leaves are orphaned.
DELETE FROM settings WHERE key IN ('claudeCode.hooksEnabled', 'claudeCode.hooksPromptDismissed');
```

Use the next free number at implementation time (P126 runs in parallel, Kira Space-side). No
migration test: one `DELETE`, no edge case.

### 2.7 Kept seams, with reasons

- **`WorkbenchHost.tabAttention`** and `TabStrip`'s `isAttention`: no provider after P127.
  Kept: a generic optional host seam (`extraTabMenu` is the standing zero-consumer precedent), and
  it is the display half of the feature being extracted — P129 is its named next provider. Doc
  comment rewritten to name no app.
- **`TerminalHostView`'s default slot**: no consumer after P127. Kept: a plain Vue composition
  point on a shared component, zero runtime cost; P128 owns the terminal module's shape. Comment
  rewritten.
- **`embeddedService`**: DbMcp-only after P127. Kept generic: it separates DbMcp's lifecycle from a
  300-line service; de-genericizing is a DbMcp refactor with no behaviour change, outside this
  extraction. Doc comment rewritten.

### 2.8 Out of scope, confirmed not forgotten

- Wiring any of this into Kira Space (P129).
- Kira Space's terminal code and `RepoTerminalView.vue` (P128 decides its fate).
- Converging the two `TerminalService`s (P128).
- An agent-aware keep-awake reason for Kira Space (P129's call).

---

## 3. Split decision: one pass

~700 moved lines, ~80 lines of `Manager` assembled from moved code, the rest deletions and comment
edits. One sequential Sonnet subagent. No parallel fan-out: steps 1→2 and 3→5→6→7 are
order-dependent (frontend stops calling bindings before Go deletes them).

---

## 4. Steps and commits

Every commit passes the pre-commit hook (`bun run lint`, `bun run typecheck`) and `go build ./...`.
Record `P127_START=$(git rev-parse HEAD)` before step 1. Regenerate Wails bindings after any bound
surface change (`docs/DEV_ENVIRONMENT.md`; `scripts/setup.sh` calls `wails3 task
common:generate:bindings`) so typecheck sees the real tree.

1. **`refactor(agenthooks): move hook listener to repo-root internal/agenthooks`**
   `git mv apps/kira-studio/internal/agenthooks internal/agenthooks`. Fix the import in
   `bridge/agenthooks.go`, `bridge/terminal.go`. Rewrite the package comment (§1.1, §1.10). Shim
   header app-neutral. `go test ./internal/agenthooks/` passes (8 tests).
2. **`refactor(agenthooks): add Manager for listener lifecycle and launch composition`**
   Add `internal/agenthooks/manager.go` (§2.1); `New` stores the quoted settings path;
   `ShellSingleQuote` → `shellSingleQuote`. Rewire Studio's `AgentHooksService` onto `Manager`
   (drop its `embeddedService` instance; `Status`/`SetEnabled` map `Manager.Status` + start error
   into `AgentHooksStatus`), `TerminalService.Open` onto `ComposeLaunch` through an unexported
   `AgentHooksService` method, and `onEvent` to emit `agenthooks.Event` directly (drop
   `AgentEventWire`). Behaviour identical. Deliberate: `Manager` lands proven against the one real
   consumer before that consumer goes.
3. **`refactor(workbench): shared agent-sessions store and activity reducer`**
   Create `agentActivity.ts` + `createAgentSessionsStore.ts` from `state/agentSessions.ts`
   (`git mv` the file to `createAgentSessionsStore.ts`, then split out the reducer). Studio's
   `state/agentSessions.ts` becomes `export const useAgentSessionsStore =
   createAgentSessionsStore(control);`. `git mv` the spec (§2.2), static import. `test:unit` path.
   Biome `@bindings*` ban. `bun run test:unit` count unchanged.
4. **`fix(workbench): Stop clears toolName in reduceAgentActivity`**
   Add `toolName: null` to the `Stop` case and `expect(stopped.toolName).toBeNull()` to test 6 —
   P86 §13 rule 4 ("clears everything") and test 6's own title. No visible effect (no consumer).
5. **`refactor(studio)!: drop agent-activity monitoring UI`**
   §1.4 and §1.5 frontend/test rows: delete `state/agentHooks.ts`, `state/agentSessions.ts`;
   edit `main.ts`, `bridge/index.ts`, `workbench/StatusBar.vue` (header comment too),
   `workbench/host.ts`, `views/terminal/TerminalView.vue` (header comment: no remaining difference
   from Space's wrapper but store wiring), `workbench/settings/ClaudeCodePane.vue` (header: one
   instant-action leaf), `state/keepAwake.ts` comment; `settings-claude-code.spec.ts`,
   `ipcChannels.ts`, `mockRuntime.ts`. `BREAKING CHANGE:` footer: Studio no longer shows Claude
   Code session activity.
6. **`refactor(studio)!: drop agent-hooks bridge surface`**
   Delete `bridge/agenthooks.go`. `bridge/terminal.go`: remove `AgentHooks`, composition, sessions
   projection, `AgentSessions`, `emitAgentSessions`, `TerminalAgentSessionsChanged`, now-unused
   `log/slog`; keep `Agent: agent`. Hoist the two channel constants to `internal/appevent`, remove
   them from `bridge/events.go`, rewrite `ChannelKeepAwake`'s comment. `main.go` per §1.2.
   Comments: `embedded.go`, `keepawake.go`, `mcpauth/token.go`, `connections/service.go`,
   `internal/terminal/{service,validate}.go`, Kira Space's §1.6 sites. Regenerate bindings;
   `agenthooksservice.js` disappears, nothing imports it.
7. **`refactor(studio)!: drop claudeCode hooks settings leaves, migration 0029`** — §2.6.
8. **`test(visual): re-record settings Claude Code pane baseline for P127`** — §5.1.
9. **`docs: ARCHITECTURE records shared agent monitoring (P127)`** — §4.1.
10. Result section in `docs/v2.0/SPEC.md` (`## P127 result`), per chapter convention.

Step 1-7 comment rewrites also cover the shared-package sites in §1.6 (`agent.ts`, `events.ts`,
`tabs.ts`, `host.ts`, `TabStrip.vue`, `StatusBar.vue`, `TerminalHostView.vue`,
`createTerminalsStore.ts`), each in the step that makes it stale.

### 4.1 `docs/ARCHITECTURE.md`

- Process model, bound-service paragraph (~L2200): `28` → recount with `grep -c
  application.NewService apps/kira-studio/main.go` (expect 27); "three the terminal/agent
  surface's (`AgentHooksService`, …)" → two, `KeepAwakeService`/`TerminalService`. L1366's
  "nineteen bound services" embedding `Deps` is already stale (17 files declare
  `Deps appcore.Deps` today): recount by command and correct.
- New paragraph after the keep-awake paragraph (~L2066): **Claude Code hook monitoring is a
  shared, host-wired package (P127)** — `internal/agenthooks` (`Manager`, `Event`, the socket
  protocol and its bounds), `packages/workbench/src/state/{agentActivity,createAgentSessionsStore}.ts`,
  `packages/shared/domain/agent.ts`, the `appevent`/`CHANNEL` strings; what a host supplies
  (setting, bound surface, sessions projection, never exposing `ComposeLaunch`'s env); no app wires
  it as of P127; Kira Studio keeps only the registry-count keep-awake reason.
- Layering paragraph (~L1381): one sentence — repo-root `internal/` sits outside both
  `layering_test.go` scopes; Go's `internal/` rule keeps it off `apps/`.

---

## 5. Verification

Baselines at `bef995d5`: `go test` for `apps/kira-studio/internal/agenthooks`, both
`layering_test.go` packages — pass; reducer spec 7 pass. Measure the rest (`test:unit`,
`test:ui:studio`, `test:ui:space`, `test:visual:*`) at `P127_START` before step 1.

| Command | Expected |
|---|---|
| `go build ./...`, `go vet ./...` | Clean |
| `bun run lint:go` | Clean |
| `go test ./internal/agenthooks/ ./internal/terminal/ ./internal/appevent/ ./apps/kira-studio/internal/... ./apps/kira-space/internal/...` | Pass; both layering tests pass, exemption sets unchanged |
| `bun run typecheck`, `bun run lint`, `bun run lint:dead` | Clean; knip adds no finding |
| `bun run build:studio`, `bun run build:space` | Clean |
| `bun run test:unit` | Baseline total unchanged (7 reducer tests moved, not added), all pass incl. step 4's added assertion |
| `bun run test:ui:studio` | Baseline minus exactly 3 (`settings-claude-code.spec.ts` 4 → 1), no other change |
| `bun run test:ui:space` | Unchanged |
| `bun run test:ipc:fe:studio` | Unchanged |
| `bun run test:visual:studio` / `:space` | Only `settings-claude-code-visual` differs (§5.1) |

### 5.1 Visual baseline

P121 §6.4's procedure. Run `bun run test:visual:studio` at `P127_START`, untouched. If it passes,
this sandbox renders like the baselines: after step 7, re-record only
`settings-claude-code-visual-linux.png`, confirming the diff is confined to the removed hooks
checkbox and its helper text. If the untouched run shows `docs/DEV_ENVIRONMENT.md`'s uniform
glyph drift, do not re-record here; say so in the result section and leave it to CI. Any other
spec diffing is a regression: fix it.

### 5.2 Live run

A Wails window may not run in this sandbox. If it can, launch Kira Studio, open a Claude Code tab
with keep-awake-with-agents on, and confirm `caffeinate` appears and exits with the tab. If not,
state that plainly in the result section rather than implying it was checked.

---

## 6. Closing audit

Account for every hit.

| Check | Command | Pass |
|---|---|---|
| Kira Studio references none of the moved/removed code | `rg -n 'agenthooks\|AgentHooks\|agentHooks\|agentSessions\|AgentSessionWire\|AgentSessionsEvent\|TerminalAgentSessionsChanged\|AgentActivity\|AgentEvent\|AgentPhase\|reduceAgentActivity\|MAX_RUNNING_TOOLS\|agentActivity\|ChannelAgent\|createAgentSessionsStore\|domain/agent\|hooksEnabled\|HooksEnabled\|hooksPromptDismissed\|HooksPromptDismissed\|claude-code-hooks\|agent-sessions\|kira:agent' apps/kira-studio` | Only `internal/storage/migrations/0029_*.sql`. `Registry.AgentSessions()` and `KeepAwakeAgentSessionsChanged` (keep-awake, §2.5) do not match, by construction |
| Shared Go imports nothing from `apps/` | `go list -e -deps ./internal/agenthooks/ \| rg /apps/` | Empty |
| Shared TS imports nothing from `apps/` or bindings | `rg -n "apps/\|from '@/\|@bindings" packages/workbench/src/state/agentActivity.ts packages/workbench/src/state/createAgentSessionsStore.ts packages/shared/domain/agent.ts` | Empty; biome rules enforce it going forward |
| Channel strings: one Go, one TS copy | `rg -n 'kira:agent:(sessions\|event)' internal packages apps` | `internal/appevent/appevent.go` and `packages/shared/protocol/events.ts` only |
| No dead binding import | `rg -n 'agenthooksservice\|AgentHooksService' apps/kira-studio/frontend/src apps/kira-studio/tests` | Empty |
| Kira Space: comments only | `git diff -U0 $P127_START -- apps/kira-space \| rg '^[+-][^+-]' \| rg -v '^[+-]\s*(//\|\*)'` | Empty |
| Keep-awake intact | `rg -n 'KeepAwakeAgentSessionsChanged\|Agent:\s+agent' apps/kira-studio` | `main.go` `OnChange`, `bridge/keepawake.go`, `bridge/terminal.go` |

---

## 7. Risks

| Risk | Handling |
|---|---|
| A consumer missed | §6's first grep is repo-wide over `apps/kira-studio`; typecheck and `go build` catch every code reference, the grep catches comments and test strings |
| Frontend still calls a deleted binding | Step order: 5 (frontend stops calling) before 6 (Go deletes). Regenerated bindings plus typecheck prove it |
| `Manager` has no consumer after step 6 until P129 | Step 2 runs it against Studio's real `Open`/`SetEnabled` first; `server_test.go` still covers the socket protocol |
| Token env leaks to the webview | `ComposeLaunch` doc and §4.1's ARCHITECTURE paragraph both state: never return its env from a bound method. Studio's step-2 wiring keeps it behind an unexported method |
| Keep-awake regresses | §2.5 keeps `Agent` and `OnChange`; the keep-awake UI test stays; §6's last check |
| Visual baseline re-recorded from a drifting sandbox | §5.1 checks the untouched baseline first |
| Parallel P126 conflict | Disjoint files (P126: Space appearance pipeline). Whichever lands second rebases. Re-check the migration number at step 7 |
| Stale local bindings mask a break | Regenerate after steps 2 and 6; `agenthooksservice.js` must be absent afterwards |
