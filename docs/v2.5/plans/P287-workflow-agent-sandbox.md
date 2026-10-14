# P287 plan: Workflow agent sandbox (macOS Seatbelt)

Source: `docs/v2.5/SPEC.md` row P287. Depends on P279 (resume) and P286 (review step), both landed.
Base `dfd15fb3d`.

Ask, condensed: headless workflow agents run under a Kira-generated Seatbelt profile (`sandbox-exec`).
Per-step policy. Read-only step: reads configured folders, writes only its scratch. Implementation step:
full rights inside its worktree only. Ad hoc agents (rebase, review rounds, smart scripts) write only
their worktree. Agents cannot create or remove branches or worktrees; no write to the common `.git`
beyond what the worktree needs. Branch and worktree creation only through in-app Kira MCP tools.
Linux/Windows: policy declared, not enforced, clear notice. `claude` permission flags as a second layer.

Discovery: `codegraph_explore` over `claudeheadless/{process,env,mcp,space,gittool}.go`,
`ade/{runs,rebase,reviewstep,smartstep,steps,agenttools,board}.go`, `adeflow/{parse,writer}.go`,
`scriptruns/{preview,smart_run}.go`, `model/settings.go`, `AdeStepInspector.vue`, `workflowForm.ts`,
`stepResults.ts`, `progress.ts`, `adeWorkflowDraft.ts`. Main-checkout indexes (root and
`apps/kira-space`) at the base commit. Bash for `fakeagent`, `tests/claude`, docs, migrations.

## 0. How things work today

- One exec site per kind. `claudeheadless.Run` builds `Script(spec)` (`exec claude -p … --mcp-config …
  --setting-sources … --allowedTools … --disallowedTools …`) and runs it under the user's login shell
  (`loginshell.BuildArgv`), `Setsid`, cwd `spec.Dir`, prompt on stdin.
- Callers of `claudeheadless.Run`: `ade.superviseAgent` (step runs incl. smart steps, review rounds
  `purpose = review`, rebase runs `purpose = rebase`) and `scriptruns.launchSmart` (smart scripts; ADE
  task runs use dir mode `worktree`). TUI sessions (user stages, `TakeOver`) launch through
  `internal/terminal`, not here.
- In-app MCP server `kira-ade` (`claudeheadless.Server`): HTTP on a loopback TCP port, one bearer token
  per `Grant`. Tools: `finish_step`, `run_outcome`, Space tools (`task_info`, `declare_repos`,
  `request_branch` = create branch **and** worktree through `TaskBoard.RequestBranch` →
  `validateAgentBranch` + `ensureWorktree`, `branch_status`) when the workflow sets `kira_space_mcp`,
  `git` (validated subset, rebase runs only), `reply_review_comment` (review rounds).
- Rebase runs are already "sandboxed" at the tool level: `Isolated`, built-ins only, git through the
  in-app `git` tool. No OS-level restriction exists anywhere today; an agent's `Bash` can
  `git branch`, `git worktree add`, write `~`, push with the user's credentials.
- Step model: agent stage step `PipelineStep` (`prompt`/`allowed_tools` | `smart_script`/`params` |
  `review`), `results`, `timeout`. Editor: `AdeStepInspector.vue` modes `prompt | smart | review`.
- Remote ops in app: `RepoEntry.RunRemote(kind fetch|push|forcePush…)` with askpass credential routing
  (`TaskBoard.ForcePush` precedent).

## 1. Decisions (final)

1. **New shared package `internal/agentsandbox`.** Policy model, SBPL generator, git layout probe,
   runtime discovery, enforcer (darwin real, other OS notice), deny watcher, allowlist proxy. Why: both
   `ade` (apps/kira-space) and `scriptruns` (internal) launch agents; `internal/` cannot import an app.
2. **Library check: no sandbox library.** Declined `@anthropic-ai/sandbox-runtime` (Apache-2.0):
   Node package (Go backend), generates its profile at runtime (no Go golden snapshot), wraps only the
   `Bash` tool not the `claude` process, and its Linux bubblewrap mode contradicts "declared, not
   enforced" on Linux. The spec asks Kira to generate SBPL; nothing in Go does.
   **Adopted `github.com/elazarl/goproxy` (BSD-3-Clause, all features used are in the open package)**
   for the network-off allowlist proxy (CONNECT filter, upstream proxy chaining). Why: library rule;
   CONNECT handling plus chaining is infrastructure.
3. **Profile base: `(allow default)` then explicit denies and re-allows; last matching rule wins.**
   Why: the CLI, node/bun, git and build tools need many mach services, sysctls and execs that change
   with CLI updates; the policy's guarantees are about file writes, chosen reads, network, keychain,
   AppleEvents, LaunchServices and signals, which the profile denies explicitly. Residual risk is
   recorded (Known open items).
4. **Reads restricted by `file-read-data`, never `file-read-metadata`.** Why: `realpath`/`lstat` of
   path ancestors must work for node and git; data and directory listings stay denied.
5. **Paths rendered literally into the profile** (SBPL string literals, `\` and `"` escaped), after
   `filepath.EvalSymlinks` (Seatbelt matches real paths: `/var` → `/private/var`, `/tmp` →
   `/private/tmp`). User-supplied text never enters a regex; only Kira's fixed patterns and
   `regexp.QuoteMeta`-quoted home/common-dir prefixes do. Why: one self-contained file the user can view
   and reproduce with `sandbox-exec -f`.
6. **Scope: every headless agent from `superviseAgent`, plus `scriptruns` smart runs in dir mode
   `worktree`.** Not sandboxed: TUI sessions (user stages, `TakeOver`), script stages, worktree setup
   scripts, memory/importer `claude` calls, Automations smart scripts in folder modes
   (`kira | fixed | home`). Why: the spec targets workflow agents; TUI sessions are user-driven; folder
   automations have no delegated worktree.
7. **Default policy when a step has no `sandbox` block: `access: write`, no extra paths, network on.**
   Applies to existing workflows after upgrade. Why: a missing block meaning "off" would leave every
   existing workflow able to create branches, defeating the phase. `access: off` exists per step as a
   visible escape hatch (warning badge), so no one edits YAML around it.
8. **Keychain denied by default, one Space setting `ade.sandboxKeychain` (default false), no per-step
   field.** Why: keychain access is how the user's `claude` signs in, an account fact, not a step fact.
   Kira never reads the keychain or Claude credentials. Off: `claude` signs in from env
   (`CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`, `ANTHROPIC_API_KEY`, Bedrock/Vertex) set in the
   login shell profile. A sign-in failure in a keychain-denied run maps to a clear error naming both
   fixes (§6.4).
9. **Network: `network: true` (default) = unrestricted except the SSH agent socket. `false` = loopback
   only plus an in-app allowlist proxy (`HTTPS_PROXY`) reaching the Claude API hosts only.** Why:
   Seatbelt cannot filter by host name and `claude` itself needs the API; the proxy makes "off" true for
   everything but the model API.
10. **SSH agent socket always denied, `SSH_AUTH_SOCK` unset.** Why: agents never push; with the socket
    an agent could `git push` any refspec remotely (the local remote-tracking write fails only after).
11. **Git access minimal (§3.4).** Worktree read-write except its `.git` file; per-worktree gitdir
    read-write except `gitdir`, `commondir`, `locked`, `config.worktree`; common objects append-only;
    own branch ref, its lock and reflog writable; everything else in the common dir read-only.
    Why: commit, amend, rebase in place and stage all work; branch/worktree/tag/stash/remote-ref writes,
    `packed-refs` rewrites, config and hooks writes all fail with EPERM.
12. **MCP tools (§5):** branch and worktree creation stays `request_branch` (one call creates both,
    validated, task-registered). New `fetch_remote` and `push_branch`, in app, unsandboxed, granted to
    sandboxed runs with a task branch. Not added: separate `create_branch`/`create_worktree`. Why: a
    branch without a worktree is useless to a sandboxed agent (it cannot check it out) and ADE tasks hold
    one branch per repo; two tools doing half of `request_branch` duplicate its validation.
13. **Second layer = `claude` permission flags (§4).** Why: refuses early with a clear message inside
    the CLI; on Linux it is the only layer, and the notice says it does not stop shell commands.
14. **Deny logging: one shared `/usr/bin/log stream` child on darwin while ≥1 sandboxed run is live;
    events attributed by pid ancestry to the run (§6).** Why: Seatbelt reports denials only to the
    unified log; `log` ships with macOS (no library).
15. **Denials surface three ways:** live run badge (count, last denial), run log line, outcome reason
    when the run fails; plus a prompt rule telling the agent to stop on EPERM and report the path through
    `finish_step`. Why: "clear error, not silent hang"; the step timeout stays the last guard.
16. **Linux/Windows: profile still generated and stored (golden-identical), never applied.** Run badge
    "Sandbox not enforced", editor notice, prompt note "declared, not enforced", log first line. Why:
    never pretend; the user sees exactly what macOS would enforce.
17. **macOS without `/usr/bin/sandbox-exec` or with a profile that fails to compile: the run fails
    before `claude` starts** (fail closed), message names the cause. Preflight:
    `sandbox-exec -f <profile> /usr/bin/true` per launch (~10 ms). Why: a promised policy never silently
    drops.
18. **Build caches redirected, not opened.** Sandboxed env sets `XDG_CACHE_HOME`, `GOCACHE`,
    `GOMODCACHE`, `GOFLAGS=-modcacherw`, `npm_config_cache`, `BUN_INSTALL_CACHE_DIR`, `PIP_CACHE_DIR`,
    `YARN_CACHE_FOLDER` to `<AgentDir>/sandbox-cache/<name>` (shared by sandboxed runs, writable).
    Why: builds and tests work by default without granting writes to the user's own caches.
19. **Review step (P286) takes a `sandbox` block; its rounds use it.** Default `write` (rounds commit
    change requests). Implementer-route rounds resume the implementer session under the review step's
    policy, not the implementer step's. Why: the review step owns its rounds; P286 already treats rounds
    as implementation-class.
20. **Rebase runs write every worktree of their stack** (`GitGrant.Worktrees`). Why: one stack rebase
    edits conflicts in each stacked worktree; splitting the run is out of scope. Rebase git still runs
    through the in-app `git` tool, unchanged.
21. **Smart steps write their run dir** (the worktree with `UseAdeDir`, else the script's folder) and
    read the worktree. Why: that folder is the step's delegated place.
22. **TakeOver of a sandboxed run opens an unsandboxed TUI**, with a hint on the button. Why: the user
    drives it; TUI launches are a different exec site.
23. **Profile and resolved policy stored per run** (table `ade_run_sandbox`). Why: the run UI shows
    exactly what ran even after the generator or workflow changes.

## 2. Workflow schema

```yaml
- id: implement
  name: Implement
  prompt: Implement the task.
  sandbox:            # optional; absent = default below
    access: write     # write | read | off. Default write.
    read:             # extra read-only folders. Default [].
      - ~/specs/payments
    allow:            # extra read-write paths. Default [].
      - ~/.cache/my-tool
    network: true     # true | false. Default true.
```

- `adeflow/parse.go`: step fields add `sandbox`. Mapping with only `access`, `read`, `allow`,
  `network`. `access` in `write|read|off` else "access must be write, read or off". `read`, `allow`:
  lists of strings, each ≤ 32 entries, each path absolute or `~/…`, ≤ 4096 bytes, no NUL or newline,
  not `/`, not `~` alone, not under `~/Library/Keychains` ("path %q is not allowed"). `network` bool.
  `off` with `read`/`allow`/`network: false` → "sandbox off takes no other keys". Allowed with prompt,
  smart and review steps.
- `adewire.PipelineStep` gains `Sandbox StepSandbox \`json:"sandbox"\`` (value, always set):
  `{Access string "access"; Read []string "read"; Allow []string "allow"; Network bool "network"}`.
  Parser fills the default when absent. TS `sandbox: StepSandbox`.
- `writer.go`: `stepOrder` adds `sandbox` after `review`; nested order `access, read, allow, network`.
  The key is omitted when the value equals the default. Why: old files stay unchanged on save.
- `stepDef` gains `Sandbox adewire.StepSandbox`; `stageSteps` copies it. A snapshot without the field
  decodes to the zero value: `stageSteps` maps zero `Access` to the default.
- `workflowForm.ts` `newStep` sets the default; `defaultSandbox()` in new `board/stepSandbox.ts`.
- **P286 interplay:** `setMode` keeps `sandbox` across mode switches (it is not mode-specific).
  **P288 interplay:** P288's return-limit field and add/remove move live in the same inspector and graph
  surface; P287 adds only the inspector Sandbox section and a node badge, nothing on the toolbar.

## 3. Policy and profile (`internal/agentsandbox`)

### 3.1 Types

```go
type Access string // "write" | "read" | "off"

// Policy is what one run may do, resolved to real paths.
type Policy struct {
    Access   Access
    Write    []string // worktrees (write access); rebase: the stack
    RunDir   string   // cwd; equals Write[0] for worktree runs
    Read     []string // step read folders + the worktree for read access
    Allow    []string // step allow paths (read-write)
    Network  bool
    Keychain bool
    Git      []GitLayout // one per written or read worktree
    Scratch  string      // <AgentDir>/sandbox/<runID>, TMPDIR
    Cache    string      // <AgentDir>/sandbox-cache
    Ports    []int       // kira-ade MCP port, proxy port (network off)
    Branch   map[string]string // worktree -> branch it may advance
}

type GitLayout struct {
    Worktree, GitDir, CommonDir string // GitDir == CommonDir for a main worktree
}

type Runtime struct {
    Home, ClaudePrefix string
    PathPrefixes []string // read-only toolchain prefixes under Home
    UserTemp, UserCache string // getconf DARWIN_USER_TEMP_DIR / DARWIN_USER_CACHE_DIR
    SSHAuthSock string
}
```

- `ResolvePolicy(in Input, rt Runtime) (Policy, []string /*notes*/, error)`: expands `~/`, canonicalizes
  with `EvalSymlinks`. A missing `read`/`allow` path is skipped with a run note
  `sandbox path missing: <p>`; a missing worktree is an error.
- `ProbeGit(worktree)`: reads `<wt>/.git`. A file → `gitdir: <path>` → `GitDir`; `<GitDir>/commondir`
  → `CommonDir`. A directory → main worktree, `GitDir = CommonDir = <wt>/.git`. Kira reads, unsandboxed.
- `DiscoverRuntime()` (cached per app session): `Home` from `os.UserHomeDir`; claude prefix from the
  resolved binary's real path (two levels up from `bin/claude`, or its install dir for the native
  installer); login-shell PATH via the existing `toolexec` shell probe (`printf %s "$PATH"`, 5 s): each
  entry under `Home` contributes its parent (the entry itself when the parent is `Home`); darwin temp
  dirs via `getconf`. Failures shrink the set and log once.

### 3.2 Profile layout (`Profile(p Policy, rt Runtime) string`)

Sections in this order (later wins). `H` = home, `C` = common dir.

1. Header: `(version 1)`, comment with run id, access, network, generator version `kira-sbpl/1`.
2. `(allow default)`.
3. Escapes: `(deny appleevent-send)`; `(deny mach-lookup (global-name "com.apple.coreservices.launchservicesd") (global-name-prefix "com.apple.lsd.") (global-name "com.apple.pasteboard.1"))`;
   `(deny signal)` then `(allow signal (target same-sandbox))`.
4. Keychain (off): `(deny mach-lookup (global-name "com.apple.SecurityServer") (global-name-prefix "com.apple.securityd") (global-name-prefix "com.apple.security."))`.
   `com.apple.trustd*` stays allowed (TLS trust).
5. Reads: `(deny file-read-data (subpath "/Users") (subpath "/Volumes") (subpath H))`, then
   `(allow file-read-data …)`: runtime set (`H/.claude`, regex `^H/\.claude\.json`, `H/.gitconfig`,
   `H/.config/git`, shell rc files `.zshenv .zprofile .zshrc .zlogin .bashrc .bash_profile .profile`,
   `H/.kira-memory`, `PathPrefixes`, `ClaudePrefix`), `Read`, `Allow`, each `Write` worktree, each
   `GitDir` and `CommonDir`, `Scratch`, `Cache`. Keychain on: also `H/Library/Keychains`.
   Then `(deny file-read-data (subpath "H/Library/Keychains"))` when keychain off (after re-allows).
6. Writes base: `(deny file-write*)`; `(allow file-write* …)`: `/dev/null`, `/dev/zero`, `/dev/tty`,
   `/dev/dtracehelper`, regex `^/dev/ttys[0-9]+$`, regex `^/dev/fd/`, `Scratch`, `Cache`, `UserTemp`,
   `UserCache`, `H/.claude`, regex `^H/\.claude\.json`, `H/.kira-memory`.
   Then `(deny file-write* …)` on `H/.claude/{settings.json,settings.local.json,CLAUDE.md,keybindings.json}`
   and subpaths `H/.claude/{commands,agents,skills,plugins,hooks,output-styles}`.
7. `Allow` paths: `(allow file-write* …)`.
8. Write access: each worktree subpath; per worktree §3.4 git rules.
9. Git protections last (§3.4), so no `allow` path reopens the common dir.
10. Network (§3.5).

Read access: sections 8 omits worktree writes; worktree and git dirs are readable via section 5.
Env for read access adds `GIT_OPTIONAL_LOCKS=0` (no opportunistic index refresh).

### 3.3 `claude` needs, final

| Need | Rule |
|---|---|
| `~/.claude` (transcripts, todos, shell snapshots, statsig, ide) | read-write; config, hook and extension files denied (§3.2.6) |
| `~/.claude.json` and its backup, lock, temp files | read-write (regex); open item: it holds user MCP servers |
| node/bun runtime, claude install | read via `ClaudePrefix`, `PathPrefixes`; system dirs readable by default |
| network | §3.5 |
| tmp | `TMPDIR=<Scratch>/tmp`; darwin per-user temp and cache dirs writable (frameworks use them regardless of `TMPDIR`); `/private/tmp` not writable |
| git config | `~/.gitconfig`, `~/.config/git` read-only |
| SSH agent socket | denied, `SSH_AUTH_SOCK` unset |
| keychain | denied unless `ade.sandboxKeychain` |
| MCP servers | `kira-ade` on loopback TCP (allowed). Stdio servers are children, same profile. `kira-memory` writes `~/.kira-memory` (allowed). Other servers' paths go in `allow` |
| shell for `Bash` tool | rc files readable for its env snapshot |

### 3.4 Git rules (per `GitLayout`, write access)

Linked worktree (`G` = `GitDir`, `C` = `CommonDir`, `b` = branch):
- `(allow file-write* (subpath G))`.
- `(allow file-write* (subpath "C/objects"))`.
- `(allow file-write* (literal "C/refs/heads/b") (literal "C/refs/heads/b.lock") (literal "C/logs/refs/heads/b") (literal "C/logs/refs/heads/b.lock"))`;
  `(allow file-write-create (literal …))` for each missing-or-existing ancestor dir of `b` under
  `C/refs/heads` and `C/logs/refs/heads` (a branch only in `packed-refs` gets its loose ref).
- Protections (section 9, after `Allow`):
  `(deny file-write* (literal "<wt>/.git") (literal "G/gitdir") (literal "G/commondir") (literal "G/locked") (literal "G/config.worktree"))`;
  `(deny file-write-unlink (literal G))`;
  `(deny file-write* (subpath C))` then re-allow exactly the objects and own-ref rules above;
  `(deny file-write-unlink file-write-data file-write-mode (regex #"^C/objects/[0-9a-f]{2}/[0-9a-f]{38,62}$" #"^C/objects/pack/pack-[0-9a-f]+\.(pack|idx|rev|bitmap|keep)$"))`
  (objects append-only: new loose objects and their `tmp_obj_*` files work; existing objects never change).
- Main worktree (`G == C`, inside the worktree subpath): after `(deny file-write* (subpath C))`,
  re-allow per-worktree state literals and subpaths in `C`: `index`, `index.lock`, `HEAD`, `HEAD.lock`,
  `ORIG_HEAD`, `AUTO_MERGE`, `MERGE_HEAD`, `MERGE_MSG`, `MERGE_MODE`, `CHERRY_PICK_HEAD`,
  `REVERT_HEAD`, `COMMIT_EDITMSG`, `logs/HEAD`, `rebase-merge/`, `rebase-apply/`, `sequencer/`, plus the
  objects and own-ref rules.
- Env: `GIT_CONFIG_COUNT=2`, `gc.auto=0`, `maintenance.auto=false`. Why: auto gc rewrites
  `packed-refs` and packs; it would fail noisily.

Outcome: `git branch x`, `git checkout -b`, `git worktree add|remove|prune`, `git tag`, `git stash`,
`git fetch`, `git update-ref` of other refs, `git config` (repo), hook edits, `rm -rf .git/objects` all
fail with EPERM. `git commit`, `--amend`, `rebase` of the own branch onto a readable ref, `reset`,
`add`, `restore` work. Fetch and push go through the tools.

### 3.5 Network

- On: no network rules beyond `(deny network-outbound (remote unix-socket (path-literal "<SSH_AUTH_SOCK>")))`.
- Off: `(deny network*)`; `(allow network* (local ip "localhost:*") (remote ip "localhost:*"))`
  (tests bind local servers; MCP and proxy are on loopback); `(allow network-outbound (remote unix-socket))`;
  then the SSH socket deny. Env: `HTTPS_PROXY`/`HTTP_PROXY`/`https_proxy`/`http_proxy` =
  `http://127.0.0.1:<proxyPort>`, `NO_PROXY=localhost,127.0.0.1,::1`, `DISABLE_TELEMETRY=1`,
  `DISABLE_ERROR_REPORTING=1`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`.
- Proxy (`agentsandbox/proxy.go`, goproxy, one per app, started on first network-off launch, loopback
  only): CONNECT only, port 443, host in allowlist: `anthropic.com` and subdomains, `claude.ai`,
  `claude.com` and subdomains, hosts of `ANTHROPIC_BASE_URL`, `ANTHROPIC_BEDROCK_BASE_URL`,
  `ANTHROPIC_VERTEX_BASE_URL` from Kira's env, `*.amazonaws.com` when `CLAUDE_CODE_USE_BEDROCK=1`,
  `*.googleapis.com` when `CLAUDE_CODE_USE_VERTEX=1`. Anything else: 403, logged as a denial
  (`network`, host) on the run that owns the connection (proxy reads a per-run `Proxy-Authorization`
  token, set in the run's proxy URL as `http://kira:<token>@127.0.0.1:<port>`). Upstream: Kira's
  `HTTPS_PROXY` when set (goproxy `ConnectDialToProxy`).

### 3.6 Launch composition

- `claudeheadless.Spec` gains `Sandbox *SandboxExec{Profile string; Env []string; Unset []string}`.
  `Script` with `Sandbox` set emits
  `exec /usr/bin/env -u SSH_AUTH_SOCK [-u …] K=V … /usr/bin/sandbox-exec -f '<profile>' <bin> -p …`.
  Why: the login shell sources the user's profile first; overrides placed after it win, and `exec`
  keeps one pid (shell → env → sandbox-exec → claude).
- `Handler.OnStart func(pid int)` (called after `cmd.Start`). Feeds the deny watcher.
- Profile file `<Scratch>/profile.sb` (0600). Scratch `tmp/` emptied at run end; profile kept with the
  run row (§7.1), scratch dir removed at run end.
- `agentsandbox.Enforcer` interface (injected; prod `System()`, flow tests `sandboxtest.Fake`):

```go
type Support struct{ Enforced bool; Reason string } // Reason: i18n key when not enforced
type Enforcer interface {
    Support() Support
    Prepare(p Policy, rt Runtime) (Prepared, error) // writes profile, preflights on darwin
    Watch(pid int, runID string, on func(Denial)) (stop func())
}
type Prepared struct {
    Profile, ProfilePath string
    Exec   *claudeheadless.SandboxExec // nil when not enforced
    Env    []string // TMPDIR, caches, git config, proxy (both platforms)
    AddDirs, Disallowed []string // §4
}
```

  `System()` on darwin: enforced; other GOOS: `Support{false, "backend.space.ade.sandbox.notEnforced.body"}`.

## 4. `claude` flags (second layer)

Applied by `agentsandbox.Flags(p Policy)` on every platform when `access != off`:
- `--add-dir`: `Read` and `Allow` paths (claude's own working-directory check), plus `Scratch`.
- `--disallowedTools`: `Edit(//<r>/**)` for each `Read` folder; read access: `Edit`, `Write`,
  `NotebookEdit`; always `Bash(git branch:*)`, `Bash(git worktree:*)`, `Bash(git checkout -b:*)`,
  `Bash(git switch -c:*)`, `Bash(git push:*)`, `Bash(git fetch:*)`, `Bash(git tag:*)`,
  `Bash(git stash:*)`; network off: `WebFetch`, `WebSearch`.
- Merged with the step's `DisallowedTools` (rebase's own list stays).

## 5. MCP tools

`claudeheadless.Grant` gains `Sandbox *SandboxGrant{Push bool}` (set for sandboxed runs with a task
branch: steps, review rounds, ADE smart runs; `Push` = write access). Tools registered on the per-run
server (`buildMCPServer` gains the flag; `sharedServer` key grows to 5 flags).
`Options.SandboxGit SandboxGit` (`*ade.TaskBoard` implements):

```go
type SandboxGit interface {
    FetchRemote(ctx context.Context, runID, remote string) (RemoteResult, error)
    PushBranch(ctx context.Context, runID string, force bool) (RemoteResult, error)
}
type RemoteResult struct { Remote, Branch, Output string } // json: remote, branch, output
```

- `fetch_remote {remote?: string}`: run → branch → repo. `remote` default `origin`; must be one of
  `git remote` names (else tool error `remote must be one of: …`); ≤ 255 bytes, no leading `-`.
  `RunRemote(kind fetch, Remote)` under the repo mutex, askpass routing as `ForcePush`. Output trimmed
  to 8 KiB.
- `push_branch {force?: bool}`: `Push` grant required (else `push is not allowed in a read-only step`).
  Branch = the run's task branch (never an argument). Worktree HEAD must be `refs/heads/<branch>`
  (else `your worktree is not on <branch>`). Remote = `branch.<b>.remote` else `origin`. Protected
  branches (`git.protectedBranches`) refused. `force` → `RunRemote(kind forcePush)` with the preflight
  lease, else `kind push` with `SetUpstream` when no upstream. Board refresh after.
- Rebase runs keep `git` (unchanged). Space tools keep their gate (`kira_space_mcp`); with it off a
  sandboxed agent has no branch creation at all, which is the intent.
- `scriptruns` Space-bound smart runs: same grant; `scriptruns.Service` gets an optional `SandboxGit`
  (Space wires the board; Studio passes nil and never sandboxes).

## 6. Denials

### 6.1 Watcher (darwin)

- `agentsandbox.watcher`: started on first `Watch`, stopped when no run is watched (30 s grace).
  Child: `/usr/bin/log stream --style ndjson --level default --predicate 'sender == "Sandbox" AND eventMessage CONTAINS " deny("'`.
  Parse `eventMessage` `Sandbox: <proc>(<pid>) deny(<n>) <op> <target>`.
- Attribution: pid alive → walk `ppid` (`unix.SysctlKinfoProc("kern.proc.pid", pid)`) up to a watched
  root pid. Pid gone: exactly one watched run → it; else dropped with one app log line
  (`ade: unattributed sandbox denial`).
- Per run: dedupe `(op, target)`; keep first 50; count all. Callback `on(Denial{At, Op, Target, Process})`.
- Child dies: restart with backoff (1 s, 5 s, 30 s); after 3 failures log and continue without denials
  (outcome mapping §6.3 still works from the agent's report).

### 6.2 Board wiring

- `superviseAgent`: `Watch` after `OnStart`; on each denial: append run log line
  `sandbox denied <op> <target> (<process>)` (stream `stderr`), update `ade_run_sandbox` (count,
  list), emit runs (badge updates live). Proxy refusals arrive through the same callback.
- `scriptruns`: log line only.

### 6.3 Outcome mapping

- Run ended `failed` or `needs_input` with denials > 0: outcome reason gets prefix
  `Sandbox blocked <op> <target>.` (first denial; i18n `backend.space.ade.sandbox.blocked.body`), unless
  the agent's own reason already names the target.
- Prompt rule (§8) makes the agent stop on EPERM and report the path; timeout remains the last guard.

### 6.4 Sign-in failure

Run sandboxed, keychain off, ended failed without `finish_step`, and last stderr or the result event
matches `/login|invalid api key|not logged in|oauth/i` → outcome reason =
`backend.space.ade.sandbox.auth.body`: "Claude could not sign in: the sandbox blocks the keychain.
Turn on Keychain access in Settings > Claude Code, or set CLAUDE_CODE_OAUTH_TOKEN (claude setup-token)."
Same mapping in `scriptruns.decide` for sandboxed runs.

## 7. Engine, storage, settings (Space)

### 7.1 Migration `0037_p287_run_sandbox.sql`

```sql
CREATE TABLE ade_run_sandbox (
  run_id TEXT PRIMARY KEY REFERENCES ade_runs (id) ON DELETE CASCADE,
  access TEXT NOT NULL CHECK (access IN ('write', 'read', 'off')),
  enforced INTEGER NOT NULL,          -- 0 on Linux/Windows or access off
  reason TEXT NOT NULL DEFAULT '',    -- i18n key when not enforced
  policy_json TEXT NOT NULL,          -- resolved Policy (paths, network, keychain)
  profile TEXT NOT NULL DEFAULT '',   -- SBPL text as written; '' for access off
  denial_count INTEGER NOT NULL DEFAULT 0,
  denials_json TEXT NOT NULL DEFAULT '[]'
);
```

`repos.AdeRunSandboxRepo{Insert, Get, AddDenial}`. Runs before P286's rows need nothing.
P288 adds its own later migration number.

### 7.2 Launch path

- New `ade/sandbox.go`: `b.sandboxFor(run, def, launch) (agentsandbox.Policy, notes, error)`:
  step/smart/review run → `def.Sandbox`; rebase → write, `Write = rebaseWorktrees(spec)`, network true;
  smart step → `RunDir = smart.dir`, `Read += worktree` when they differ. `Keychain =
  deps.SandboxKeychain()`. `Ports` = `b.agent` port (+ proxy port when network off).
- `superviseAgent` (after `Register`): `access off` → no sandbox, row stored (`access off`, enforced 0).
  Else `Prepare` → error = launch failure (`fail(err)`, message from §1.17). Apply `Prepared`:
  `spec.Sandbox = Exec`, `spec.Env += Env` (removing `SSH_AUTH_SOCK`), `AddDirs`, `DisallowedTools`.
  Insert `ade_run_sandbox`. Prompt: §8 note appended at prompt composition (startRun, review round,
  rebase), not in `superviseAgent`.
- `TaskBoardDeps` gains `Sandbox agentsandbox.Enforcer`, `SandboxKeychain func() bool`; `appwire` wires
  `agentsandbox.System()` and the settings leaf.
- `TakeOver`, `RetryRun`, `ResumeRun`: resumed or retried runs resolve the policy again from the current
  snapshot (new run id, new row).
- `scriptruns.launchSmart`: dir mode `worktree` and a non-nil `Sandbox` enforcer → default write policy
  on `p.dir.Path`, same `Prepare`, log lines, §6.4 mapping. `scriptruns.Service` gains `Sandbox`,
  `SandboxKeychain`, `SandboxGit` (nil in Studio).

### 7.3 Settings

- `model.AdeSettings.SandboxKeychain bool \`json:"sandboxKeychain"\`` default false; `AdePatch`,
  `upsertAde`/`readAde`, TS `settingsDomain` schema, `SettingsSections` `ade` Pick adds it.
- UI: the pane that edits `headlessSettingSources` (Claude Code pane) gains a shadcn `Switch`
  "Keychain access for sandboxed agents" with hint and the platform notice when not enforced.

### 7.4 IPC (`bridge/adetask.go`, `adewire`)

- `Run.Sandbox *RunSandboxBadge {access, enforced, denials int, last string}` (null for script runs).
- `RunSandbox(RunArgs) (RunSandboxDetail, error)`: `{access, enforced, reason, write[], read[], allow[],
  network, keychain, profile, denials: Denial[] {at, op, target, process}, denialCount}`.
- `WorkflowsResult.Sandbox SandboxSupport {enforced, reason}` (editor notice without a new query).
- TS wire, `bridge/index.ts` `adeTaskRunSandbox`, `queries.ts` `useRunSandbox(runId)` (TanStack, key
  `['ade', 'runSandbox', runId]`, invalidated by runs events for that id). Mock runtime handlers.

## 8. Prompts (`internal/llmprompts/registry.go`)

All new entries terse (P289 rule), each with a `budget.tsv` line holding the measured rendered-example
rune count (`go run ./internal/llmprompts/cmd/promptsizes`), golden files and catalog keys
`llmPrompts.entry.<camelId>.{title,description,usedBy.body}` like existing entries. `checkprompts`
runs in `bun run lint`.

- `headless.sandbox.note` (`KindFragment`), vars `SandboxNoteVars{Access, Worktree string; Read
  []string; Network, Enforced, Tools bool}`:

```
Sandbox{{if not .Enforced}} (declared, not enforced){{end}}: {{if eq .Access "write"}}write only in {{.Worktree}} and $TMPDIR{{else}}read only; write only in $TMPDIR{{end}}.{{range .Read}}
Read also: {{.}}{{end}}{{if not .Network}}
Network: Claude API only.{{end}}{{if .Tools}}
No git branch, worktree, tag, stash, fetch or push. Use request_branch, fetch_remote, push_branch.{{end}}
"Operation not permitted" means the sandbox blocked it. Do not retry. Call finish_step failed; name the path in reason.
```

  Appended after the step prompt (`composePrompt`, resume prompt, review round prompts, smart step
  suffix, rebase prompt with `Tools` false). Rebase and review-round prompts keep their own text.
- `headless.tool.fetch_remote` (`KindTool`): `Fetch a remote of your repo. Runs in Kira, outside the
  sandbox.` Arg `remote`: `Remote name. Default origin.`
- `headless.tool.push_branch` (`KindTool`): `Push your worktree's branch to its remote. Only that
  branch.` Arg `force`: `true pushes with --force-with-lease. Default false.`
- `headless.space.instructions` unchanged (already says "only with request_branch").
- Prompt-count assertions and golden data updated.

## 9. UI (Space frontend; shadcn-vue, Tailwind, VueUse, TanStack Query, i18n catalog)

### 9.1 Step inspector

`AdeStepInspector.vue` gains a **Sandbox** section (new `AdeStepSandbox.vue`, `ade-wf-step-sandbox`),
shown for all three modes:
- Access: `SecondaryTabs` segmented `Write worktree | Read only | Off` (`ade-wf-sandbox-access-*`).
  Default Write. Off shows an amber `Alert` "Agent runs with your full rights." (`ade-wf-sandbox-off`).
- Read folders, Allow paths: one path per line `Textarea` each (`ade-wf-sandbox-read`,
  `ade-wf-sandbox-allow`), parsed like tools; inline error for a path that is not absolute or `~/`.
  Presets `DropdownMenu` "Add toolchain" (`ade-wf-sandbox-preset`): Go (`~/go`, `~/Library/Caches/go-build`),
  Node (`~/.npm`, `~/.nvm`, `~/.bun`), Rust (`~/.cargo`, `~/.rustup`), Python (`~/.pyenv`,
  `~/Library/Caches/pip`) appended to Allow.
- Network: `Switch` (`ade-wf-sandbox-network`), hint "Off: Claude API only."
- Platform notice `Alert` when `WorkflowsResult.sandbox.enforced` is false
  (`ade-wf-sandbox-notice`): "Not enforced on this OS: macOS only. Claude permission rules still apply;
  they do not stop shell commands."
- Draft store uses `patchStep`; no store change beyond the field.
- `AdeStepNode.vue`: badge `Read only` (neutral) or `No sandbox` (amber) when not default write;
  nothing for the default (less chrome).

### 9.2 Run line and run panel

- Run line (`AdeStageBlock.vue` / `stageBlocks.ts`): `AdeRunSandboxBadge.vue` (`ade-run-sandbox`):
  lock icon + `Write` / `Read only` / `No sandbox`; grey "Not enforced" variant on Linux; amber with
  count when `denials > 0` ("2 blocked"). Click opens a shadcn `Popover` (`ade-run-sandbox-popover`):
  write/read/allow lists, network, keychain, enforced line, last 50 denials (op, path, process, time),
  "View profile" opens a `Dialog` with the profile in a read-only `<pre>` and Copy (VueUse
  `useClipboard`).
- `AdeRunOutcome.vue`: outcome reason already carries §6.3/§6.4 text; when denials > 0 a
  `Sandbox blocked` chip links to the popover.
- TakeOver button tooltip on a sandboxed run: "Takes over without the sandbox."
- i18n keys (`packages/theme/src/i18n/en.json`): `space.ade.sandbox.{write,read,off,notEnforced,
  blocked}.label`, `…popover.{write,read,allow,network,keychain,denials,viewProfile,copy}.label`,
  `…takeOver.hint`, `space.ade.workflows.sandbox.{title,access,read,allow,network,preset,offWarning,
  notice,pathInvalid}.*`, `settings.claudeCode.sandboxKeychain.{label,hint}`,
  `backend.space.ade.sandbox.{notEnforced,blocked,auth,noSandboxExec,profileInvalid,pathMissing}.body`.
  Catalog lint rules apply.

## 10. Tests (split at the IPC boundary)

| Scenario | Go side | UI side |
|---|---|---|
| Profile generation | `agentsandbox/profile_test.go`: golden `testdata/*.sb` for write linked worktree, write main worktree, read with folders, network off, keychain on, rebase stack, smart run dir, `allow` overlapping the common dir (protections still last), path escaping (quote, backslash, space). Fixed fake paths, every platform. `-update` flag rewrites | — |
| Policy resolution | `policy_test.go`: `~/` expansion, symlink canonicalisation, missing path note, parser refusals live in `adeflow_test.go` | — |
| Launch script | `claudeheadless/process_test.go`: `Script` with `Sandbox` (env `-u`, order, quoting) | — |
| Enforcement (darwin only) | `agentsandbox/enforce_darwin_test.go` (`//go:build darwin`): temp fake home, repo + linked worktree + second branch; under `sandbox-exec`: worktree write ok; `git commit` ok; write outside denied; `git branch x`, `git worktree add`, `git update-ref refs/heads/main`, `git tag`, unlink of an object, write to `.git` file all denied; read of a home file denied, read folder ok; read access: worktree write denied, scratch ok; network off: direct connect to `1.1.1.1:443` denied, loopback ok; watcher reports the `git branch` denial for the root pid within 5 s | — |
| Policy plumbing and MCP tools | `adeflow/sandbox_test.go` with `sandboxtest.Fake` (enforcing) and fakeagent: `TestSandboxStepDefault` (row stored, `.args` carries `--disallowedTools Bash(git branch:*)` and `--add-dir`, env has `TMPDIR` scratch, no `SSH_AUTH_SOCK`, prompt has the note), `TestSandboxReadStep` (`Edit` disallowed, `GIT_OPTIONAL_LOCKS=0`), `TestSandboxOff` (no flags, row `off`), `TestSandboxDenial` (fake injects a denial mid-run → log line, badge count, outcome reason prefix), `TestSandboxAuth` (fakeagent prints `Invalid API key · Please run /login`, exits 1 → auth reason), `TestSandboxTools` (fakeagent `mcp` calls `push_branch` to a bare remote → remote ref moves; `fetch_remote` bad remote → tool error; read step `push_branch` → refused), `TestSandboxReviewRound` (round uses the review step's policy), `TestSandboxNotEnforced` (`System()` on Linux: row `enforced 0`, reason key, no wrap), `TestSandboxPrepareFails` (fake `Prepare` error → run failed, `could not start: …`). Contract `tests/contract/ade-sandbox.json` keys `#policy`, `#denied`, `#notEnforced`, `#off` | `ade-v2-sandbox.spec.ts`: from `#policy` the badge and popover lists; `#denied` amber count, denial row, outcome chip, View profile dialog; `#notEnforced` grey badge; editor: access toggle, paths, preset, network switch, Off warning, notice; Save payload carries `sandbox`; invalid path error |
| Scriptruns smart run | `apps/kira-space/internal/flows/adeflow/automation_test.go` add `TestSmartRunSandboxed` (worktree mode → flags and env) | — |
| Settings leaf | covered by the settings round-trip already in place; UI spec toggles the switch | `ade-v2-sandbox.spec.ts` settings case |

No unit tests beyond golden profiles, policy resolution and the parser cases (`CLAUDE.md` bar).
Visual: one new baseline `tests/visual/ade-sandbox.spec.ts` (run popover with denials), recorded in the
sandbox per `docs/DEV_ENVIRONMENT.md`.

Real `claude` row (opt-in), `apps/kira-space/tests/claude/sandbox_test.go`:
- `TestAdeSandbox`: haiku step told to write `a.txt` in the worktree, run `git branch x` and
  `git checkout -b y`, then call `finish_step`. Linux: run done, row `enforced 0`, prompt note present,
  `Bash(git branch:*)` refused by the CLI (second layer). macOS (keychain setting on, or an env token):
  `a.txt` exists, no branch `x`/`y`, at least one denial recorded, run done or failed with a reason
  naming the ref path.
- `TestAdeSandboxReadOnly`: read step asked to edit a file → no change; reports failure.
- Spend: report per run to the orchestrator.

## 11. Docs

- Site (terse, P284 rule): `space/agents.mdx` new `### Sandbox` under Workflows (schema, defaults,
  what is denied, network off, keychain, Linux notice, denials in the run line); `## Runs` names the
  badge. `reference/mcp-tools.md` Agent tools: `fetch_remote`, `push_branch`.
  `reference/settings.md` Claude Code: keychain switch. `bun run lint` and `site:check` green.
- `docs/ARCHITECTURE.md`: new `### Agent sandbox (P287)` under Workflows (package, profile layout,
  git rules, scope, enforcer seam, watcher, proxy, storage, tools); App prompts list. Known open items
  add: (1) allow-default profile leaves launchd/XPC services that act for the agent (e.g.
  `launchctl submit`) unclosed beyond the listed denies; (2) `~/.claude.json` is writable to the agent and
  holds user MCP servers; (3) in-tree hooks and build scripts an agent edits run unsandboxed later
  (Kira's own git ops, the user); (4) sandbox unverified on a real Mac until the checklist row passes
  (delete once it does).
- `docs/DEV_ENVIRONMENT.md`: new `## Mac checklist (user-run)` with row: `go test ./internal/agentsandbox
  -run TestEnforce -count=1 -v` and `bun run test:claude:space -run 'TestAdeSandbox' -count=1`, expected
  result. Real `claude` table: row for `internal/agentsandbox/**`, `apps/kira-space/internal/ade/sandbox.go`
  → `TestAdeSandbox|TestAdeSandboxReadOnly`; ADE row adds them.

## 12. Execution (one sequential Sonnet implementer)

No streams: package, launch, engine, IPC and UI depend on each other in order. Each commit passes the
normal hook (typecheck, lint incl. `checkprompts`, build). Resume after interruption: `git log
--oneline dfd15fb3d..`; continue at the first missing commit.

1. `feat(agentsandbox): policy, git layout and SBPL profile` (§3.1-§3.5 generator, golden tests).
2. `feat(agentsandbox): darwin enforcer, deny watcher and allowlist proxy` (§3.5 proxy, §3.6 enforcer,
   §6.1, `enforce_darwin_test.go`, `sandboxtest.Fake`; `go get github.com/elazarl/goproxy`).
3. `feat(claudeheadless): sandbox launch wrap and git tools` (§3.6 Spec/Script/OnStart, §5 tools).
4. `feat(llmprompts): sandbox note and git tool prompts` (§8, budget lines, catalog keys, golden).
5. `feat(adeflow): step sandbox schema` (§2, wire Go and TS, parser cases).
6. `feat(ade): sandboxed agent runs` (§4, §6.2-§6.4, §7.1-§7.2, `scriptruns`, appwire).
7. `feat(space): sandbox settings and IPC` (§7.3, §7.4, mock runtime).
8. `test(ade): sandbox flow tests and contract` (§10 Go rows).
9. `feat(space): sandbox section in step inspector` (§9.1).
10. `feat(space): sandbox badge, popover and denial message` (§9.2).
11. `test(space): sandbox UI spec and visual baseline` (§10 UI rows).
12. Full test pass once (Go `-race` on `agentsandbox`, `claudeheadless`, `ade`, `adeflow`, `scriptruns`;
    UI and visual suites); fixes as `fix:` commits.
13. `docs: agent sandbox` (§11).
14. Real `claude` rows on Linux; fixes as `fix:` commits; report spend. The Mac rows wait for the user.

Out of scope: P288 return limits and toolbar removal; sandboxing TUI sessions, script stages, setup
scripts, folder-mode automations; Linux enforcement (bubblewrap/landlock); a per-host network allowlist
field.

## 13. Assumptions where the row is silent (user's message was cut off)

- The cut-off text added nothing beyond the SPEC row; the row is read as complete.
- "Implementation step … nothing outside it" covers reads too, except the runtime set `claude`, git and
  toolchains need (§3.3) and the step's `read`/`allow` lists.
- "Ad hoc … one worktree": a rebase stack counts as its worktrees (§1.20); a smart step outside the
  worktree writes its script folder (§1.21).
- Network "off" means "Claude API only", since `claude` cannot run with no network.
- Keychain is a Space setting, not a step field (§1.8).
- Existing workflows get the default policy on upgrade (§1.7).
- Studio smart scripts are never sandboxed (no ADE worktree).
