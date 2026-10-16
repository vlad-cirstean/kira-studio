# P85 — Tab-strip "+": launch Claude Code, or a user-configured custom script

`docs/v1.8/SPEC.md`'s P85 row (`:159`) and its Sequencing paragraph (`:125`-`:140`), turned into
concrete steps. Everything below was read in the current tree
(`claude/v1-8-p82-p83-implementation-ocpvj1` at `f71867b2`, P71-P84 landed); line numbers are from
that tree.

Two halves. The first is a **seam**, not a mechanism: P83's PTY starts the user's login shell with
no way to run anything in it, so this phase adds one field (`Command`) end to end and nothing else.
The second is a small CRUD store plus a Settings section for the scripts themselves.

No new dependency. No `@kira/git-ipc` contract change, no `CONTRACT_VERSION` bump (P83 §18's
reasoning applies unchanged — every method here is on the Wails bound surface). No
`packages/git-ui/` change, no VS Code-extension change. One SQLite migration.

## 0. What SPEC left open, and how each is resolved

| Open | Resolution | Where |
|---|---|---|
| How a command runs in P83's PTY | **`$SHELL -l -i -c <command>`** — one extra arg pair on the invocation P83 already makes. The shell is the same login, interactive shell a plain terminal gets, so a launched command sees exactly the environment the user's own terminal in this app sees | §2 |
| Write the command to the PTY after spawn instead | **Rejected**, four reasons — the decisive one is that P86 counts *running* agent sessions, and a wrapper shell outliving `claude` makes that signal wrong | §3.1 |
| Exec the command directly, no shell | **Rejected.** A GUI app launched from Finder has a minimal PATH; `claude` is typically an npm global or a `~/.local/bin` shim reached only after the user's rc files run. A custom script is also a *shell* command by definition (pipes, `&&`, globs) | §3.2 |
| A new session type, or a second terminal mechanism | **Neither.** One new string field on `terminal.OpenParams`, `TerminalOpenArgs` and `terminalTabStateSchema`. Empty means "plain login shell", i.e. P83's behaviour verbatim | §4, §5 |
| What happens when the command exits | The PTY exits with its code, and P83 §7.4's existing footer renders `Process exited (code N)`. The tab stays open until the user closes it | §2.3 |
| `claude` not installed | **No availability probe.** The shell prints `command not found: claude`, exits 127, and the footer says so. A probe costs a spawn per dropdown open and is wrong for an alias/function install | §2.4 |
| Is the "Claude Code" entry configurable | **No.** Fixed command `claude`. A user wanting `claude --resume` writes a custom script — that is what custom scripts are | §2.4 |
| Dropdown order and separators | `Terminal` · `Claude Code` — separator — one row per script — separator — `Manage scripts…`. Built-ins group together (both are app-provided launch targets); the leading separator is emitted **only** when at least one script exists, so a fresh install never renders two adjacent rules | §6.1 |
| Precedent for a trailing "manage" entry | `api/menus.ts:165`-`200`'s `backgroundMenu`: actions, separator, then `Environments…` with a `settings-gear` icon. Copied verbatim in shape | §6.2 |
| Icon or colour per script | **Colour yes, icon no.** `ColorPicker.vue` (a promoted primitive) and `MenuItem.swatch` (`state/contextMenu.ts:12`, rendered by `ContextMenu.vue:258`-`262`) both already exist, so a colour is two bindings; the same colour also paints the tab rail through `TabKindDef.railColor`. An icon picker would need a codicon browser — new UI with no precedent in this app | §6.3, §10.2 |
| Where the config surface lives | **A new `SettingsDialog.vue` section, "Scripts"** — every other app-wide configuration is there, and the dialog already has instant-effect sections that bypass draft/Save. Not a standalone dialog | §10.1, §11.2 |
| Persistence | **A new `custom_scripts` table**, `connection_mask_rules`' own shape. Not a settings leaf — `SettingsDialog.vue:75`-`80`'s `valuesEqual` compares array elements with `===`, so an array of objects reads dirty on every open | §8, §11.1 |
| Is there an existing generic "small app-wide config list" to reuse | **No.** `settings` is one JSON value per scalar leaf; `git.protectedBranches` is the only array and it is `[]string`. Every named-record list in this app (`connections`, `code_repos`, `collections`, `connection_mask_rules`) is its own table | §11.1 |
| Working-directory resolution | Unchanged from P83 §8.1 — `code_repos.root` of the active repo workspace. A script's own `workingDir`, when set, overrides it and must be absolute | §7 |
| Per-window staleness | One broadcast channel, `kira:customScripts:changed`, `ChannelConnectionsChanged`'s own shape — a script added in one window must appear in the other's dropdown | §9.3 |
| Any unit test | **One case added to `internal/terminal/session_test.go`** (the command runs, its exit code reaches `onExit`). No test for the scripts CRUD — `CLAUDE.md`'s bar excludes CRUD round-trips and required-field guards | §15.1 |

---

# Part A — running a command in P83's PTY

## 1. What parameterizes a session today

`internal/terminal/session.go:66`-`68`:

```go
func newSession(id, cwd string, cols, rows uint16, onData func([]byte), onExit func(int, error)) (*Session, error) {
	shellPath := loginShell()
	cmd := exec.Command(shellPath, "-l", "-i")
```

So: **cwd, size and callbacks only.** There is no initial command, no argv seam, no env hook beyond
`sessionEnv()`'s fixed four vars (`shell.go`). `TerminalOpenArgs` (`bridge/terminal.go:32`-`38`)
carries `terminalId`/`cwd`/`cols`/`rows`/`windowKey`, and `terminalTabStateSchema`
(`packages/shared/domain/tabs.ts:322`-`325`) carries `cwd`/`codeRepoId`. Every layer must gain one
field; none of them gains more than one.

## 2. The mechanism — `$SHELL -l -i -c <command>`

### 2.1 What changes

```go
args := []string{"-l", "-i"}
if p.Command != "" {
	args = append(args, "-c", p.Command)
}
cmd := exec.Command(shellPath, args...)
```

That is the whole of it. `loginShell()`, `cmd.Dir`, `cmd.Env`, `SysProcAttr{Setsid: true}`,
`pty.StartWithSize` and the reader goroutine are untouched.

### 2.2 Why these flags, not fewer

The flags are not a new choice — they are P83 §2.3's own choice, kept. That is the point:

- **`-l`** sources the login profile (`/etc/profile`, `~/.zprofile`, `~/.bash_profile`).
- **`-i`** makes the shell interactive, which is what sources `~/.zshrc` — where macOS users
  overwhelmingly put PATH edits (nvm, asdf, homebrew shims, `~/.local/bin`). Dropping `-i` for the
  `-c` case would give a launched `claude` a *different, smaller* PATH than the plain Terminal entry
  in the same dropdown gives it, which is the one outcome worth ruling out.
- **`-c <command>`** passes the command as **one argv element**. Nothing concatenates it into
  another shell string anywhere in this phase, so there is no quoting layer and no escaping to get
  wrong.

`-l -i -c` is accepted by zsh (macOS's default), bash and fish. `/bin/sh` is only ever reached as
`loginShell()`'s floor, and on macOS that is bash in `sh` mode, which accepts all three — the same
property P83 already relies on for `-l -i`.

### 2.3 What happens when the command ends

The shell exits with the command's status. `readLoop` observes EOF, `waitExitCode` reports the code,
the coalescer's `finish` flushes, and `RepoTerminalView.vue`'s footer renders
`Process exited (code N)` — **P83 §7.4's existing behaviour, reached with no new code.** The tab
stays open showing the output; the user closes it.

Deliberately **not** done: `-c 'cmd; exec $SHELL -l -i'` to leave a live shell behind. It would make
the session's exit code permanently 0 regardless of what the command did, which destroys exactly the
signal §3.1 says P86 needs.

### 2.4 The "Claude Code" entry

Command: the literal string `claude`. Not configurable, not probed.

- **Not configurable**: SPEC says this entry launches the `claude` CLI. A user who wants
  `claude --resume` or `claude --model …` adds a custom script — the dropdown's other half exists
  for precisely that.
- **Not probed**: `claude` missing produces `command not found: claude`, exit 127, and the footer.
  That is legible without help. A probe would mean spawning `$SHELL -l -i -c 'command -v claude'`
  every time the dropdown opens (a login shell per open), and it would answer *wrong* for the
  perfectly normal case where `claude` is a shell function or alias defined in `~/.zshrc`.

**Not a new trust boundary, and must not be described as one.** The plain Terminal entry already
starts an arbitrary interactive shell with the user's own privileges. The commands here come from
the user's own stored scripts, over the bound surface, reachable only from this window's webview
(P83 §3.1). What genuinely improves is the *shape*: a single `-c` argument instead of a string the
app assembles.

## 3. Rejected alternatives

### 3.1 Write `command + "\n"` to the PTY after spawn

Rejected. Four reasons, in order of weight:

1. **P86 needs the session's own exit.** SPEC's P86 row counts running Claude Code sessions in a
   status-bar widget. With `-c`, the PTY's exit *is* the agent's exit — the existing `Exited`/
   `ExitCode` event already carries it. With a post-spawn write, the shell outlives `claude` and the
   session never ends, so the count only ever grows.
2. **It races shell startup, with no portable way not to.** The rc files run after the pty exists.
   Input written before the shell has set its own line discipline is silently consumed or echoed
   back garbled, and there is no "ready" signal short of shell integration — the per-shell surface
   P83 §15 already declared out of scope.
3. **P83 already refused to type into the user's shell**, in writing (§8.2, on rewriting a cwd:
   "This app must not type into a user's shell"). Reusing that recorded decision is stronger than
   re-arguing it.
4. It writes the script's text into `~/.zsh_history`, silently.

### 3.2 Exec the command directly, with no shell

Rejected. A Wails app launched from Finder inherits `launchd`'s minimal PATH, not a terminal's; the
whole reason P83 chose a *login* shell is that this is where `claude`, `node`, `pnpm` and friends
actually come from. And a custom script is defined as a shell command — `npm run dev 2>&1 | tee log`
is not an argv.

### 3.3 A `shellArgs`/`argv` field instead of one command string

Rejected as scope that buys nothing. Every caller in this phase has a single command string; an argv
array would need a UI to edit it and a join rule to display it.

## 4. The Go diff

Three files, one field each.

**`internal/terminal/session.go`**

- `OpenParams` (`:197`) gains `Command string` — "empty means a plain login shell (P83's own
  behaviour)".
- `newSession` takes `OpenParams` instead of six positional arguments (it is already at six; adding
  a seventh is the wrong direction) and builds `args` per §2.1.
- `Registry.Open` passes `p` straight through. Nothing else in the file moves.

**`internal/bridge/terminal.go`**

- `TerminalOpenArgs` (`:32`) gains `Command string \`json:"command"\``.
- `Open` (`:72`) gains one validation line beside the existing `cwd`/dimension checks:

```go
if len(args.Command) > maxTerminalCommandBytes {
    return TerminalOpenResult{}, ipcerr.New("E_INVALID", "command is too long")
}
```

  with `maxTerminalCommandBytes = 64 * 1024`, a sibling of `maxTerminalDim` (`:62`) and justified
  the same way: macOS's `ARG_MAX` is 1 MiB for argv plus environment together, so a bound well under
  it fails with a clear message instead of `E2BIG` out of `exec`. No other validation — a command is
  arbitrary user text by construction, and the *script*'s own non-empty check lives at the CRUD
  layer (§10.3).
- The `terminal.OpenParams` literal (`:91`) gains `Command: args.Command`.

**`internal/bridge/events.go`** — unchanged. The output channel is the same.

## 5. The frontend diff

### 5.1 Tab state

`packages/shared/domain/tabs.ts:322` gains three fields, each defaulted so an older record still
parses (terminal tabs are never persisted — `persistableTabs()` filters them — but `parseState`
runs on `duplicateState` output too):

```ts
export const terminalTabStateSchema = z.object({
  cwd: z.string(),
  codeRepoId: z.string(),
  // P85: the command the shell runs at startup ($SHELL -l -i -c). '' is P83's plain login shell.
  command: z.string().default(''),
  // The tab's own title when set — a script's name, or 'Claude Code'. '' falls back to the cwd's
  // basename, exactly as P83 titled every terminal.
  label: z.string().default(''),
  color: paletteColorSchema.default('none'),
});
```

### 5.2 The tab-kind entry

`state/tabKinds.ts:470`-`487`, two lines changed:

```ts
title: (tab) => {
  const s = (tab as TerminalTabRecord).state;
  return s.label || basename(s.cwd) || 'Terminal';
},
railColor: (tab) => (tab as TerminalTabRecord).state.color,
```

`railColor` returning `'none'` is already handled everywhere — `connColorVar` (`theme/connColor.ts`)
maps it to `undefined`, which is what `TabStrip.vue`'s `--kira-rail` binding expects. `PaletteColor`
*is* `ConnectionColor` (`shared/domain/connection.ts:60`), so the `TabKindDef.railColor` signature is
satisfied with no type change.

`duplicateState` already spreads the whole state, so "Duplicate tab" on a Claude Code tab opens a
second Claude Code session at the same directory — the right answer, with no special case.

`icon` stays `terminal-bash` for every terminal tab. The launch kind shows in the title and the rail
colour; a second glyph vocabulary per tab is not asked for.

### 5.3 `openRepoTerminalTab` gains one optional argument

`state/repoTabs.ts:215`. Three existing call sites (`TabStrip.vue`, and `GitPanel.vue`'s two row
menus) are unchanged:

```ts
export interface TerminalLaunch {
  command: string;
  label: string;
  color: PaletteColor;
}

export function openRepoTerminalTab(
  codeRepoId: string,
  cwd: string,
  launch?: TerminalLaunch,
): OpenTabResult {
  openRepoWorkspace(codeRepoId);
  return openTab(
    'terminal',
    null,
    cwd,
    () => ({
      cwd: canonicalPath(cwd),
      codeRepoId,
      command: launch?.command ?? '',
      label: launch?.label ?? '',
      color: launch?.color ?? 'none',
    }),
    { reuse: false, workspaceId: repoWorkspaceKey(codeRepoId) },
  );
}
```

### 5.4 The session opener

`state/terminals.ts`'s `openTerminalSession` takes the command through to `control.terminalOpen`;
`TerminalSession` gains a readonly `command` for symmetry with `cwd`. `RepoTerminalView.vue`'s
`mount()` passes `props.tab.state.command`. Nothing about the drain queue, the sink registry or
`terminalCountAtPath` changes.

`terminalCountAtPath` counting a Claude Code or script terminal is **correct and needs no code**: a
session launched at the active worktree lights the same `repo-terminal-indicator` on that row as a
plain terminal does. Called out so the implementation does not "fix" it.

---

# Part B — the dropdown

## 6. `TabStrip.vue`'s `newTabMenuItems()`

### 6.1 Shape

`TabStrip.vue:213` today returns one item. It becomes:

```
Terminal          terminal-bash
Claude Code       sparkle
─────────────────────────────      (only when scripts.length > 0)
<script name>     swatch, or `play` when its colour is 'none'
…
─────────────────────────────
Manage scripts…   settings-gear
```

Rules, each load-bearing:

- **Terminal and Claude Code sit together, with no rule between them.** Both are launch targets this
  app provides; the scripts below are the user's. That is the boundary a separator marks.
- **The script group's leading separator is conditional.** With no scripts configured — the starting
  state this phase ships — the menu is `Terminal`, `Claude Code`, separator, `Manage scripts…`, with
  no adjacent rules. `ContextMenu.vue:245` renders a `.p-sep` for every separator it is given, so
  two in a row would render as two lines; the builder must not emit one.
- **`Manage scripts…` is always last, always after a separator.**
- Each script row carries `hint: script.command`, which `ContextMenu.vue:252`'s `v-tooltip` renders
  — a script's name says what it is, its tooltip says what it runs.
- `.label` already ellipsizes (`ContextMenu.vue:399`-`403`), so no name-length cap is needed
  anywhere.

The three built-in rows keep stable ids (`new-terminal` unchanged, plus `new-claude-code` and
`manage-scripts`); a script row's id is `script-${script.id}`.

### 6.2 Precedent, not invention

`api/menus.ts:165`-`200`'s `backgroundMenu` is exactly this shape already: actions, `{ type:
'separator' }`, then a trailing `Environments…` carrying the `settings-gear` icon. The `…`
suffix is this app's existing "opens a dialog" convention (`shortcuts/state.ts`, `project/menus.ts`,
`GitPanel.vue:165`). Both are copied rather than re-decided.

### 6.3 Icons

`sparkle`, `play`, `settings-gear` and `terminal-bash` all exist in `@vscode/codicons` 0.0.46-24
(checked in `node_modules/@vscode/codicons/dist/codicon.css`, not assumed). A script whose colour is
not `'none'` renders a `swatch` instead of an icon — `ContextMenu.vue:258`-`263` already picks
swatch-over-icon in the same slot, so this is a field, not a branch in the template.

### 6.4 The launch helper

The Terminal item's `run` body (`TabStrip.vue:216`-`222`) is factored into one local function every
entry calls:

```ts
function launchInActiveWorkspace(launch?: TerminalLaunch, cwdOverride?: string): void {
  const repoId = repoIdOfWorkspace(workspaceState.active);
  const repo = repoId ? codeRepoRecord(repoId) : undefined;
  if (!repoId || !repo) return;
  openRepoTerminalTab(repoId, cwdOverride || repo.root, launch);
}
```

The `v-if="isRepoWorkspace(workspaceState.active)"` gate on the whole `.tab-strip-actions` slot
(`TabStrip.vue`'s template) is unchanged and still correct: every entry, including a script with its
own `workingDir`, opens a tab that must belong to a repo workspace.

## 7. Working directory

**P83 §8.1 unchanged, plus one override.** Precedence, stated once:

1. The script's own `workingDir`, when non-empty — used verbatim.
2. Otherwise `codeRepoRecord(repoIdOfWorkspace(workspaceState.active))!.root`, which **is** the
   active worktree's directory (`gitclient.Identify` sets `Root` from `rev-parse --show-toplevel`,
   and a linked worktree imported through `openRepoAtPath` is its own `code_repos` row — P83 §8.1,
   P82 §5.2). No new path plumbing, and nothing in `internal/gitsession` is touched.

The Claude Code entry and the Terminal entry always take branch 2.

Both branches run through `canonicalPath` on the way into the tab record (`openRepoTerminalTab`
already does this), so `terminalCountAtPath`'s index keeps comparing like with like.

**A relative `workingDir` is not supported** — not "later", not partially. Resolving one needs a base
plus a normalization rule (`..`, symlinks) duplicated in TS, and the shell already answers it better:
`cd frontend && npm run dev` is a command, which is the field the user is already filling in. A
non-empty `workingDir` that is not absolute is rejected at save time (§10.3).

---

# Part C — custom scripts

## 8. Storage

### 8.1 The migration

`apps/kira-studio/internal/storage/migrations/0024_p85_custom_scripts.sql`:

```sql
-- P85: the user's own launchable scripts, shown in the tab strip's "+" dropdown. A table, not a
-- settings leaf: these are named records with a stable id and an order, created and deleted one at
-- a time with immediate effect — the same reasoning 0023's connection_mask_rules carries, and the
-- shape code_repos (0018) already uses for the app's other user-curated list.
CREATE TABLE custom_scripts (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  command     TEXT NOT NULL,
  -- '' means "the active repo workspace's own worktree directory" (plan §7). A non-empty value is
  -- an absolute path, checked on write; its existence is not, since the launch path already checks
  -- it (bridge/terminal.go's Open) and a path may legitimately not exist yet at save time.
  working_dir TEXT NOT NULL DEFAULT '',
  -- domain/color.ts's paletteColorSchema. 'none' is a real stored value, not a null stand-in.
  color       TEXT NOT NULL DEFAULT 'none',
  sort_order  INTEGER NOT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
```

No `UNIQUE` on `name`. Two scripts may share a label — each row's tooltip carries its own command,
and rejecting a duplicate would be a restriction neither SPEC nor the user asked for.

### 8.2 Model and repo

`internal/storage/model/customscript.go` — `CustomScript` and `CustomScriptFields`, mirroring
`packages/shared/domain/scripts.ts` field for field, `model/maskrule.go`'s own split (a `Fields`
struct that omits id/timestamps/order).

`internal/storage/repos/customscripts.go` — `CustomScriptsRepo`, `CodeReposRepo`'s own shape:
`List()` (`ORDER BY sort_order ASC, name ASC`), `Create(fields)` (sort_order one past the current
max), `Update(id, fields)`, `Remove(id)`. `Update` and `Remove` both check `RowsAffected` and return
a wrapped `sql.ErrNoRows` for an unknown id — `CodeReposRepo.SetMcpEnabled`'s own recorded fix, not
repeated as a bug here. Registered in `repos.Repos` (`repos.go:31` area) as `CustomScripts`.

Validation lives in `model.CustomScriptFields.Validate()` (§10.3), called by `Create` and `Update`
— the same place `model.CodeRepo.Validate()` is called from `CodeReposRepo.Create`.

## 9. The bound surface

### 9.1 `internal/bridge/customscripts.go`

`CustomScriptsService`, `MaskRulesService`'s own per-method-args-struct shape, reaching
`s.Deps.Repos.CustomScripts` directly (no `appcore.Deps` field — `CollectionsService` already
establishes that a service wrapping one repo needs none):

| Method | Args | Result |
|---|---|---|
| `List` | — | `[]model.CustomScript` |
| `Create` | `{fields}` | `model.CustomScript` |
| `Update` | `{id, fields}` | `model.CustomScript` |
| `Remove` | `{id}` | — |

`id` empty is `ipcerr.BadRequest`; a `Validate()` failure is `ipcerr.BadRequest(err.Error())`, which
is what `MaskRulesService.Upsert` already does with its own domain errors. Registered in `main.go`'s
service list (`:386` area, beside `MaskRulesService`).

### 9.2 Wiring

- `packages/shared/domain/scripts.ts` — `customScriptFieldsSchema`, `customScriptSchema`,
  `CustomScriptFields`, `CustomScript`. `color` is `paletteColorSchema` (`domain/color.ts`),
  imported, never re-listed.
- Bindings regenerated with `wails3 task common:generate:bindings` (`docs/DEV_ENVIRONMENT.md:243`) —
  never a hand-typed flag list.
- `frontend/src/bridge/index.ts` — `customScriptsList/Create/Update/Remove`,
  `onCustomScriptsChanged`.
- `packages/shared/protocol/events.ts` + `internal/bridge/events.go` —
  `customScriptsChanged: 'kira:customScripts:changed'`.
- `tests/ui/support/ipcChannels.ts` + `mockRuntime.ts` — four channel constants, four
  `FQN_SUFFIX_BY_IPC_KEY` entries, and a `'[]'` wildcard default for `customScriptsList` (§15.2).

### 9.3 `state/customScripts.ts`

`state/`, not `repo/state/`: `TabStrip.vue` (`workbench/`) and `SettingsDialog.vue` (`workbench/`)
both read it, which is the same layering argument P83 §5 made for `state/terminals.ts`.

```ts
export const customScriptsState = reactive({ records: [] as CustomScript[] });
export async function hydrateCustomScripts(): Promise<void>
export async function createCustomScript(fields: CustomScriptFields): Promise<void>
export async function updateCustomScript(id: string, fields: CustomScriptFields): Promise<void>
export async function removeCustomScript(id: string): Promise<void>
```

`hydrateCustomScripts` joins `main.ts`'s boot `Promise.all` (`:295`-`:309`) beside
`hydrateCodeRepos()`, and installs a `control.onCustomScriptsChanged` subscription that replaces
`records` — `state/settings.ts`'s `hydrateSettings`/`onSettingsChanged` pair, verbatim in shape.
Each mutation emits the broadcast from Go (`Emit`, not `EmitTo` — every window's dropdown must
follow), which is what keeps a second window's menu from going stale. `state/connections.ts`'s own
`onConnectionsChanged` is the precedent; without it this list has the exact staleness that comment
describes.

## 10. The config surface

### 10.1 Where — a new Settings section

`SettingsDialog.vue:119`-`129`'s `sections` gains `'Scripts'`, between `'Git'` and
`'Code intelligence'`. Reasons, not a coin flip:

1. Every other app-wide user configuration in this app is a section of this dialog. Scripts are
   app-wide (not per repository, not per window), so a standalone dialog would be the only one of
   its kind.
2. The dialog already has sections that **bypass draft/Save entirely** — `'Connected editors'`
   (`:117`-`:118`: "a revoke must take effect immediately") and `'Code intelligence'`'s per-repo
   toggles. A CRUD section is that same class, so it fits the dialog as it is rather than bending
   it.
3. A standalone dialog means a new component, its own `DialogFrame`, its own open state, its own
   Escape/focus handling, and a second place the user has to learn to look.

`sections` and its `Section` type **move to `state/settings.ts`** (a `workbench/` → `state/` read is
permitted; the reverse is not), and that module gains:

```ts
export const settingsSection = ref<Section | null>(null);
export function openSettingsAt(section: Section): void {
  settingsSection.value = section;
  settingsOpen.value = true;
}
```

`SettingsDialog.vue` initializes `activeSection` from `settingsSection.value ?? 'Appearance'` and
clears it on unmount. `Manage scripts…` is then `openSettingsAt('Scripts')` — three lines, and the
title-bar and command-palette entry points (`TitleBar.vue:85`, `shortcuts/state.ts:54`) keep working
unchanged because `settingsSection` stays null for them.

### 10.2 What the section contains

One list plus one add row, `ConnectionDialog.vue:998`-`1057`'s Privacy tab restated — the app's
existing "add/edit/remove a named item with a few fields" UI, reused rather than reinvented.

Per row (`data-testid="custom-script-${id}"`):

| Control | Field | Primitive |
|---|---|---|
| `TextField` | name | `theme/primitives/TextField.vue` |
| `TextField`, `mono` | command | same |
| `TextField` | working directory, placeholder `Active repository` | same |
| `ColorPicker` | colour | `theme/primitives/ColorPicker.vue` |
| `IconButton icon="trash"` | remove | `theme/primitives/IconButton.vue` |

Below the list, one add row with the same four inputs and an `AppButton` labelled `Add`, plus a
`field-error` span for the rejected cases — the exact layout `.mask-rule-add` already has.

Edits **commit on blur**, not per keystroke: each `TextField` is bound to a local per-row draft and
`@blur` calls `updateCustomScript` only when the value actually changed. A colour click commits
immediately — `VariableSetView.vue:103`-`105` records that same split ("a swatch click applies
immediately, unlike name/description's blur-commit") and the reason holds here too. Removal asks
`confirmDialog` first (`state/confirmDialog.ts`), as `onRevokeGitClient` does, because there is no
undo.

Empty state: `No scripts yet. Add one to launch it from the tab strip's + button.` as a
`helper-text` paragraph — the same treatment `No masking rules yet on this connection.` gets.

No reordering UI. `sort_order` is creation order and `List` returns it; drag-reorder is new
interaction surface nothing asked for (§13).

### 10.3 Validation — complete, no gaps

`model.CustomScriptFields.Validate()`, mirrored by `customScriptFieldsSchema` so the dialog can
disable `Add` before a round trip. The Go check is the authority; the zod one is the affordance.

| Field | Rule | Message |
|---|---|---|
| `name` | required after trimming whitespace; **stored trimmed** | `name is required` |
| `command` | required after trimming whitespace; **stored trimmed** (leading/trailing only — never the interior) | `command is required` |
| `workingDir` | optional. When non-empty, must satisfy `filepath.IsAbs`; stored verbatim | `working directory must be an absolute path` |
| `color` | must satisfy `model.ValidPaletteColor` (`model/connection.go:92`, already exists) | `invalid colour` |

Nothing else is restricted, and the omissions are deliberate, each with a reason:

- **No duplicate-name check** — §8.1.
- **No length cap on name or command** at the CRUD layer. The menu label ellipsizes
  (`ContextMenu.vue:399`), and `bridge/terminal.go`'s `maxTerminalCommandBytes` (§4) already bounds
  what can reach `exec`, at the layer where the bound actually matters.
- **No existence check on `workingDir`.** A path may be created after the script is saved, or live on
  a volume that is not mounted right now. `TerminalService.Open` already `os.Stat`s the cwd and
  returns a clear `E_INVALID` at launch (`bridge/terminal.go:85`-`88`), which is the right moment to
  find out.
- **No inspection of the command's content.** There is nothing to inspect for: it is a shell command
  the user wrote, run with their own privileges, the same as the Terminal entry beside it. A
  denylist would be theatre.

## 11. Rejected alternatives

### 11.1 Store scripts as a settings leaf

Rejected. `settings` is one JSON value per **scalar** leaf (`repos/settings.go`'s `leaf`/`leafValid`
helpers, one call per field); `git.protectedBranches` is its only array and it is `[]string`. Three
concrete failures:

1. `SettingsDialog.vue:75`-`80`'s `valuesEqual` compares array elements with `===`. `cloneSections`
   JSON-round-trips the draft, so an array of **objects** gets fresh references and `pendingPatch`
   would report the section dirty on every open, permanently.
2. The dialog's whole model is stage-until-Save. A script launched from the dropdown must reflect
   what was just typed, which is why every comparable list in this app (mask rules, git clients)
   writes immediately.
3. No stable id and no order — both of which the dropdown and the edit UI need.

### 11.2 A standalone "Manage scripts" dialog

Rejected — §10.1's three reasons. Worth noting what it would *not* have cost: the dialog primitives
are all promoted already, so this was a real option, not a strawman. It loses on discoverability
(a second place to configure the app) and on the new open-state/Escape/focus plumbing.

### 11.3 A per-repository script list

Rejected as scope SPEC does not ask for. The row says "user-configured custom scripts" with no
repository qualifier, and a per-repo list needs a repository picker in the Settings section plus a
decision about what a script on a repo with no workspace open means. A global list plus each
script's own `workingDir` covers the repo-specific case.

### 11.4 Pre-building P86's hook/session-kind seam

Rejected, following P83 §15's own precedent ("nothing is pre-built for them"). P86 will need a way
to tell a Claude Code terminal apart from a shell one; this phase deliberately does not add a
`launchKind` field for it. Noted so P86's planning pass knows it is an open design point and not an
oversight — and knows that matching on `state.command === 'claude'` is *not* the intended answer.

## 12. What this phase does not touch

Confirmed by reading the post-P84 tree, not assumed:

- **`repo/GitPanel.vue`** — unchanged. P84 split it into `git-panel-tab-repos`/`git-panel-tab-files`
  inside one `PanelShell` (`:341`-`:353`); P85's surfaces are the tab strip and the Settings dialog,
  which share no markup with it. The one connection is `terminalCountAtPath`, and it needs no change
  (§5.4).
- `packages/git-ui/`, `packages/git-ipc/`, `apps/kira-studio-vscode/` — no file, no contract method,
  no `CONTRACT_VERSION` bump (P83 §18).
- `internal/gitsession` — the cwd already resolves without it (§7).
- `views/repo/terminalRenderer.ts`, the drain queue, the coalescer — the output path is identical.

## 13. Deliberately out of scope

- **Reordering scripts** (drag, or up/down buttons). `sort_order` exists and is creation order;
  a reorder UI is new interaction surface nothing asked for.
- **Per-script environment variables, argv arrays, or a shell override.** One command string, run in
  the user's own shell (§3.3).
- **Relative `workingDir`** (§7), and **`workingDir` existence checking at save time** (§10.3).
- **An icon picker.** §0/§6.3 — colour is two existing primitives, an icon is a codicon browser.
- **Importing scripts from `package.json`, a Makefile or `.vscode/tasks.json`.** Each is its own
  parser and its own per-repo scoping question.
- **Running a script anywhere but a new terminal tab** — no background runner, no output panel, no
  task-status surface. SPEC: "Every launched entry opens as the same terminal tab kind P83 built".
- **A command-palette entry per script**, or a keybinding per script.
- **Claude Code hooks, and the running-sessions widget** — P86 and P87 own those.
- **Persisting or restoring a launched terminal across a restart.** P83 §7.5 stands unchanged.
- **`docs/ARCHITECTURE.md` / `README.md`.** Chapter docs are their own phase's job.

## 14. Files

Added:

| File | Contents |
|---|---|
| `apps/kira-studio/internal/storage/migrations/0024_p85_custom_scripts.sql` | §8.1 |
| `apps/kira-studio/internal/storage/model/customscript.go` | `CustomScript`, `CustomScriptFields`, `Validate()` (§8.2, §10.3) |
| `apps/kira-studio/internal/storage/repos/customscripts.go` | `CustomScriptsRepo` (§8.2) |
| `apps/kira-studio/internal/bridge/customscripts.go` | `CustomScriptsService` (§9.1) |
| `packages/shared/domain/scripts.ts` | the two zod schemas (§9.2) |
| `apps/kira-studio/frontend/src/state/customScripts.ts` | the store + broadcast subscription (§9.3) |
| `apps/kira-studio/tests/ui/settings-scripts.spec.ts` | §15.2's CRUD test |

Modified:

| File | Change |
|---|---|
| `apps/kira-studio/internal/terminal/session.go` | `OpenParams.Command`; `newSession(OpenParams)`; the `args` build (§4) |
| `apps/kira-studio/internal/terminal/session_test.go` | one new case (§15.1) |
| `apps/kira-studio/internal/bridge/terminal.go` | `TerminalOpenArgs.Command`, `maxTerminalCommandBytes`, one validation line, one literal field (§4) |
| `apps/kira-studio/internal/bridge/events.go` | `ChannelCustomScriptsChanged` |
| `apps/kira-studio/internal/storage/repos/repos.go` | `CustomScripts` field + construction |
| `apps/kira-studio/main.go` | `application.NewService(&bridge.CustomScriptsService{Deps: deps})` |
| `apps/kira-studio/frontend/bindings/…/internal/bridge/{customscriptsservice,terminalservice,models,index}.ts` | regenerated (§9.2) |
| `packages/shared/domain/tabs.ts` | `terminalTabStateSchema`'s three fields (§5.1) |
| `packages/shared/protocol/events.ts` | `customScriptsChanged` |
| `apps/kira-studio/frontend/src/bridge/index.ts` | four script calls, `onCustomScriptsChanged`, `terminalOpen`'s `command` arg |
| `apps/kira-studio/frontend/src/state/terminals.ts` | `command` through `openTerminalSession` (§5.4) |
| `apps/kira-studio/frontend/src/state/tabKinds.ts` | `title`/`railColor` (§5.2) |
| `apps/kira-studio/frontend/src/state/repoTabs.ts` | `openRepoTerminalTab`'s optional `launch` (§5.3) |
| `apps/kira-studio/frontend/src/state/settings.ts` | `sections`/`Section` moved in, `settingsSection`, `openSettingsAt` (§10.1) |
| `apps/kira-studio/frontend/src/views/repo/RepoTerminalView.vue` | passes `state.command` to `openTerminalSession` |
| `apps/kira-studio/frontend/src/workbench/panels/TabStrip.vue` | §6's menu builder and launch helper |
| `apps/kira-studio/frontend/src/workbench/SettingsDialog.vue` | the `Scripts` section + its CSS; `sections` imported instead of declared; `activeSection` seeded from `settingsSection` (§10) |
| `apps/kira-studio/frontend/src/main.ts` | `hydrateCustomScripts()` in the boot `Promise.all` |
| `apps/kira-studio/tests/ui/support/ipcChannels.ts` | five constants (four calls + one event) |
| `apps/kira-studio/tests/ui/support/mockRuntime.ts` | four FQN entries + a `'[]'` wildcard for `customScriptsList` |
| `apps/kira-studio/tests/ui/repo-workspace.spec.ts` | `:1057`'s migration + two new tests (§15.2) |

Deleted: none.

## 15. Tests

### 15.1 One added Go case — `internal/terminal/session_test.go`

`TestSessionRunsInitialCommand`: `Open` with `Command: "printf ready; exit 7"`, assert the collected
output contains `ready` **and** that `onExit` reported code 7.

This is not a new test file for a new feature; it is one case in the file whose whole subject is
session lifecycle, and it guards the one non-obvious property the rest of the phase rests on — that
the command's own exit status reaches `onExit` rather than the wrapper shell's. That is the signal
P86 will count sessions with (§3.1 reason 1). No other Go test.

**No unit test for the scripts CRUD.** `CLAUDE.md`'s bar rules out CRUD round-trips, required-field
guards and thin pass-through wrappers by name, and §10.3 is four one-line checks. The Playwright
tier drives the whole path end to end anyway (§15.2).

### 15.2 Playwright

**Migration, `repo-workspace.spec.ts:1057`.** The existing test asserts the dropdown has exactly one
item. It becomes three (`Terminal`, `Claude Code`, `Manage scripts…`) with no scripts configured.
Assert that count and those three ids rather than loosening to a `>=` — the count is what proves the
conditional separator (§6.1) did not emit a phantom row.

**New, in `repo-workspace.spec.ts`**, beside P83's own terminal tests and following their exact
shape (`TERMINAL_OPEN_OK`'s argless snapshot, `expect.poll` over `control.log()` because
`RepoTerminalView.vue`'s `mount()` fires the open call fire-and-forget):

1. `"the + dropdown launches Claude Code in its own terminal tab"` — click `tab-strip-new`, click
   `menu-item-new-claude-code`, then assert all three of: a `terminal` tab exists, its title reads
   `Claude Code`, and `control.log()` carries a `terminalOpen` with
   `{ cwd: REPO.root, command: 'claude' }`. The title assertion is what proves §5.1/§5.2's `label`
   path rather than only the Go-bound argument.
2. `"a configured script appears in the dropdown and launches its own command and directory"` —
   seed `IPC.customScriptsList` with one record
   (`{ name: 'Dev server', command: 'npm run dev', workingDir: '/tmp/demo-repo/frontend', color: 'green' }`),
   assert the menu now has five rows (three built-ins plus the script plus the extra separator is
   not an item), click `menu-item-script-…`, and assert `terminalOpen` carried
   `{ cwd: '/tmp/demo-repo/frontend', command: 'npm run dev' }` — §7's precedence, proven by the cwd
   *not* being `REPO.root`.

**New file, `settings-scripts.spec.ts`**, modelled on `settings-code-intelligence.spec.ts` (the
existing spec for an instant-effect Settings section): open Settings, click
`settings-section-Scripts`, assert the empty state; fill the add row and click Add, asserting
`customScriptsCreate` was called with the trimmed fields; assert `Add` stays disabled with an empty
name or an empty command, and that a non-absolute working directory shows `custom-script-error`.

`installGitStreamMock` is **not** needed by any of these — none opens a repo workspace's worktree
list, and the two `repo-workspace.spec.ts` additions only need `CONTROL` plus `TERMINAL_OPEN_OK`,
exactly as P83's own `"the tab strip's + opens a terminal tab"` test does. Checked against that
test's own setup rather than assumed, per P82/P83/P84's recorded harness limits.

### 15.3 Known gap, stated

**No Playwright coverage of a real shell running a real command.** P83 §17.3's boundary is unchanged
and unchanged for the same two structural reasons: the Playwright tier has no Go process behind it
(`mockRuntime.ts` intercepts the `Call` RPC route), and the real app is a native Wails window with
no remote-debugging hook. §15.1 is where a command actually runs. Asserting "claude started" from
the mocked tier would be a fabrication.

**No coverage of the cross-window broadcast** (§9.3) — the Playwright fixture drives one window.
`emitWailsEvent(page, IPC.customScriptsChanged, …)` could drive the *handler*, but that asserts the
subscription, not the broadcast, and the subscription is four lines copied from
`onSettingsChanged`. Not worth a test; recorded rather than quietly skipped.

## 16. Checks

- Per commit: `bun run typecheck`, `bun run lint` (expect only the known pre-existing
  `UncommittedChangesStrip.vue` info finding), `scripts/check-tokens.sh`, `bun run build`. Go
  commits additionally `go build ./...` and `go vet ./...`.
- Once, near the end (`CLAUDE.md`'s implement-then-test rule), with fixes as follow-up commits:
  1. `go test ./...` — `internal/terminal` (§15.1) and the migration tests.
  2. `bun run test:unit` — `go-ts-vocabulary-parity.spec.ts` is unaffected (no new tab kind), but
     the shared-schema round-trips run here.
  3. `bun run test:ui`. `repo-workspace.spec.ts`, `tabs.spec.ts` and the two `settings-*.spec.ts`
     files are the ones most exposed; report counts.
  4. `bun run build:vscode` + `bun run test:webview` — expected entirely unaffected; confirm by
     diffing the touched file list, as P78's result section did, rather than asserting it.
- Manual pass in the real app (`CLAUDE.md`'s "see it working" bar): launch Claude Code and confirm
  the CLI starts with the user's own PATH; exit it and confirm the footer's exit code; add a script
  with and without a working directory and launch both; confirm a script's colour paints its tab
  rail; delete a script and confirm it leaves the dropdown; open a second window and confirm a
  script added in the first appears there without a relaunch. **If no GUI is available in this
  sandbox — which every prior phase in this chapter found — say so plainly in the phase result
  rather than claiming it passed.**

## 17. Order and commits

1. **`feat(terminal): let a session start with an initial command`**
   `internal/terminal/session.go` (§4), `internal/bridge/terminal.go` (§4),
   `internal/terminal/session_test.go` (§15.1), regenerated bindings, `bridge/index.ts`'s
   `terminalOpen` argument. Go and wiring; nothing user-visible.
2. **`feat(workbench): launch Claude Code from the tab strip's + button`**
   `shared/domain/tabs.ts` (§5.1), `state/tabKinds.ts` (§5.2), `state/repoTabs.ts` (§5.3),
   `state/terminals.ts` + `RepoTerminalView.vue` (§5.4), `TabStrip.vue`'s two built-in entries and
   launch helper (§6.4). The first user-visible half, complete on its own.
3. **`feat(scripts): store the user's own launchable scripts`**
   The migration, model, repo, bound service, `main.go` registration, `shared/domain/scripts.ts`,
   `events.go`/`events.ts`, `bridge/index.ts`, `state/customScripts.ts`, `main.ts`'s hydrate,
   `ipcChannels.ts`/`mockRuntime.ts` harness entries (§8, §9).
4. **`feat(settings): add, edit and remove custom scripts`**
   `state/settings.ts`'s `sections` move and `openSettingsAt` (§10.1), `SettingsDialog.vue`'s
   Scripts section (§10.2).
5. **`feat(workbench): list every custom script in the tab strip's + dropdown`**
   `TabStrip.vue`'s script rows, the conditional separator and `Manage scripts…` (§6.1).
6. **`test(ui): cover the two new launch kinds and the scripts settings section`**
   §15.2's migration, two new `repo-workspace.spec.ts` tests, and `settings-scripts.spec.ts`.

Dependencies: **1 → 2** is real (2 sends 1's field). **3 → 4 → 5** is real (4 edits what 3 stores, 5
lists it). **2 and 3 are independent of each other** but both touch `bridge/index.ts` and the
regenerated bindings, so they run in this order in one tree rather than in parallel. **6 last** — it
asserts against 2, 4 and 5 at once.

## 18. Passes and subagents

**One Sonnet subagent, sequential, commits 1-6.** Not a defaulted choice, and deliberately unlike
P83's real split: commits 2 and 5 rewrite the same 40-line region of `TabStrip.vue` (2 adds the
launch helper and two built-in entries, 5 appends the script rows and the trailing entry to the same
builder), and 1/2/3 all touch `bridge/index.ts` and the same regenerated binding files. That is one
continuous, order-dependent piece of work — exactly what `CLAUDE.md` names as not a parallelisation
candidate. The Go half (commits 1 and 3) is ~250 lines including the repo, which is not enough to
earn a second agent plus a hand merge over three shared files.

Size: ~230 new Go lines plus ~40 of Go test; ~180 new TS lines across the schema, store and service
wiring; ~120 changed lines in `SettingsDialog.vue`; ~70 in `TabStrip.vue`; ~200 lines of Playwright.
One migration. No new dependency, no contract change.

## 19. Open questions

- **OQ-1 (for the user, not blocking).** §10.1 places the Scripts section between `Git` and
  `Code intelligence`. If the preference is for it last (beside `Advanced`) or first, it is a
  one-line reorder of `sections` and one `data-testid` string in `settings-scripts.spec.ts`. The
  implementer should not re-decide this on their own; ship as planned and change it only on request.
- **OQ-2 (for the implementer).** `SettingsDialog.vue`'s `sections` const moves to
  `state/settings.ts` (§10.1). Confirm no lint rule forbids `workbench/**` importing that specific
  name — the direction is permitted (`workbench/` → `state/`), and `SettingsDialog.vue` already
  imports `patchSettings`/`settingsState` from it, so this is a confirmation, not a risk.
- **OQ-3 (closed, recorded so it is not reopened).** Whether to add a `launchKind` discriminator to
  the terminal tab state for P86's benefit. **No** — §11.4. P86 designs its own seam against the
  tree it finds.
- **OQ-4 (closed).** Whether a script should be able to reuse an existing terminal tab.
  **No** — `reuse: false` is P83 §7.3's recorded decision ("a session, not a document") and applies
  identically here; launching the same script twice must give two live processes.

## 20. Dogfooding note

The repo-map MCP server was used for this planning pass, over plain HTTP/JSON-RPC (`CLAUDE.md`
step 4 — the native tool surface is unavailable in an agent-harness session, per its own step-3
caveat). The startup banner hit `CLAUDE.md`'s step-2 hazard, as P84's pass also recorded; deleting
`/root/.kira-studio/mcp-repo-map-fc694cca06c3-token.json` and restarting minted a fresh token and
printed the `claude mcp add` command, exactly as documented.

What it answered well, each replacing a whole-file read:
`search_symbols {"query":"openRepoTerminalTab"}` returned `state/repoTabs.ts:215` with its full
signature line, which is what §5.3's diff is written against;
`read_symbol {"symbol":"OpenParams","file":"apps/kira-studio/internal/terminal/session.go"}`
returned the struct with its doc comment and both callback fields — the single call that settled §1
("is there already a seam for an initial command": no).

One data point worth recording against the log's two open entries, as a **re-check, not a new
finding**: `find_references {"symbol":"openContextMenuAt"}` returned both references including
`TabStrip.vue:208`'s `<script setup>` call, tagged `repoWide`. That is consistent with the open
entries as written — they scope the gap to *non-call* reads, and this is a call. Nothing new to log,
and manufacturing an entry for a working query would be the invented finding `CLAUDE.md` warns
against. `docs/v1.8/mcp-repo-map-issues.md` gets no entry from this pass.
