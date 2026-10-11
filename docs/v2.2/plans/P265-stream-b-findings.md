# P265 Stream B findings

## Stream B result

Scope: Kira Space frontend (`src`, `mobile`), `packages/workbench/src/memory`, en.json namespaces `space`, `mobile`, `memory`.

### Commits

- B1 `bdac2440d`, B2 `ba93c66b0`, B3 `2ce1d8df6`, B4 `83ef2c076`, B5 `5b661a746`, B6 `523742681`
- B7 sweep and specs: see `git log` on `p265-b` (`refactor(space): B7 ...`)

### Files done

Every owned file moved off the allowlist. B7 swept blind text the guard misses:

- `AdeRunOutcome.vue` copied report lines: now `space.ade.outcome.copy.*`, reusing `endedBy*`, `tried`
- `state/tabKinds.ts` graph tab fallback title
- `repo/state/repoHeads.ts` detached head label
- mobile `PlanTaskCard` status badge: `statusLabel`

### Allowlist remaining

One permanent line in `scripts/copy-allowlist/stream-b.txt`: `AdeActivityIcon.vue` `z` glyph (not text).

### Specs written, not run

- `apps/kira-space/tests/ui/copy-wording.spec.ts`
- `apps/kira-space/tests/ui/copy-coverage.spec.ts`
- `apps/kira-space/tests/mobile/copy-wording.spec.ts`
- `apps/kira-space/tests/mobile/support/mockServer.ts`: new `replies.board` override

Selectors, fixture edits and allow patterns are untested. Expect selector fixes on first run.
Stream C owns `copy-wording-git.spec.ts` and `copy-coverage-git.spec.ts`; both exist in its worktree. Stream B did not duplicate GitPanel, its menus and the repo file view toolbar coverage.

### Deviations

- Memory delete confirm spec covers the discard-import confirm; no other memory delete confirm exists.
- Settings coverage allows the section names (SettingsShell is Stream C): nav renders raw section ids from `state/settings.ts`.
- Plan board empty state spec uses the no-repositories view (`space.ade.view.empty.*`).
- Needs plural spec checks the footer `1 interactive session`.

### Needs from non-owned files

- SettingsShell: take section labels instead of rendering ids ('Mobile access', 'Claude Code').
- Shared fields (`LogLevelField`, `FontSizeField`) are Stream C.
- Non-owned spec hits: none found.

### Left literal on purpose

- Claude prompt text in `ade/v2/dialog/compose.ts` and `board/runMessage.ts` (agent content).
- Persisted `MANUAL_REASON` in AddMemoryDialog.
- Weekday and month names; server run notes.
- `formatRelativeDate`, `formatAbsoluteDate` come from `@kira/git-core`.
- Raw palette colour names in swatch tooltips and menus.
- `needsYou` scope shows raw `runsOn` ('each repo'); parity spec compares it lowercase.
- Product name 'Kira Space' passed to `createAppUpdateStore`.

### Promotion candidates for `common.*`

- Agents, Changes, Graph, Success.
- Kind labels User, Agent, Script reuse `memory.common.author.*` and `space.ade.stage.modeScript.label` (C3-forced).

### Checker gaps

- PROPER_NOUNS lacks PATH, MB, AC, Max, Agents; worded around.
- Plural `{count}` shows no thousands separator in search results.
