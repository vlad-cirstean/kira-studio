# P250 iter2 plan: e2e gaps for P252-P258 and P260

Base: `v2.0` at `dcdbe9233` (P258 result). Branch `p250b-plan`. P259 excluded: planned and landing
later; its own phase carries its tests.

Rule (CLAUDE.md): a new feature test runs once as a backend flow test and once as a UI spec, both
asserting the same result, tied by one contract fixture `apps/<app>/tests/contract/<scenario>.json`.
Method unchanged from `P250-plan.md` §1 and §5: flow half calls `app.Contract(t, scenario, key, got,
Mask/Replace…)` after its Go assertions; `KIRA_CONTRACT=write` regenerates; UI half reads
`contract('<scenario>', '<key>')` from `tests/ui/support/contract.ts`. Keys `Service.Method[#tag]`,
`args:Service.Method[#tag]`, `git:<method>[#tag]`. Git UI specs answer stream calls through
`openPortGraph(relaunch, { results: { '<method>': … } })`. Docker UI specs answer through
`installDockerMocks` handlers. `exempt.txt` (both apps) stays empty; no new bound method, so the
coverage gate needs nothing new.

Discovery: CodeGraph (`codegraph_explore`, index synced at base) for bound docker/link methods, edit
and disk flows, `GitViewHead` data path, `ScriptDialog`/`AutomationsPanel` schedule path; Read/Grep for
test files, fixtures and plan/result docs.

## 1. Audit

Verdicts as P250 §3: covered (pair + shared fixture); unlinked (both halves exist, no shared
fixture); UI only by design (renderer rule, layout, styling: visual or UI spec owns it); gap.

### P252 Docker disk, size, origin: fully covered

| Behaviour | Flow | UI | Fixture | Verdict |
|---|---|---|---|---|
| Engine df on demand, cached, Refresh | dockerflow `TestDiskUsage` (complete) | docker-disk `contract: engine disk usage …` | `docker-disk` `DockerService.DiskUsage` | covered |
| Container size on demand, session cache | `TestContainerSize` | docker-disk `contract: container size …` | `DockerService.ContainerSize` | covered |
| Origin icons, Compose group icon | `TestContainerOrigin` | docker-disk `contract: left-bar origin icons` | `DockerService.Containers#origins` | covered |

### P253 Docker container edit

| Behaviour | Flow | UI | Fixture | Verdict |
|---|---|---|---|---|
| Edit spec split in place / recreate | `TestContainerEditSpec` | docker-edit `contract: edit tab splits …` | `docker-edit` `ContainerEditSpec` | covered |
| In-place apply | `TestUpdateContainerInPlace` | `contract: in-place apply sends …` | `args:`/`UpdateContainer` | covered |
| Recreate with loss confirm | `TestRecreateContainer` (complete) | `contract: recreate confirms losses …` | `args:`/`RecreateContainer` | covered |
| Recreate rollback | `TestRecreateRollback` (complete) | `contract: failures keep the draft …` (recreate half) | `RecreateContainer#rollback` | covered |
| Stale base hash: `E_CONFLICT` "…; reload" | `TestUpdateContainerRejects` | same test, update half: hand-written error | none | unlinked: D1 |
| Managed (kubernetes/swarm) read-only | `TestUpdateContainerRejects` (managed spec, `E_INVALID`) | `managed container is read-only` (hand spec) | none | unlinked: D1 |
| Clearing memory goes to recreate | `TestUpdateContainerRejects` (`E_INVALID` on `resources.memory`) | `clearing a memory limit moves it to recreate` | none | UI only by design: renderer routes the field; backend refusal is a guard the UI never reaches |
| Stopped container: in place works, recreate keeps it stopped | `TestUpdateStoppedContainer`, `TestRecreateStoppedContainer` (complete) | none | none | gap: D2 |
| Auto-remove container: recreate refused | `TestRecreateRefusals` (complete) | none (`docker-edit-autoremove` alert untested) | none | gap: D3 |
| Concurrent recreate: one `E_CONFLICT` | `TestRecreateRefusals` | n/a (one UI cannot race itself) | - | backend only by design |

### P254 Automations editor rework

| Behaviour | Flow | UI | Fixture | Verdict |
|---|---|---|---|---|
| Three tabs, Collection after Name, save with schedule | termflow `TestScriptEditorSave` (both apps) | automations-editor `contract: save a smart script from the three tabs …` (both) | `script-editor` | covered |
| Run dialog resolves param (VarText rule) | same | `contract: the run dialog shows the saved param resolved` | `ScriptRunsService.Preview` | covered |
| Variable autocomplete, secret never offered, `$KIRA_P` | n/a (renderer tokenizer) | automations-editor completion tests + unit tokenizers | - | UI only by design |
| Recurring menu duplicates removed; Edit schedule opens Schedule tab | n/a | `creating offers New script … once; Edit schedule opens …` | - | UI only by design |
| Schedule changed only inside the editor (toggle gone): turn off, Save, row reads `off` | none (no `Update` with schedule in any flow) | none (Edit-schedule test stops at the tab) | none | gap: A1 (Studio), A2 (Space) |
| Tab error badges, Save waits | n/a | `tabs flag their errors …` | - | UI only by design |

### P255 Linear workflow editor

| Behaviour | Flow | UI | Fixture | Verdict |
|---|---|---|---|---|
| Edits save `results` (capability kept) | adeflow `TestBranching` | ade-v2-workflows route-select test | `ade-workflow-results` | covered (P250 S3) |
| Locked layout, one direction, one node size, no zoom, vertical scroll, re-layout on edit | n/a | ade-v2-workflow-layout (6), unit `ade-v2-workflow-graph` (19), visual `ade-workflow-graph` (3 baselines) | - | UI only by design |
| Layout of a backend-produced workflow (results fan-out, loop gutter) | `TestBranching` records `AdeTaskService.Workflows` | layout spec runs on hand `workflows` fixture only | `ade-branching` exists, no layout consumer | unlinked: W1 |

### P256 + P258 Git module design

Mostly visual and structural: Badge tones, single-line rows, lanes, `Empty` states, dialog `Field`s,
menus, toolbars, `kv-` removal, type scale. Owned by visual baselines (`git-module`: `git-graph`,
`git-graph-detail`, `git-stash-dialog`, `git-repo-settings-dialog`, `git-branch-picker`,
`git-row-menu`), UI specs (`repo-*`, `ade-v2-review*`) and lint guards (`check_no_kv_layer`,
`check_git_ui_type_scale`). No backend change in either phase. Not e2e material.

One data-dependent surface: P258 `GitViewHead` (`App.vue viewHeadBindings`). Branch, ahead/behind
come from `refs.list` (`track`); operation badge from `status.get` `inProgress` via
`describeInProgress`. Current UI coverage: `repo-commit-meta` checks only that the head and branch
badge show and are 34 px. Gap: G3.

P256 itself: fully covered (visual + UI; no data-dependent behaviour added).

### P257 Name-status only

| Behaviour | Flow | UI | Fixture | Verdict |
|---|---|---|---|---|
| Rename: new path, old path in tip | gitflow `TestCommitDetailAndDiff` `rename` | repo-commit-detail `contract: a rename commit …` | `git-commit-detail` `#rename` | covered |
| Rename similarity kept in tip (`N% similar — a → b`) | same (similarity 100 in fixture) | tip asserted for old path only | `#rename` | partial: G1 |
| Binary and mode-only change listed from name-status, no counts | `TestCommitDetailAndDiff` `binary mode NFD` (asserts kinds vs git) | none | none | gap: G1 |
| Merge parent files | `TestCommitDetailMergeParentSelector` | `contract: a merge commit lists …` | `#merge-parent-*` | covered |
| ADE Changes tab: path only (wire `FileChange{path}`) | adeflow `TestReviewOpenFacts` records `Branch#committed` with `files` | ade-v2-panel only checks tab visible | `ade-review-open` exists, no Changes consumer | unlinked: G2 |
| Stash list keeps numstat framing | gitflow `TestStashFlows` | repo stash specs | `git-stash` | covered |

### P260 Docker polish

| Behaviour | Flow | UI | Fixture | Verdict |
|---|---|---|---|---|
| Registry URL per image; none for local-only | dockerflow `TestImageRegistryURL` | docker-module `image registry button opens the derived URL …` (hand images) | none | unlinked: R1 |
| Registry button in container detail | same test (`InspectContainer` `RegistryURL`) | `container detail shows the registry button …` (hand detail) | none | unlinked: R1 |
| `LinkService.OpenExternal` validates http(s) | appflow `TestOpenExternal` | the two registry tests read `linkOpenExternal` args (hand URL) | none | unlinked: R1 |
| Edit tabs In place / Recreate, pending summary, per-tab Apply | `TestContainerEditSpec` | docker-edit `contract: edit tab splits …` | `docker-edit` | covered |
| Size in Stats (running, stopped) | `TestContainerSize` | docker-disk size tests | `docker-disk` | covered |
| Compose colour, start green / stop red, no selection bar, ToggleGroup tabs, Automations run icon right | n/a | docker-module `start is green …`, `engine overview … section tabs share one row`, automations-module `script-run-slot` | - | UI only by design |

### Summary

P252, P256 fully covered. P253: 3 items. P254: 2 (one per app). P255: 1. P257: 2. P258: 1.
P260: 1. Total 10 items (D1-D3, R1, A1, A2, W1, G1-G3).

## 2. Items

Docker flag: `docker` = flow half needs a running engine; it skips without one, so writing the
fixture needs `KIRA_FLOW_DOCKER=require` (and `KIRA_FLOW_COMPLETE=1` where marked complete). The UI
half reads the committed JSON and never needs Docker.

### Studio (`apps/kira-studio`)

D1 P253 stale hash and managed spec. Docker: yes (general suite).
- Flow: `internal/flows/dockerflow/edit_test.go` `TestUpdateContainerRejects`. After the stale-hash
  `try`, record the `*ipcerr.Error` as `DockerService.UpdateContainer#stale` (code `E_CONFLICT`,
  message `container changed since the editor loaded; reload`). After `mspec` loads, record
  `DockerService.ContainerEditSpec#managed` with `editOpts(d, box)` masking plus `Replace` of the
  managed container's name/id the same way `editOpts` handles `box`.
- UI: `tests/ui/docker-edit.spec.ts`. `contract: failures keep the draft and explain the state`:
  `UpdateContainer` handler returns `{ error: { code, message } }` from `#stale` instead of the
  literal. Rename `managed container is read-only` to `contract: a managed container is read-only`;
  spec from `#managed` (identity fields swapped to `OLD_ID`/fixture name); asserts unchanged.
- Key: `docker-edit` `DockerService.UpdateContainer#stale`, `DockerService.ContainerEditSpec#managed`.

D2 P253 stopped container. Docker: yes; in-place half general, recreate-state half reads the spec.
- Flow: `TestUpdateStoppedContainer` records `DockerService.ContainerEditSpec#stopped` (state
  `exited`), `args:DockerService.UpdateContainer#stopped`, `DockerService.UpdateContainer#stopped`
  (`applied: [resources, restart]`, `Mask("warnings")`), all through `editOpts`.
- UI: new `contract: a stopped container applies in place and recreate keeps it stopped`. Spec from
  `#stopped`. Set restart `always` and memory to the contract args' values, Apply now; sent args equal
  the contract args under the existing `withoutIdentity`; pending list empties. Recreate tab: change
  env, Apply recreate; `docker-edit-kept` contains `The new container stays stopped.`; Cancel; no
  `RecreateContainer` call.
- Key: `docker-edit` `#stopped` keys above.

D3 P253 auto-remove. Docker: yes, complete (`KIRA_FLOW_COMPLETE=1`).
- Flow: `TestRecreateRefusals` records `DockerService.ContainerEditSpec#auto-remove` (`autoRemove:
  true`) and `DockerService.RecreateContainer#auto-remove` (the `E_INVALID` error, `Mask("message")`).
- UI: new `contract: an auto-remove container is never recreated`. Spec from `#auto-remove`.
  `docker-edit-autoremove` alert visible; Recreate tab: edit image; `docker-edit-apply-recreate`
  disabled; `docker.calls('RecreateContainer')` empty. The error key documents why the UI disables
  it; the UI never sends it.
- Key: `docker-edit` `#auto-remove` keys above.

R1 P260 registry URL and open-external. Docker: flow `dockerflow` half yes (general); appflow half no.
- Flow 1: `dockerflow/registry_test.go` `TestImageRegistryURL` records into `docker-registry`:
  `DockerService.Images#registry` = the two images projected to `{tags, registryURL}` (alpine mirror
  tag gives `https://hub.docker.com/_/alpine`; committed `localhost/…` gives `""`), with
  `Replace(d.Prefix(), "kira-flow-")` and `Replace(runID, "run")` as `origin_test.go` does;
  `DockerService.InspectContainer#registry` = `{image, registryURL}`.
- Flow 2: `appflow/app_test.go` `TestOpenExternal` records `args:LinkService.OpenExternal` for the
  hub URL into `link-open` (own scenario: two packages must not write one file).
- UI: `tests/ui/docker-module.spec.ts`. Rename both registry tests to `contract: …`. Image rows built
  from `#registry` (tags, registryURL; other fields from the existing factory); local row has no
  `docker-image-registry`; click alpine's; logged `linkOpenExternal` args equal
  `contract('link-open', 'args:LinkService.OpenExternal')`. Detail test: `InspectContainer` answers
  with the fixture detail plus contract `registryURL`; logged args equal the same contract args.
- Keys: `docker-registry` `DockerService.Images#registry`, `DockerService.InspectContainer#registry`;
  `link-open` `args:LinkService.OpenExternal`.

A1 P254 schedule off through the editor (Studio). Docker: no.
- Flow: `internal/flows/termflow/editor_test.go` `TestScriptEditorSave` continues: `Update` the
  created script with `Schedule.Enabled = false` (rest unchanged); assert stored schedule kept with
  `enabled` false and `ScriptRuns`' scheduler has no next fire for it (use whatever list/next call
  `schedule_test.go` already uses; no new seam). Record `args:CustomScriptsService.Update#schedule-off`
  and `CustomScriptsService.Update#schedule-off` into `script-editor`.
- UI: `tests/ui/automations-editor.spec.ts`. New `contract: Edit schedule turns the schedule off on
  Save`: list answers the contract `Create` record; row menu Edit schedule…; uncheck
  `schedule-enabled`; Save; logged `customScriptsUpdate` args `toMatchObject` the contract args'
  `fields.schedule` (cron, enabled false, confirm); answer with the contract `Update` record; row's
  `script-next` reads `off`.
- Key: `script-editor` `args:CustomScriptsService.Update#schedule-off`, `CustomScriptsService.Update#schedule-off`.

### Space (`apps/kira-space`)

A2 P254 schedule off through the editor (Space). Same as A1 on `apps/kira-space` (same file names,
same keys in its own `script-editor.json`). Docker: no.

W1 P255 layout of a backend workflow. Docker: no. UI only change; flow half exists.
- Flow: none new. `adeflow` `TestBranching` already records `AdeTaskService.Workflows` into
  `ade-branching` (stage `build`, `impl` then `review`, `review` results `approved` and `changes`
  back to `impl`).
- UI: `tests/ui/ade-v2-workflow-layout.spec.ts` new `contract: a backend workflow with a result loop
  lays out on one spine`: `openPlan` with `{ channel: IPC.adeTaskWorkflows, response:
  contract('ade-branching', 'AdeTaskService.Workflows') }`; Workflows tab; every `ade-wf-node` has
  one size; `impl` above `review`, both centred on one column; the `changes` loop edge path's left
  edge lies left of every node (gutter rule as `loop edges run in a gutter …`); canvas scale is 1.
- Key: `ade-branching` `AdeTaskService.Workflows` (existing).

G1 P257 binary, mode and similarity from name-status. Docker: no.
- Flow: `internal/flows/gitflow/detail_test.go` `TestCommitDetailAndDiff`: also record the `binary
  mode NFD` subtest as `git:commit.detail#binary-mode` (same `Mask("sha", "parents", "timestamp")`;
  NFD name stays: it is the point). Contract call condition becomes `tc.name == "rename" || tc.name ==
  "binary mode NFD"` with tag `binary-mode` for the second.
- UI: `tests/ui/repo-commit-detail.spec.ts`. Rename test also asserts the tip contains
  `${similarity}% similar` from the contract. New `contract: a binary and a mode-only change list by
  name-status with no line counts`: open detail from `#binary-mode`; each contract file's leaf name
  shows with `file-tree-status` letter for its `kind`; no row text matches `/[+−-]\d+/`.
- Key: `git-commit-detail` `git:commit.detail#binary-mode`; `#rename` reused.

G2 P257 ADE Changes tab, paths only. Docker: no. UI only change; flow half exists.
- Flow: none new. `adeflow` `TestReviewOpenFacts` records `AdeTaskService.Branch#committed` (`files:
  [{path: "wip.txt"}]`, `commits`).
- UI: `tests/ui/ade-v2-panel.spec.ts` new `contract: the Changes tab lists the branch files by path
  only`: board fixture branch `b_auth` takes `files` and `commits` from the contract (P250 S7 pattern:
  fixture ids kept, values copied); open branch, Changes tab; one `ade-changes-file-row` per contract
  file with its path; no delta text (`/[+−-]\d+/`) in the rows.
- Key: `ade-review-open` `AdeTaskService.Branch#committed` (existing).

G3 P258 view head from refs and status. Docker: no.
- Flow: `internal/flows/gitflow/ops_local_test.go` `TestCherryPickRevertConflict`: after the first
  conflicting pick (before `opAbort`), `st := r.status(id)`; assert `st.InProgress.Kind ==
  InProgressCherryPick`; record `git:status.get#cherry-pick` into new `git-view-head`
  (`Mask("otherSha")`; `dirtyPaths` stays: it names the conflicted file).
- UI: `tests/ui/repo-commit-meta.spec.ts` new `contract: the view head shows the branch, its behind
  count and the operation in progress`: `openPortGraph` with `results: { 'refs.list':
  contract('git-remote', 'git:refs.list#behind'), 'status.get': contract('git-view-head',
  'git:status.get#cherry-pick') }`; `git-view-head-branch` reads the head branch short name;
  `git-view-head-sync` reads `↓${behind}`; `git-view-head-operation` starts with `Cherry-picking`
  (`describeInProgress` label; `otherSha` masked, so assert the prefix only).
- Keys: `git-view-head` `git:status.get#cherry-pick` (new); `git-remote` `git:refs.list#behind` (existing).

## 3. Not a code change: `ui-timing` budgets flake

P250 result: Studio `ui-timing` `budgets` interaction p95 76 ms vs 50 (then 19 vs 16) at load
average 20; no source on that path changed. Action: rerun on a quiet machine (load average < 2, no
other suite or agent running), once:
`bun run build:test:studio && playwright test --config=apps/kira-studio/playwright.config.ts --project=ui-timing`.
Record p95 and load in the result file. A pass closes it. A fail on a quiet machine is a real
regression: bisect and fix in this phase, or a named SPEC follow-up if outside scope.

## 4. Streams

Split possible, not taken. Ownership if split:

| Stream | Owns (zero overlap) | Items |
|---|---|---|
| A (Studio) | `apps/kira-studio/internal/flows/{dockerflow,appflow,termflow}/**`, `apps/kira-studio/tests/{ui,contract}/**` | D1, D2, D3, R1, A1 |
| B (Space) | `apps/kira-space/internal/flows/{termflow,gitflow}/**`, `apps/kira-space/tests/{ui,contract}/**` | A2, W1, G1, G2, G3 |

No item touches `packages/**`, root `internal/**`, root `package.json` or docs. A1/A2 mirror each
other but share no file. No ordering dependency: no item reads another stream's fixture. Result
file belongs to whoever runs close-out (one implementer: last commit).

Decision: one sequential implementer, A then B. Reasons: 10 small items (~1 h of edits); free disk
3.2 GB at planning (`df -h /`), below the 6 GB guardrail even for one build, so a second worktree
with its own `node_modules` and frontend builds does not fit. If disk is freed to >= 15 GB the table
above allows two worktrees off `dcdbe9233`.

## 5. Commits (Conventional Commits; hook runs lint/typecheck)

1. `test(studio): docker edit stale, managed, stopped and auto-remove contracts` - D1, D2, D3.
2. `test(studio): image registry and open-external contracts` - R1.
3. `test(studio): schedule off through the script editor` - A1.
4. `test(space): schedule off through the script editor` - A2.
5. `test(space): workflow layout reads the backend workflow` - W1.
6. `test(space): name-status detail, changes tab and view head contracts` - G1, G2, G3.
7. `docs: P250 iter2 result` - `plans/P250-iter2-result.md` (items, fixture keys, run counts, the
   `ui-timing` quiet rerun outcome). SPEC status is the orchestrator's.

Each fixture is written with `KIRA_CONTRACT=write`, read by hand (no secrets, machine paths or run
ids), committed with its test.

## 6. Verification (targeted only)

Guardrails from `P250-plan.md` §8: one suite at a time; `df -h /` >= 6 GB before a build (reclaim
only `/tmp/go-build*`, `/tmp/playwright-transform-cache-*`, `apps/*/test-results`); never
`docker image prune`. Start `dockerd` per `docs/DEV_ENVIRONMENT.md` before D1-D3, R1.

Write fixtures:
```
KIRA_FLOW_DOCKER=require KIRA_CONTRACT=write go test -run 'TestUpdateContainerRejects|TestUpdateStoppedContainer|TestImageRegistryURL' ./apps/kira-studio/internal/flows/dockerflow/
KIRA_FLOW_COMPLETE=1 KIRA_FLOW_DOCKER=require KIRA_CONTRACT=write go test -run TestRecreateRefusals ./apps/kira-studio/internal/flows/dockerflow/
KIRA_CONTRACT=write go test -run TestOpenExternal ./apps/kira-studio/internal/flows/appflow/
KIRA_CONTRACT=write go test -run TestScriptEditorSave ./apps/kira-studio/internal/flows/termflow/ ./apps/kira-space/internal/flows/termflow/
KIRA_CONTRACT=write go test -run 'TestCommitDetailAndDiff|TestCherryPickRevertConflict' ./apps/kira-space/internal/flows/gitflow/
```
Check them (no drift, stable):
```
KIRA_FLOW_COMPLETE=1 KIRA_FLOW_DOCKER=require go test -count=2 -run 'TestUpdateContainerRejects|TestUpdateStoppedContainer|TestImageRegistryURL|TestRecreateRefusals' ./apps/kira-studio/internal/flows/dockerflow/
go test -count=2 -run 'TestOpenExternal|TestScriptEditorSave' ./apps/kira-studio/internal/flows/appflow/ ./apps/kira-studio/internal/flows/termflow/
go test -count=2 -run 'TestScriptEditorSave|TestCommitDetailAndDiff|TestCherryPickRevertConflict' ./apps/kira-space/internal/flows/termflow/ ./apps/kira-space/internal/flows/gitflow/
go test ./apps/kira-studio/internal/flows/coverage/ ./apps/kira-space/internal/flows/coverage/
git diff --exit-code -- apps/*/tests/contract/
```
UI:
```
bun run build:test:studio && playwright test --config=apps/kira-studio/playwright.config.ts --project=ui docker-edit docker-module automations-editor
bun run build:test:space && playwright test --config=apps/kira-space/playwright.config.ts --project=ui automations-editor ade-v2-workflow-layout repo-commit-detail ade-v2-panel repo-commit-meta
```
Fast checks: `bun run lint`, `bun run typecheck`, `bun run lint:go` (alone; retry after 60 s on a
lock error). Then §3 `ui-timing` rerun on a quiet machine.

Orchestrator checks before accepting: each item's flow test calls `.Contract(` with its key and its
UI spec calls `contract('<scenario>'` with the same key (grep both); `ls apps/*/tests/contract/` gains
`docker-registry.json`, `link-open.json`, `git-view-head.json`; `docker-edit.json` gains the
`#stale`, `#managed`, `#stopped`, `#auto-remove` keys; both `script-editor.json` gain `#schedule-off`;
`git-commit-detail.json` gains `#binary-mode`; both `exempt.txt` empty; result file records the
`ui-timing` rerun with load.
