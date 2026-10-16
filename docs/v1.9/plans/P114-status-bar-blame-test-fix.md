# P114 — fix plan: P76 status-bar blame test, revision-pinned half

SPEC row: `docs/v1.9/SPEC.md` P114. Investigation tree: `21b363e9`. Re-checked with no change to
any file below at `60701f43`. Paths: `KT` = `apps/kira-space/tests`, `KF` =
`apps/kira-space/frontend/src`.

Opus plans, one sequential Sonnet implementer, no review stage. Small phase: 2 code commits.

Discovery method:
- CodeGraph `codegraph_explore` on the fixture/status-bar seam, the git transport (`gitTransportFor`,
  `createNativeGitTransport`, `createStreamChannel`, `loadFileContent`, `RepoFileView`), and the boot
  sequence (`bootstrap`, `mountShell`, `ensureWorkspaceShell`).
- Read for test-only files CodeGraph doesn't index (`KT/ui/*`, `packages/workbench/src/testing/ui/*`).
- Real reproduction in an isolated scratch `git worktree` (own `bun install`, own
  `frontend/dist`), so the main checkout's `dist` and P110's uncommitted edits were never touched.
- `git bisect run` over the reachable history (clone is shallow, grafted at `d84a7c4a`).
- Scratch-only instrumentation: a `console.error` in `createNativeGitTransport` and its `onClose`,
  plus `pageerror` capture.
- A scratch prototype of §3's fix, run 3x in isolation, run across the full `ui` project, and
  mutation-tested against a broken guard. Section 5 has the results.

## 0. Goal and acceptance

Goal: `KT/ui/repo-workspace.spec.ts:444` ("a repo workspace: the status bar blame item follows the
cursor, and never shows on a revision-pinned tab (P76)") passes reliably. Its revision-pinned half
must also genuinely exercise the guard it claims to prove. Today it can't.

Acceptance, all run for real by the orchestrator:
1. `bun run build:test:space`, then run the test in isolation 3 times, clean each time: `node
   node_modules/.bin/playwright test --config=apps/kira-space/playwright.config.ts --project=ui
   tests/ui/repo-workspace.spec.ts -g "status bar blame item follows"`.
   `--repeat-each=3` in one invocation also counts.
2. The full `playwright test --config=apps/kira-space/playwright.config.ts --project=ui` is green,
   with 0 flaky. 20 tests at `21b363e9`.
3. Mutation check, scratch only, never committed. At `KF/views/repo/RepoFileView.vue:204`, change
   `const blameable = gitRepoId !== undefined && rev === null;` to drop `&& rev === null`, rebuild,
   and rerun. The test must **fail** at the revision-pinned half's `blame.line` assertion. Revert
   afterwards. This check proves the half is no longer vacuous.
4. `bun run lint` and `bun run typecheck` pass. The pre-commit hook runs both. No `--no-verify`.

## 1. Symptom as reported vs as reproduced

The SPEC row reports a 60 s timeout in `packages/workbench/src/testing/ui/fixtures.ts:82`'s
`page.waitForSelector('[data-testid="status-bar"]')`, meaning the app "never finishes launching".
**Not reproduced.** Every run here launches both pages fine, and the status bar renders both times.
The runs: HEAD `21b363e9` 1 + 6 + 1, the registration commit `6f6853c1` 2, and full-project
runs.

Actual, deterministic failure (8/8 isolated runs, 1/1 full-project run, 2/2 at `6f6853c1`):

```
Error: expect(locator).toBeVisible() failed
Locator: locator('[data-testid="repo-file-editor"]')
> 531 |     await expect(editor).toBeVisible();
```

It fails after ~7 s (5 s expect timeout), not 60 s. The page snapshot at failure shows
`alert: the transport was disposed` where the editor should be. Only this one test fails. The other
19 in the `ui` project pass.

The reported status-bar wording is most likely a misread of the run output, or a stale `dist`/
bindings state in that run. It can't be confirmed from here. The real failure is the one above.

## 2. Root cause

**Verdict: test-harness bug, not an app bug.** A correct app fix exposed it, and the test had been
passing vacuously before that fix.

### 2.1 Mechanism

1. The second half relaunches with a restored `IPC.tabsList`. That list holds an **active**
   `repo-file` tab with `state.rev` set, in workspace `repo-1` (`repo-workspace.spec.ts:487-519`).
2. `relaunch()` (`packages/workbench/src/testing/ui/fixtures.ts:70-86`) runs `installMocks`, then
   `page.goto`, then `waitForSelector(status-bar)`. Space's `installMocks` (`KT/ui/fixtures.ts:33-35`)
   installs only the `control.*` mocks. **No git stream mock is present at boot.**
3. Boot: `KF/main.ts:41-76` hydrates, calls `ensureWorkspaceShell` per restored repo, and falls
   forward via `workspaceStore.activateWorkspace(openRepos[0])` (`:69-71`). All of that happens
   **before** `app.mount` (`:76`). The first render therefore mounts `RepoFileView` for the active
   revision-pinned tab in the same pass that renders the status bar.
4. `RepoFileView.vue:255`'s `onMounted(mount)` calls `loadFileContent(repoId, path, rev)` (`:145`)
   synchronously. With `rev !== null`, `fileContent.ts:34-38` calls `gitTransportFor(repoId)`.
   That runs `createNativeGitTransport` (`KF/repo/git/transport.ts:128-129`), which calls
   `Stream('git')`.
5. `window._wails.streamFactory` is undefined at that point. Instrumented log:
   `P114DBG createNativeGitTransport repo-1 undefined`. So `@wailsio/runtime`'s `stream.js`
   falls through to its real HTTP poll transport. The UI test server answers every `/wails/*` path
   with 501 (`packages/workbench/src/testing/ui/server.ts:73-79`). Two
   `Failed to load resource: ... 501` console lines follow, then the socket closes.
6. Since `cac7093b` (F3), `createNativeGitTransport`'s `channel.onClose` (`transport.ts:222-226`)
   calls `remote.dispose()`. That rejects the in-flight `file.read` with `TransportError(
   'transport-closed', 'the transport was disposed')` (`packages/git-ipc/src/rpc.ts:361`).
   `loadFileContent` returns `{kind:'error'}`, and `RepoFileView` sets `state = 'error'`. The
   template (`RepoFileView.vue` `<template v-if="state === 'loading' || state === 'found'">`)
   then drops the `repo-file-editor` container for the error `Alert`.
7. `repo-workspace.spec.ts:520` installs the git stream mock via `page.evaluate` **after**
   `relaunch()` has resolved. That is too late. The shared client for `repo-1` was already
   created, and killed, on the unmocked stream.

The spec's own premise at `:456-457` says the stream mock "lands before Stream('git') is ever
called as long as it precedes the click that opens the workspace". That holds for the first half
and for every other `installGitStreamMock` caller. It is false for the second half, which has no
click: the workspace opens during boot.

### 2.2 Why it "passed" before: bisect

`git bisect run` from `d84a7c4a` (good, 3/3) to `21b363e9` (bad) found the first bad commit:
**`cac7093b` "fix(git-ipc,kira-space-web): react to the git transport's own stream closing (F3)"**.

The same instrumentation at its parent `f951cedb` shows the identical unmocked boot transport and
the identical two 501s. The test still passes there. The reason: before F3, nothing subscribed to
the channel's close, so `file.read` **hung forever** instead of rejecting. `RepoFileView` stayed in
`state = 'loading'`, and `'loading'` renders the same `repo-file-editor` container, empty but
visible. So both assertions held vacuously:
- `toBeVisible()` passed on a forever-loading empty host.
- `blame-status` had count 0 because `mount()` never reached `RepoFileView.vue:201-207`, the
  `blameable` guard the half exists to prove.

F3 is correct app behavior: a dead transport must reject, not hang. It is not reverted.

### 2.3 A second, independent vacuity in the same half

Even with a live mock, the original half never moves the cursor. The blame controller resolves on
cursor position (`KF/views/repo/blameLine.ts:17` `DEBOUNCE_MS = 150`, `refresh()` at `:196-213`).
The first half's own comment (`:469`) says the status item stays empty "until the cursor actually
moves". The half's stated trap is "if `blameable` ever again omitted `rev === null`… the item would
wrongly appear" (`:440-443`). That trap is only armed by a cursor move plus a wait past the
debounce. §5's mutation run confirms it: with the guard broken and a live mock, the mock sees
`["file.read","repo.open","blame.line","blame.line"]`.

## 3. Fix design

Install the git stream mock **before navigation** for a launch whose boot opens the git transport.
Then make the half's assertions non-vacuous. Precedent: Studio's `installMockStream`
(`apps/kira-studio/tests/ui/support/mockStream.ts:183-206`) is installed with `page.addInitScript`
for exactly this reason. Its doc comment: "must be installed via `page.addInitScript` — before any
page script runs … never `page.evaluate`, which would race the app's own module graph".

### 3.1 `KT/ui/support/gitStreamMock.ts` (P114-1)

- Hoist the `page.evaluate` callback body into one module-level function, `installInBrowser(args:
  GitStreamMockArgs): void`. Export `interface GitStreamMockArgs { repoId: string; extraResults?:
  Record<string, unknown>; graphStreamChunks?: readonly GraphStreamChunkFixture[] }`. Only the
  wrapper changes; the body stays byte-identical.
- `installGitStreamMock(page, gitRepoId, extraResults?, graphStreamChunks?)` keeps its signature
  and becomes `page.evaluate(installInBrowser, {...})`. All 12 existing call sites keep compiling
  unchanged. P114-2 removes one of them.
- New `installGitStreamMockOnInit(page, args: GitStreamMockArgs)` calls
  `page.addInitScript(installInBrowser, args)`. Its doc comment must state two things:
  - (a) Use it when boot itself opens the git transport, i.e. a restored active repo workspace.
  - (b) `addInitScript` JSON-serializes `args`, so an `undefined` value **drops its key**, and that
    method then hangs in the mock. Use `null` for a result the caller ignores.

    `page.evaluate` preserves `undefined`, which is why existing callers get away with
    `'repo.open': undefined`. Found in prototyping: `'repo.open': undefined` via `addInitScript`
    silently hung `repo.open`, and the mutation check passed wrongly until it became `null`.
    `ensureRepoOpen` (`KF/state/repoOpenHold.ts:18-32`) discards the result, and `rpc.ts` doesn't
    validate result shapes, so `null` is safe.
- Request log: `installInBrowser` sets `window.__kiraGitRequests = []` and pushes each `req`
  frame's `method` in `send()`, just before the `resultByMethod` lookup. That logs unanswered
  methods too. New `gitStreamRequests(page): Promise<string[]>` reads it back, the same shape as
  `mockStream.ts`'s `ops()`.
- `__name`/keepNames: P57's finding (`mockStreamBrowser.js` header) warns that a typed function
  passed to `addInitScript` can break. It does **not** here. The prototype passed
  `addInitScript(installInBrowser, args)` 3/3 plus a full-project run. Keep the typed function.
  Fall back to P57's raw-text route only if that ever regresses.
- Update the header comment (`:1-30`) with one short line on the two install paths and when each
  applies. Cut nothing else.

### 3.2 `KT/ui/fixtures.ts` (P114-1)

- `RelaunchOptions` gains `gitStream?: GitStreamMockArgs`.
- `installMocks` installs the control mocks first, then `installGitStreamMockOnInit(page,
  options.gitStream)` when that option is set, and returns `{ control }`. The order doesn't matter
  functionally, since `mockRuntime.ts` never touches `window._wails`. `stream.js`'s
  `streamGlobals()` keeps an existing `window._wails` (`window._wails = window._wails || {}`).
  Control-first matches the existing order anyway.
- Doc comment `:22-30` currently says the git stream is "mocked per-spec by `installGitStreamMock`
  …, not by this fixture's own boot-time `relaunch()`". Amend it: per-spec by default, and via
  `gitStream` when boot itself opens the transport.
- No change to `packages/workbench/src/testing/ui/fixtures.ts`. Its `installMocks` seam already
  runs before `goto` (`:78-81`).

### 3.3 `KT/ui/repo-workspace.spec.ts` (P114-2)

For the revision-pinned half (`:479-533`):
- Pass `gitStream: { repoId: REPO.repoId, extraResults: { 'repo.open': null, 'blame.line':
  BLAME_RESULT, 'file.read': { kind: 'found', content: 'export const a = 1;\nexport const b =
  2;\n' } } }` to `relaunch`. Delete the post-boot `installGitStreamMock` call (`:520-524`). The
  content has two lines so `ArrowDown` moves to a real line.
- Replace `await expect(editor).toBeVisible()` with `await
  expect(editor.locator('.view-lines')).toContainText('export const a = 1;')`. Content only renders
  from `state = 'found'`, after `mount()` has already evaluated `blameable` synchronously
  (`RepoFileView.vue:201-207` runs before `state.value = 'found'` at `:252`). So this assertion
  proves the guard ran.
- Then mirror the first half's arming action: `editor.locator('.view-lines').click()` and
  `page.keyboard.press('ArrowDown')`.
- Then a bounded negative window, `page.waitForTimeout(500)`. Comment it as: >3x `blameLine.ts`'s
  150 ms `DEBOUNCE_MS` plus the mock's `setTimeout(0)` round trips. Absence has no event to wait
  on, and `toHaveCount(0)` alone passes at t=0, before a regressed controller would even have
  fired. `waitForTimeout` has 65 existing uses under `apps/*/tests`. A fixed window for a negative
  assertion is the accepted shape here.
- Then assert:
  - `expect(await gitStreamRequests(page)).toContain('file.read')`: the mock was live.
  - `expect(await gitStreamRequests(page)).not.toContain('blame.line')`: the guard held.
  - Keep the existing `blame-status` `toHaveCount(0)`.
- Rewrite the half's comments (`:480-485`, `:526-529`) to say the mock goes in pre-navigation
  because boot opens the transport, pointing at `main.ts`'s fall-forward.
- Optional, same commit: hoist `{ 'repo.open': null, 'blame.line': BLAME_RESULT }` into one
  constant that both halves spread. `null` works for the first half's `page.evaluate` path too. Do
  this only if it reads cleaner; it is not required.

No change to the first half, and no change to any other `installGitStreamMock` caller. Every other
caller installs the mock before the click that first opens the transport, so the lazy-transport
premise holds for them. No other spec seeds `IPC.tabsList` together with the git stream mock
(grep: `IPC.tabsList` appears once in `KT/ui/*.spec.ts`, at `:492`). The `:385` inline-blame test
seeds restored tabs but deliberately has no git mock and a worktree (`rev: null`) tab.

### 3.4 Out of scope (stays out entirely)

- App code: `transport.ts`'s F3 close handling, `RepoFileView.vue`, `main.ts`. All correct.
- Migrating every `installGitStreamMock` caller to the init-time path. They are correct as written,
  and churn there buys nothing for this row.
- `packages/workbench/src/testing/ui/fixtures.ts`'s `waitForSelector` has no explicit timeout, so
  it inherits the 60 s test timeout. It isn't implicated, since the status bar renders in every run.
  Leave it.

## 4. Structure

One sequential Sonnet implementer. No parallel split: P114-2 depends on P114-1's exports.

## 5. Prototype evidence (scratch worktree at `21b363e9`, discarded)

§3.1-3.3 were prototyped in a throwaway worktree. The diff is equivalent to the design above.
- Isolated: 3/3 pass (`--repeat-each=3`), then 3 more separate invocations, all pass.
- Full `ui` project: 20 passed, 0 failed, 0 flaky.
- Mutation (`blameable` without `rev === null`): 3/3 **fail** at `not.toContain('blame.line')`.
  The log was `["file.read","repo.open","blame.line","blame.line"]`.
- `biome check` on the 3 files: clean after `biome format --write` re-indented the hoisted body.
  `bun run typecheck:space-tests`: clean.

## 6. File ownership

P114 touches exactly these 3 files, plus this plan and the SPEC row's result section:
- `apps/kira-space/tests/ui/support/gitStreamMock.ts`
- `apps/kira-space/tests/ui/fixtures.ts`
- `apps/kira-space/tests/ui/repo-workspace.spec.ts`

Nothing under `packages/theme`, `packages/git-ui`, `packages/kira-ui`, `packages/workbench`, or any
`apps/*/frontend`.

**Overlap warning:** P110 iter2's own allowed paths (`P110-css-tailwind-migration-iter2.md` §5)
include `KT/**` ("spec selector moves"). None of the 3 files above has changed since `21b363e9`
(checked at `60701f43`). Before the P114 implementer starts, the orchestrator runs:
- `git log --oneline 21b363e9..HEAD -- apps/kira-space/tests/ui/`
- `git status --short apps/kira-space/tests/ui/`

If P110 touched any of the 3, re-verify §3.3's line numbers first. Safest: start P114
implementation only after P110 iter2's implementer has finished and committed. That is also the
default per `CLAUDE.md`'s one-phase-at-a-time rule; only this planning pass ran in parallel.

## 7. Commit order

- **P114-1** `test(kira-space): pre-navigation git stream mock install and request log (P114-1)`.
  Covers §3.1 and §3.2. Done when: the 12 existing `installGitStreamMock` callers compile unchanged,
  `bun run lint` and `bun run typecheck` pass, and the full `ui` project is unchanged (19 pass, the
  P76 test still failing, as expected until P114-2).
- **P114-2** `fix(kira-space): install P76 revision-pinned half's git mock before boot (P114-2)`.
  Covers §3.3. The body names the root cause in one or two lines: boot opens the transport before a
  post-boot mock, and it was vacuous before `cac7093b`. Done when: acceptance 1-4 in §0 hold,
  including the scratch mutation check.

Then the orchestrator adds the SPEC row's result section. Correct its symptom wording there:
`:531` `repo-file-editor`, not the status-bar wait.

## 8. Risks

- **`addInitScript` serialization.** Values must be JSON-safe; see §3.1(b). `BLAME_RESULT` and the
  `file.read` payload are plain JSON. `graphStreamChunks` holds base64 strings, so it is also safe
  if a future caller passes it.
- **Init script on every navigation.** `addInitScript` re-runs on reload. `relaunch()` opens a
  fresh page per call, and nothing in this test reloads, so there is no effect.
- **Monaco click target.** `.view-lines` click plus `ArrowDown` is the first half's proven sequence.
  With 2 content lines, `ArrowDown` from line 1 reaches line 2.
- **Negative window length.** 500 ms against a 150 ms debounce. If `DEBOUNCE_MS` ever grows past
  ~400 ms, this window must grow with it. Say so in the comment.
