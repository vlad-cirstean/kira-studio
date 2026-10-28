# P394 code review, round 1

Base: `6bd97b9a2` (v0.2.20 squash merge; its tree equals `7adbb54f5`, the chapter-close commit after P386's last fix `67c8e566b`, apart from the removed `docs/v0.2.20/`). Diff `6bd97b9a2..a4698c0a5` (HEAD). Phases: P388 to P393.

CodeGraph MCP unavailable (`codegraph` binary not on PATH); discovery used Grep/Read.

Count: 0 high, 1 medium, 3 low.

## F1 (medium) Restart leaves an unguarded window where a second resume can start

`apps/kira-space/internal/ade/launches.go:181` (`RestartSession`).

`RestartSession` calls `tr.Stop` and then `CloseTerminal` without holding `b.taskMu(rec.TaskID)`. `Stop` marks the record `stopped` and fires `OnChange` at once. `CloseTerminal` then blocks for up to `closeGracePeriod` + `closeKillWait` (2 s + 2 s, `internal/terminal/session.go:31,41`) while the old `claude` is still alive.

Failure scenario: during that window another window or the phone sees the session as stopped and clicks Take over. `takeOverSession` and `ensureNotOpen` pass: state is `stopped`, `ListRunningTUI` excludes it, no pending intent exists. A second `claude --resume` is prepared on a conversation the old process still writes. That is the exact case the comment on line 212 says must not happen. Restart's own `TakeOver` then fails with "a launch of the conversation is already starting", after it has already killed the user's terminal. A second gap: `Session.closeFor` returns at once without waiting when the session is already closing (`session.go:275`), so a concurrent tab close also lets Restart resume before the old process exits.

Fix: hold `b.taskMu(rec.TaskID)` across Stop, CloseTerminal and the resume. Split `TakeOver` into a locked wrapper and an unlocked body, and call the body from `RestartSession`. Concurrent Take over then waits, and its `ensureNotOpen` re-check under the lock rejects it once Restart's intent is pending. Add a flow case: Take over during Restart is refused, or waits and gets "already starting".

## F2 (low) `Tracker.Stop` failure strands a live session as running

`apps/kira-space/internal/ade/tracker.go:574` (`Stop`).

`Stop` calls `forgetLocked` before `MarkStopped`. If `MarkStopped` fails, the in-memory maps are already cleared, but the DB row stays `running` and the terminal is still alive (Restart returns before closing it).

Failure scenario: a DB write error (locked DB, disk full) during Restart. Nothing tracks the terminal now: `Reconcile` skips it (not in `spawnedAt`), and hook events are dropped (not in `live`). A retried Restart fails "the session is not running" (`TerminalOf` false). Take over fails "the session is already open" (row still `running`). The row stays wrong after the terminal exits, until app restart. `Reconcile` uses the same order, but there the terminal is already gone. Here the terminal is still alive.

Fix: in `Stop`, call `MarkStopped` first and forget only on success. Or restore the forgotten entries on failure.

## F3 (low) Terminal link hint is not clamped vertically

`packages/workbench/src/terminal/terminalRenderer.ts:70` (`createLinkHint.show`).

`left` is clamped to the terminal box. `top` is always `clientY - box.top + 16`, with no clamp.

Failure scenario: a link on one of the last rows. This is common, because Claude Code prints links just above its input box at the bottom. The two-line hint is placed below the terminal's bottom edge. It is clipped by the pane (splitter panels clip overflow), so the URL preview and "Cmd-click to open" hint do not show where they are needed most.

Fix: if `top + el.offsetHeight > box.height`, place the hint above the pointer (`clientY - box.top - el.offsetHeight - 8`), clamped at 0.

## F4 (low) Contract version test name not bumped

`apps/kira-space/internal/gitrpc/stash_test.go:46`.

The comment says `TestContractVersion_Is55`, but the function is still `func TestContractVersion_Is54` while it asserts 55. A failing run would print a name that contradicts what it checks. A grep for the current version would also miss it.

Fix: rename the function to `TestContractVersion_Is55`.

## Checked, nothing real

- Contract bump: Go `ContractVersion` and TS `CONTRACT_VERSION` are both 55, with matching history lines. `graphChunkFrame` testdata was re-captured. The `number` param is optional on both sides, and Go rejects negative values.
- Review ref spelling: `hostHeadName` strips only `refs/remotes/origin/` and leaves other spellings as they are. A fork `<owner>/<head>` gets its number from the task link instead. `linkedChangeRequest` matches provider id plus host, owner and name case-insensitively, so a link to another repo never sets the number. `ParseBranchLink` parses only and makes no host call.
- Terminal links: http(s) is checked twice (`isWebUrl` in the renderer, `shell.OpenExternalURL` in Go). OSC 8 uses `allowNonHttpProtocols: false`. Desktop needs the modifier. The hint shows the real target, so an OSC 8 label cannot hide where a link goes. `URL.canParse` is safe on the macOS 26 floor. `createOpenExternal` never rejects, so `void options.openExternal` is fine.
- Scrollbar CSS (`packages/theme/src/base.css:53`): the `:where(:hover)` custom property is invalidated only along the hover chain that changes. The universal reset stops inheritance from spreading past each element's direct children. No concrete cost was found that would justify a trace. Behaviour is covered by `scenarios/scrollbars.ts`.
- Removed components (`AdeSessionBar`, `AdeSessionId`, `AdePlanHeader`): no live references remain. Leftover testids appear only in negative assertions. `docker.action.restart.label` was removed with no remaining callers. The tone maps are still used.
- Rules: every new `.vue` file is `<script setup lang="ts">`, with no scoped styles. Uses shadcn `Tooltip`/`Separator`/`Button`, the existing context-menu store, and TanStack mutation. The archived guard on Take over/Stop still holds, because the tab row is hidden when archived.

## Fix notes

- F1: fixed in `28e11a9af`. `RestartSession` holds the task lock across Stop, close, resume; `TakeOver` body split into `takeOverLocked`. No Go race test: the window needs a terminal that outlives SIGTERM, timing-dependent and flaky; existing `TestRestartSession` covers the path.
- F2: fixed in `28e11a9af`. `Stop` marks stopped first, forgets only on success.
- F3: fixed in `f6796796f`. Hint flips above the pointer near the bottom; new scenario in `terminalLinks.ts` fails without the fix.
- F4: fixed in `7a530b5d5`.
