# P11 — Pre-connect scripts

> Plan for SPEC.md §10 phase **P11**. Deliverable: *Per-connection optional shell command (e.g.
> port-forward) run before connect; connection marked disconnected if the process exits while in
> use; config UI in the connection dialog.* "Cuts across every adapter, so it lands once the
> adapter surface is complete" — read as the scope signal that this phase must touch **zero**
> adapter files and zero engine files: it is a main-process connection-lifecycle feature that every
> adapter inherits for free, not a per-engine capability.

## 0. Ground rules for this phase

- Build exactly what §1's deferred-features paragraph and §10's P11 row describe, and nothing more:
  one optional shell command per connection, run before the adapter connect, whose death while the
  connection is live takes the connection down. Out for this phase, none of it named anywhere in
  scope: a script output/log viewer panel, multi-step script pipelines, a built-in port-forward
  helper UI (raw shell command only), `${host}`/`${port}` placeholder interpolation, a post-
  disconnect teardown script, automatic restart of a died script, per-connection timeout/settle
  configuration, a readiness probe against the target port, and any Windows `cmd.exe` branch
  (§1: macOS only).
- §1's literal text: "an optional per-connection shell command (e.g. a port-forward) run before
  connecting; if the process exits while the connection is in use, the connection is marked
  disconnected."
- **The command is a trusted-by-construction capability, and the plan keeps it that way.** It is
  spawned only by the **main** process, only from a value the user typed into the connection dialog
  themselves, and it is stripped from the config before it ever crosses into the engine (D13). It is
  never derived from a URI, a query string, an adapter reply, a metadata cache row, or any other
  input the user did not author in that one field — which is the whole reason it is a first-class
  column rather than an `options` bag entry (D1).
- Nothing about a connection **without** a command changes. `preconnect === null` must not add a
  process, a timer, a state transition, or a millisecond to `connect()` — the entire feature is
  behind one null check.
- No new IPC channel, no preload change, no engine change. `connectionInputSchema` is already the
  wire shape for `connectionsCreate`/`connectionsUpdate`/`connectionsTest` (reality #4), so widening
  that one schema carries the field end to end.
- No unit tests beyond the two existing suites' pattern. `tests/db/preconnect.spec.ts` is a new
  numbered-scenario file (mirrors `redis.spec.ts`'s structure) that spawns **real** short-lived
  processes instead of a container (D16); `tests/ui/preconnect.spec.ts` is a new two-test spec, one
  of which is container-free and must never skip (`connections.spec.ts`'s discipline) and one of
  which is Docker-gated against the existing Postgres fixture. Run `bun run lint`,
  `bun run typecheck` (all three project splits), `bunx electron-vite build`, `bun run test:db`, and
  `xvfb-run -a bun run test:ui` before committing.

### Realities this phase works with (verified against the tree)

1. **`connections.ts` (main) is the sole owner of the connect/disconnect lifecycle** — `grep` for
   `ENGINE_OP.connect`/`ENGINE_OP.disconnect` outside the engine returns only
   `src/main/connections.ts` lines 190, 233, 267. `emitState()` is the single funnel into the
   renderer's status dot, so a script-death transition needs no new push channel.
2. **`markAllErrored(reason)` is the exact precedent for "was live, now isn't, here's why"** — it
   flips live connections to `status: 'error'` with a human message on engine death, and
   `TreeRow.vue` renders `statusDetail` (= `state.error` when status is `'error'`) as the status
   dot's `title`. `menus.ts`'s `isLive = connected || connecting` means an `'error'` connection
   already offers **Connect**, i.e. it is behaviourally "disconnected" (D7).
3. **The `options` bag is URI-round-tripped and clipboard-exposed** — `setMode('fields')` assigns
   `d.options = parsed.params` wholesale from the typed URI's query string, `formatConnectionUri()`
   serialises every string-valued `options` entry back into the URI, and `menus.ts`'s **Copy URI**
   item synthesises that URI for fields-mode connections. A shell command stored there could be
   smuggled in by pasting a crafted URI and would leak into the clipboard — a first-class column
   cannot (D1).
4. **`connectionInputSchema` is the only wire schema on the write path** — `main/ipc/connections.ts`
   parses payloads with it directly; `KiraApi.connectionsCreate/Update/Test` are typed off
   `ConnectionInput`; `preload/index.ts` forwards payloads opaquely. Adding a field there needs zero
   changes in `shared/protocol/ipc.ts`, `preload/`, or `main/ipc/`.
5. **`ConnectionSummary = connectionFieldsSchema.omit({password}).extend({id,...})`**, and
   `ResolvedConnectionConfig = ConnectionSummary & { password }` — so a new field on
   `connectionFieldsSchema` reaches the engine wire schema *by default*, which is precisely what D13
   opts out of.
6. **`setConnectionColor`/`setConnectionReadOnly`/`duplicate()` all rebuild an input by spreading
   the summary**, so a new summary field survives a color change, a read-only toggle and a duplicate
   with no per-call-site edit.
7. **Migrations are forward-only numbered `.sql` files with a hand-maintained `migrations/index.ts`
   array** — `0002_p2.sql` is a plain `ALTER TABLE … ADD COLUMN` plus a `CREATE TABLE`; `migrate.ts`
   runs each unapplied file in a transaction and bumps `schema_version`. P11 is the third file.
8. **`repos/connections.ts` is fully explicit** — `SELECT_COLUMNS`, a zod `connectionRowSchema` with
   a `.transform()` into `ConnectionSummary`, and hand-written `insert`/`update` value objects. A new
   column touches all four, and `parseRow()`'s log-and-skip behaviour means a stale row (pre-
   migration copy) degrades rather than crashes.
9. **`AdapterDeps` (`{ log(level, message) }`) is the codebase's dependency-injected-logger
   precedent** — the new supervisor copies it verbatim so the module never imports `./log` (and
   therefore never imports `electron-log/main` → `electron`), which is what makes it importable from
   the Bun-run `tests/db` suite (D3/D16).
10. **`main/index.ts`'s `before-quit` handler already does ordered shutdown** — flush every window,
    `engineHost.stop()`, `close()`, `app.quit()`. Killing scripts is one awaited call inserted ahead
    of `engineHost.stop()`; no new lifecycle hook.
11. **`ConnectionsService.connect()` has no re-entrancy guard today** — two Connect clicks issue two
    `ENGINE_OP.connect` calls. Harmless while connect is idempotent in the engine; not harmless once
    each attempt owns a child process, hence D11.
12. **`resolveFromInput()` already fabricates `id: 'test'`** for the dialog's Test button, which
    gives the supervisor a natural reserved key for the un-saved-draft case (D12).
13. **13 `tests/ui/*.spec.ts` files build a `ConnectionInput` literal inside
    `page.evaluate(() => window.kira.connectionsCreate({...}))`**, and `tests/ui/**/*.ts` *is*
    typechecked (`tsconfig.node.json`'s `include`) with `window.kira: KiraApi` declared in
    `tests/ui/global.d.ts` — so a required new field is a compile error in all 13 (D18).
14. **`tests/ui/connections.spec.ts` is the container-free UI precedent** ("No container needed …
    Must never skip (§12b)") and `tests/ui/support/pg.ts` is the re-export wrapper for the Docker-
    gated case — this phase's UI spec uses one of each.
15. **`tests/db` is Bun-run (`bun test tests/db`) and imports `src/` directly**, with `@shared/*`
    mapped in `tests/db/tsconfig.json`. Nothing there imports `electron`; `support/docker.ts`
    already imports `node:child_process`, so a process-spawning spec is not a new kind of thing for
    that suite.

## 1. Shapes introduced in this plan

```ts
// src/shared/domain/connection.ts — one new field on connectionFieldsSchema, so it lands on
// ConnectionInput and ConnectionSummary alike. Not touched by the mode-driven superRefine: a
// pre-connect command is orthogonal to fields-vs-URI and is valid (and optional) in both.
// `.trim().min(1)` makes '' invalid rather than a second spelling of "no script" — the dialog
// normalises an emptied input to null (D2). 2000 chars is a sanity cap, not a security control.
const connectionFieldsSchema = z.object({
  // ...existing fields...
  preconnect: z.string().trim().min(1).max(2000).nullable().default(null),
});
```

```sql
-- src/main/storage/migrations/0003_p11.sql
-- NULL = no pre-connect script. Deliberately its own column rather than an options_json key:
-- options_json round-trips through the connection URI (and the Copy URI menu item), and a shell
-- command must never be settable by pasting a URI.
ALTER TABLE connections ADD COLUMN preconnect TEXT;
```

```ts
// src/main/preconnect.ts — NEW. Owns every child process the app ever spawns on the user's behalf.
// Imports node:child_process, node:process and nothing from electron (deps.log is injected,
// mirroring AdapterDeps) so tests/db can drive it under Bun.

export interface PreconnectDeps {
  log(level: 'info' | 'warn' | 'error', message: string): void;
}

/** Resolved once the script is judged ready (D5). */
export type PreconnectStart =
  | { kind: 'oneshot' }   // exited 0 within the settle window — nothing left to monitor
  | { kind: 'sidecar' };  // still alive at the settle window — monitored from arm() onwards

export interface PreconnectExit {
  connectionId: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  lastStderr: string | null;
}

export interface PreconnectSupervisor {
  /**
   * Kills any process already tracked for `connectionId` (D11), spawns `command`, and resolves
   * once it is ready. Rejects if it exits non-zero / on a signal / fails to spawn before the
   * settle window elapses — the message names the exit code and the last stderr line (D6).
   */
  start(connectionId: string, command: string): Promise<PreconnectStart>;
  /** Called only after the adapter connect succeeded: from here on, any exit fires onExit (D7). */
  arm(connectionId: string): void;
  /** Idempotent. Self-inflicted kills never fire onExit (D8). */
  stop(connectionId: string): Promise<void>;
  stopAll(): Promise<void>;
  onExit(cb: (exit: PreconnectExit) => void): () => void;
}

export function createPreconnectSupervisor(deps: PreconnectDeps): PreconnectSupervisor;

export const PRECONNECT_SETTLE_MS = 2000;  // alive this long ⇒ treated as a running sidecar (D5)
export const PRECONNECT_KILL_GRACE_MS = 2000; // SIGTERM → SIGKILL escalation window (D9)
```

```ts
// src/main/connections.ts — service surface gains exactly one method; everything else is internal
// wiring of the supervisor into the existing connect/disconnect/remove/markAllErrored paths.
export interface ConnectionsService {
  // ...existing...
  /** Kills every live pre-connect process. Called from main/index.ts's before-quit (D10). */
  shutdown(): Promise<void>;
}
```

```ts
// src/shared/protocol/engine-ops.ts — the one place the new field is deliberately removed again.
// The engine has no use for a shell string and must never be handed one (D13).
export type ResolvedConnectionConfig = Omit<ConnectionSummary, 'preconnect'> & {
  password: string | null;
};

export const resolvedConnectionConfigSchema: z.ZodType<ResolvedConnectionConfig> =
  connectionSummarySchema.omit({ preconnect: true }).extend({ password: z.string().nullable() });
```

```ts
// src/renderer/project/ConnectionDialog.vue — '' ⇄ null bridging for the one new input, so an
// emptied field is "no script" rather than a schema violation the user cannot see.
const preconnectText = computed({
  get: () => draft.value?.preconnect ?? '',
  set: (value: string) => {
    if (draft.value) draft.value.preconnect = value.trim() === '' ? null : value;
  },
});
```

## 2. Decisions made in this plan

| # | Decision | Rationale |
|---|---|---|
| D1 | The command is a **first-class nullable `preconnect TEXT` column** (migration `0003_p11.sql`, field `preconnect` on `connectionFieldsSchema`), **not** an `options_json` key. | Reality #3: `options` is populated wholesale from a typed URI's query string on a URI→fields flip and re-serialised into the URI by `formatConnectionUri()`, which the **Copy URI** menu item calls. Putting an executable string there would mean pasting `postgres://h/db?preconnect=…` silently arms a shell command, and would leak that command into the clipboard and into the stored `uri` column. A column is reachable only from the dialog field the user typed into — which is the entire security story of this feature. |
| D2 | Schema shape is `z.string().trim().min(1).max(2000).nullable().default(null)`, on `connectionFieldsSchema` (so it appears on both `ConnectionInput` and `ConnectionSummary`), and it is **not** referenced by the `mode`-driven `superRefine`. | A pre-connect command is orthogonal to fields-vs-URI mode — a port-forward is equally necessary for a URI-mode connection — so gating it on mode would be wrong. `min(1)` refuses `''` so there is exactly one spelling of "no script" (`null`); `.default(null)` keeps the field optional on the *input* side, which matters at the IPC boundary where a client may legitimately omit it. 2000 chars is a sanity bound on a stored string, claimed as nothing more. |
| D3 | The script is spawned by the **main** process, from a new dedicated module `src/main/preconnect.ts` (not inline in `connections.ts`), with an injected logger (`PreconnectDeps`, shaped exactly like `AdapterDeps`). | Main is the only trusted process that already owns connection config and the connection lifecycle (reality #1); the engine is an adapter host whose whole point is to be the *untrusted-ish*, memory-capped, replaceable process, and handing it a shell string inverts that boundary. A separate module keeps `connections.ts` an orchestration file, and the injected logger (rather than `import { log } from './log'`, which transitively imports `electron`) is what makes the supervisor importable from the Bun-run `tests/db` suite (D16). |
| D4 | Invocation is `spawn('/bin/sh', ['-c', command], { detached: true, stdio: ['ignore','pipe','pipe'], cwd: homedir(), env: { ...process.env, PATH: `${process.env.PATH ?? ''}:/usr/local/bin:/opt/homebrew/bin` } })` — an explicit `sh -c` rather than `spawn(cmd, { shell: true })`, with **no argv splitting** by the app. | The user types one shell command line (`kubectl port-forward … & `, pipes, `&&`, quoting) and must get shell semantics — argv-splitting it in the app would silently break every quoted argument and every operator, and would be a *false* safety measure since the string is executed either way. Writing `/bin/sh -c` explicitly (instead of `shell: true`) makes those semantics visible at the call site and avoids Node's platform-dependent shell selection. `detached: true` puts the command in its own process group, which is what makes the group-kill in D9 actually work. The PATH suffix exists because a GUI-launched macOS app inherits a minimal `PATH` and would not find Homebrew-installed `kubectl`/`aws`/`ssh`; a login shell (`$SHELL -l -c`) was rejected because `-l` semantics vary per shell and `$SHELL` is unreliable in the CI/test environment. |
| D5 | Readiness is resolved by racing the process against a fixed `PRECONNECT_SETTLE_MS = 2000` window: exit code **0** before the window ⇒ `{kind:'oneshot'}` (a preparation command like `aws sso login`; nothing to monitor afterwards); still alive at the window ⇒ `{kind:'sidecar'}`; any other exit before the window ⇒ reject (D6). Then **exactly one** adapter connect attempt is made — no retry loop, no port probe. | This covers both real shapes of the feature (one-shot preparation, long-running forwarder) from one rule, with no per-connection configuration and no heuristics on the child's output. A connect-retry loop was rejected on purpose: retrying would repeat *failed authentication* against the target server (credential-lockout risk) unless the adapter surface exposed error classification, which it does not — and a forwarder slower than 2 s is one more Connect click away, with the same script re-run from scratch. |
| D6 | A script that exits non-zero, dies on a signal, or fails to spawn before the settle window **aborts the connect**: the adapter is never contacted, and `connect()` returns `status: 'error'` with `Pre-connect script failed (exit 3): <last non-empty stderr line, ≤200 chars>` (or `… (signal SIGSEGV)` / `Pre-connect script could not start: <spawn error>`). | Connecting anyway would produce the adapter's own misleading "connection refused" for what is really a broken script, which is exactly the diagnosis this feature exists to make obvious. Reusing the existing `'error'` state means zero new UI: `TreeRow.vue` already surfaces `state.error` as the status dot's tooltip (reality #2). |
| D7 | "In use" is defined operationally as **armed**: the supervisor is told `arm(connectionId)` only after `ENGINE_OP.connect` has resolved with the process still alive. From that moment **any** exit — including a clean exit 0 — fires `onExit`, and `connections.ts` responds by issuing a best-effort `ENGINE_OP.disconnect` and emitting `status: 'error'` with `Pre-connect script exited (code 0) — connection dropped.` A `'oneshot'` start is never armed. | §1 says "if the process exits **while the connection is in use**" — with no exit-code qualifier, and rightly so: a port-forward that exits 0 has stopped forwarding just as thoroughly as one that crashed, and the socket the adapter holds is now pointed at nothing. Using `'error'` rather than literally `'disconnected'` satisfies the spec's *behavioural* meaning (`menus.ts` offers **Connect** for any non-live state) while keeping the reason visible; a silent flip to `'disconnected'` mid-session would leave the user with no explanation at all, and `markAllErrored()` already set this precedent for exactly this situation (reality #2). If the process dies **after** the settle window but **before** `arm()` (i.e. during the adapter connect), `arm()` sees an already-exited entry and takes the same path immediately, so the connect resolves to that error instead of to `connected`. |
| D8 | Every kill the app itself initiates sets a `killing` flag on the entry first; the `exit` handler ignores exits while that flag is set, so a self-inflicted kill never fires `onExit`. | Otherwise a manual **Disconnect** would kill the script and then immediately re-emit a spurious `'error'` state on top of the `'disconnected'` one it just emitted — a state-machine race with a visible wrong answer in the tree. |
| D9 | `stop()` kills the **process group** — `process.kill(-pid, 'SIGTERM')`, escalating to `process.kill(-pid, 'SIGKILL')` after `PRECONNECT_KILL_GRACE_MS = 2000` if the child has not exited — and resolves only once the `exit` event has fired (or the escalation has been sent). | `sh -c` does not reliably `exec` into the user's command (it does for a lone simple command, it does not for `a; b` or `a && b`), so killing the recorded PID alone can strand the real forwarder holding a local port. `detached: true` (D4) makes the child a group leader, so the negative-PID kill reaches the whole tree, which is the only reliable way to guarantee "disconnect releases the port". |
| D10 | Kill points, exhaustively: `disconnect(id)`, `remove(id)`, `connect(id)`'s failure path (adapter connect threw after the script started), `markAllErrored(reason)` (engine died ⇒ no connection can be using its forwarder any more), and `shutdown()` from `main/index.ts`'s `before-quit`, awaited **before** `engineHost.stop()`. | Every path by which a connection stops being live must release the process, or the app leaks orphaned forwarders holding local ports for the rest of the session (and, for `before-quit`, past the session). Ordering `shutdown()` ahead of `engineHost.stop()` keeps the teardown in dependency order — connections first, then the process they were talking through. |
| D11 | `start()` awaits `stop()` for that same `connectionId` before spawning, so a connection can own at most one process, ever. Independently, `connect(id)` gains a per-connection in-flight guard: a second `connect()` for an id whose connect has not yet settled returns the first call's promise. | The kill-previous rule alone is not enough: two concurrent `connect()` calls would have the second call's `start()` kill the first call's process, whose readiness wait would then fail and mark the connection `'error'` *after* the second call had marked it `connected`. The in-flight guard removes the interleaving at the source, and is small enough (one `Map<string, Promise<ConnectionState>>` with a `finally` cleanup) that it is worth fixing the pre-existing double-Connect duplication (reality #11) in passing rather than working around it. |
| D12 | The dialog's **Test connection** button runs the script too, keyed under the reserved id `'test'` (which `resolveFromInput()` already fabricates), and **always** stops it in a `finally` — a test run is never armed and never leaves a process behind. | Without this, testing any port-forwarded connection always fails while Connect works, which teaches the user that the test button lies. Reusing the `'test'` key means a second Test click kills the first test's process via D11's kill-previous rule, so the dialog cannot accumulate processes no matter how many times it is pressed. |
| D13 | `preconnect` is **stripped** from `ResolvedConnectionConfig` (`Omit<…>` + `connectionSummarySchema.omit({preconnect:true})`), and `resolve()`/`resolveFromInput()` destructure it out before calling the engine. | Least privilege at the one process boundary that matters: the engine hosts third-party driver code and is the process this architecture treats as the expendable one (§4), so it has no business holding a string whose only purpose is to be executed. Removal is enforced by the type and by the wire schema, not by convention. |
| D14 | UI is a single optional text input in `ConnectionDialog.vue`, placed **after** the Read-only checkbox and **outside** the fields/URI `<template>` split (so it shows in both modes), labelled `Pre-connect command (optional)`, `data-testid="connection-preconnect"`, with permanent helper text (*"Runs in your shell before connecting — e.g. a port-forward. The connection drops if it exits."*) and a warning line rendered **only when the field is non-empty**: *"This command runs on your machine with your permissions every time this connection connects."* No confirmation dialog, no separate "enable scripts" setting, no collapsed/advanced section. | Placement outside the mode split is the visual statement of D2 (it applies to both modes). A modal confirmation on every connect would be nagging on a value the user typed themselves one field above the button — the same posture §8.12 already takes with the always-visible plain-text credential warning, which this line deliberately mirrors in style and position. Showing the warning only when a command is set keeps it meaningful instead of decorative. Inline validation reuses the existing `fieldErrors` mechanism (`fieldErrors.preconnect`). |
| D15 | The child's stdout/stderr are piped and written line-by-line to the existing `electron-log` sink under the `preconnect` scope (§3: main-process logging, scoped loggers, single log file); the **last non-empty stderr line** (truncated to 200 chars) is retained per entry purely to enrich the D6/D7 error messages. Nothing goes to the op log, and there is no in-app viewer. | §8.11's operations panel is defined as "every **DB** operation" and is fed exclusively by engine op events — putting a shell process's chatter there would break that contract and pollute `op_log` retention. Retaining one line rather than a buffer keeps memory bounded by construction (§2.2) while still answering the only question the user actually asks when a script fails: *what did it print?* |
| D16 | Two test files: `tests/db/preconnect.spec.ts` (Bun, real spawned processes, **no** container) and `tests/ui/preconnect.spec.ts` (Playwright; one container-free test that must never skip, one Docker-gated test against the existing Postgres fixture). | §9's "two suites only" is honoured — no third runner, no mocks. `tests/db` is the project's only non-Playwright runner and already imports `node:child_process` (reality #15); the supervisor is electron-free by construction (D3) so it belongs there, and its scenarios are genuine integration tests against the real OS process API rather than unit tests against a stub. Splitting the UI spec in two follows the existing precedent exactly: `connections.spec.ts` never skips because it needs no engine, and script-failure-before-connect likewise needs no engine, while the sidecar lifecycle needs a connection that genuinely reaches `connected`. |
| D17 | Orphan handling is explicitly bounded: processes are killed on every path in D10, but nothing is persisted across restarts — no PID file, no reaping of processes left behind by a `SIGKILL`ed main process. | Recovering orphans across restarts would need PID persistence plus PID-reuse validation, machinery far beyond a phase whose entire spec is one sentence; `detached: true` (D4) is required for correct group kills and unavoidably means a hard-killed main leaves the group running. Every *normal* exit path is covered, and the limitation is recorded here rather than papered over. |
| D18 | The 13 existing `tests/ui/*.spec.ts` `connectionsCreate({...})` literals each gain `preconnect: null`. | Reality #13: `.default(null)` keeps the field optional on the *input* side at runtime, but `ConnectionInput` is the *output* type and `tests/ui/**/*.ts` is typechecked, so the key is required at those call sites. Adding it explicitly is preferred over making the field `.optional()` in the schema — an `undefined`-or-`null` double state on a stored column is exactly the kind of ambiguity `connectionFieldsSchema` avoids everywhere else. |

## 3. Target tree at the end of P11

```
src/shared/
  domain/connection.ts     MOD — connectionFieldsSchema gains `preconnect`
                                  (trim/min(1)/max(2000)/nullable/default(null)); superRefine
                                  untouched (D2). Flows to ConnectionInput + ConnectionSummary.
  protocol/engine-ops.ts   MOD — ResolvedConnectionConfig becomes Omit<ConnectionSummary,
                                  'preconnect'> & {password}; resolvedConnectionConfigSchema gains
                                  .omit({preconnect:true}) (D13).
src/main/
  preconnect.ts            NEW — createPreconnectSupervisor: spawn(/bin/sh -c, detached, PATH-
                                  augmented), settle-window readiness race (oneshot/sidecar),
                                  arm(), killing-flag-guarded exit monitor, SIGTERM→SIGKILL group
                                  kill, stop()/stopAll()/onExit(). PreconnectDeps-injected logger,
                                  zero electron imports (D3/D4/D5/D8/D9).
  connections.ts           MOD — constructs the supervisor; connect() runs start() before
                                  ENGINE_OP.connect and arm() after it resolves, kills on failure;
                                  disconnect()/remove()/markAllErrored() stop(); new shutdown();
                                  onExit handler → best-effort ENGINE_OP.disconnect + emitState
                                  error; per-connection in-flight connect guard; test() runs the
                                  script under the 'test' key in a try/finally; resolve()/
                                  resolveFromInput() strip `preconnect` (D6/D7/D10/D11/D12/D13).
  index.ts                 MOD — before-quit awaits connections.shutdown() ahead of
                                  engineHost.stop() (D10).
  storage/migrations/
    0003_p11.sql            NEW — ALTER TABLE connections ADD COLUMN preconnect TEXT.
    index.ts               MOD — { version: 3, name: '0003_p11', sql: m0003 }.
  storage/schema/connections.ts MOD — preconnect: text('preconnect').
  storage/repos/connections.ts  MOD — SELECT_COLUMNS, connectionRowSchema (+ its .transform),
                                       insertConnection values, updateConnection set (D1).
src/renderer/
  state/connections.ts     MOD — defaultDraft() gains `preconnect: null`.
  project/ConnectionDialog.vue MOD — preconnectText computed ('' ⇄ null); one field + helper text
                                       + conditional warning line, placed after the Read-only
                                       checkbox and outside the fields/URI split;
                                       fieldErrors.preconnect rendering (D14).
tests/db/
  preconnect.spec.ts       NEW — numbered scenario suite against the real supervisor (below).
tests/ui/
  preconnect.spec.ts       NEW — two tests: container-free dialog+failure, Docker-gated sidecar
                                  lifecycle (below).
  cell-editor.spec.ts, data-view.spec.ts, ddl.spec.ts, interaction.spec.ts, kafka.spec.ts,
  mariadb.spec.ts, mongo.spec.ts, mutations.spec.ts, perf.spec.ts, redis.spec.ts, sqs.spec.ts,
  tabs.spec.ts, tree.spec.ts
                           MOD — `preconnect: null` added to each file's single
                                  connectionsCreate({...}) literal (D18).
docs/plans/
  P11-preconnect-scripts.md NEW — this document.
```

### Test scenarios

**`tests/db/preconnect.spec.ts`** — `describe('preconnect supervisor (§9.1, P11)')`, mirroring
`redis.spec.ts`'s numbered style. No container. Liveness is asserted with `process.kill(pid, 0)`
(throws `ESRCH` once gone); every scenario uses POSIX-guaranteed commands (`sh`, `sleep`, `echo`,
`exit`) so nothing depends on the dev machine's toolchain.

1. **one-shot success** — `exit 0` resolves `{kind:'oneshot'}` well inside the settle window, and no
   entry remains to monitor (`arm()` afterwards is a no-op; `onExit` never fires).
2. **one-shot failure** — `echo boom >&2; exit 3` rejects with a message containing `exit 3` and
   `boom`.
3. **spawn/lookup failure** — `definitely-not-a-binary` rejects (sh exits 127) with the exit code in
   the message.
4. **sidecar** — `sleep 60` is still alive at the settle window and resolves `{kind:'sidecar'}`;
   `stop()` then leaves no live PID.
5. **armed exit fires once** — `sleep 0.3` armed immediately fires `onExit` exactly once with the
   code, then never again.
6. **self-inflicted kills are silent (D8)** — `stop()` on a live armed sidecar fires no `onExit`.
7. **exit-before-arm (D7)** — a sidecar killed externally between `start()` resolving and `arm()`
   being called makes `arm()` report the exit through the same `onExit` path.
8. **one process per connection (D11)** — a second `start()` for the same id kills the first PID
   before spawning, and the first PID is gone afterwards.
9. **process-group kill (D9)** — `sleep 60 & sleep 60` (so `sh` cannot `exec`) leaves **no** live
   process in the group after `stop()`, asserted via `process.kill(-pid, 0)`.
10. **SIGKILL escalation** — a command trapping SIGTERM (`trap '' TERM; sleep 60`) is still gone
    after `stop()` resolves.
11. **`stopAll()`** — three tracked sidecars, none alive afterwards.
12. **stderr retention is bounded** — a command printing many stderr lines then failing surfaces only
    the last one, truncated (D15).

**`tests/ui/preconnect.spec.ts`** — two Playwright tests over `tests/ui/fixtures.ts`. Scripts write a
marker file and their own group PID into the per-test `kiraHome` tmp dir, which is how the spec both
proves the script ran and gets a handle to kill it from the test process.

- **`preconnect — dialog field, persistence, and failure before connect`** *(no container, must
  never skip)*: the field is visible in **both** fields and URI mode; typing a command, saving, and
  relaunching persists it (`connectionsList()` shows the exact string); reopening **Edit…** shows it;
  clearing it and saving stores `null` (not `''`); the warning line appears only while the field is
  non-empty. Then a connection pointed at `127.0.0.1:1` with `preconnect` = `echo nope >&2; exit 3`
  is connected: the row's `.status-dot` reaches `data-status="error"` with a `title` containing
  `exit 3` and `nope`, and it **never** shows `connected` — proving the adapter was never contacted.
- **`preconnect — sidecar lifecycle against a live connection`** *(Docker-gated on
  `isDockerAvailable()` / `startPostgres()`, `test.skip` with `DOCKER_UNAVAILABLE_MESSAGE`)*: a
  Postgres connection whose `preconnect` is `echo $$ > <pidfile>; touch <marker>; sleep 600`.
  (a) Connect ⇒ marker file exists (script ran) **and** the dot reaches `connected`.
  (b) `process.kill(-pid, 'SIGTERM')` from the test ⇒ the dot flips to `error` with a `title`
  containing `Pre-connect script exited`, and the **Connect** menu item is offered again.
  (c) Reconnect, then **Disconnect** ⇒ the recorded group is gone (`process.kill(-pid, 0)` throws).
  (d) Reconnect, then **Delete** the connection (accepting the confirm) ⇒ the group is gone.
  (e) A second connection whose `preconnect` is a one-shot `touch <marker2>` connects and **stays**
  `connected` for a poll window — no spurious drop from the script's own clean exit (D5/D7).
  (f) `expect(consoleErrors).toEqual([])`.
