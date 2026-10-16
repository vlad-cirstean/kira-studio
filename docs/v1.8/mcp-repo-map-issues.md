# v1.8 repo-map MCP dogfooding log

Continuing v1.5/v1.6/v1.7's practice: every phase dogfoods the repo-map MCP server for its own
implementation work. Trivial findings (config, registration, wiring) get fixed inline and logged
one line here. Non-trivial findings (wrong result, missing tool, crash) get a full entry and no fix
in that phase — a dedicated fix pass closes them, same shape as v1.6's P64/P68b/P69d/P69e and
v1.7's M1c.

## Log

- **P72 (planning)**: used for navigation throughout. `find_references` on `shortRepoLabel`
  returned the single `RepoPicker.vue:29` call directly, settling the plan's dead-code audit
  (§1.1 #7) in one call instead of a grep sweep over `packages/` and `apps/` with `dist/`
  exclusions; `search_symbols` on `rowMetadata` located `columns.ts:318` without opening the file.
  `find_definition`/`find_references` on functions worked correctly across packages
  (`formatRelativeDate` → 18 hits spanning `apps/kira-studio-vscode`, `apps/kira-studio` and
  `packages/git-core`).

- **P72 (planning)**: the token file (`$KIRA_HOME/mcp-repo-map-*-token.json`) stores only
  `hash`/`salt`/`expiresAt`, so a session that no longer has the startup banner cannot recover the
  bearer token from disk. Trivial and already documented — `CLAUDE.md`'s own remedy ("delete that
  repository's `mcp-repo-map-*-token.json` and restart") is exactly right and worked. Logged only
  so a future session reaches for it immediately instead of trying to read the token out of the
  JSON. No fix needed.

- **P83 (planning)**: used for navigation throughout, over plain HTTP/JSON-RPC (`CLAUDE.md` step 4 —
  the native tool surface is unavailable in an agent-harness session, as its own step-3 caveat
  says). `find_definition {"symbol":"ResolveHead"}` returned `gitclient/repo.go:251:6` with its
  signature, settling in one call whether a HEAD helper already existed;
  `find_references {"symbol":"worktreeLabel"}` correctly reported two same-named symbols and asked
  for disambiguation, independently confirming P82's own decision to replicate git-ui's helper
  rather than import it. Also worth recording: a **second** concurrent instance binds an
  OS-assigned ephemeral port and prints the "Using this repository's existing token" banner — it is
  usable as long as the first run's banner is still in hand, which is the one case `CLAUDE.md`'s
  step-2 warning does not cover. No fix needed.

- **P83 (planning)**: the two open entries below reproduce unchanged at `dc8867f5` —
  `find_references {"symbol":"GEOMETRY"}` still answers `no references found`, and
  `find_references {"symbol":"TAB_KINDS"}` still returns 12 hits, all in `.ts` files, with none of
  `TabStrip.vue`'s eight `<script setup>` reads. Re-check only; no new entry, since this is the same
  defect at new line numbers, not a new finding.

### Non-trivial

- **P72 (planning) — `find_references` returns "no references found" for a TypeScript `const`
  object that has real, same-file reads.**

  - **Found in**: P72 (planning)
  - **Status**: Open. Not fixed in P72, per this log's own rule.
  - **Query/tool call**: `find_references {"symbol":"GEOMETRY"}`; also
    `find_references {"symbol":"STATE_ICONS"}`
  - **Expected**: for `GEOMETRY` (`packages/git-ui/src/graph/geometry.ts:10`), at minimum its three
    same-file reads inside `graphColumnWidth` (`geometry.ts:51`, `:52` ×2, `:53`), the re-export at
    `graph/rowSvg.ts:27`, and the three reads in `components/UncommittedChangesStrip.vue`
    (`:111`, `:145`, `:147`). For `STATE_ICONS` (`packages/git-ui/src/icons/index.ts:38`), its
    consumers in `RepoPicker.vue`, `NoRepositoryPanel.vue`, `BranchPicker.vue`,
    `review/BaseSelector.vue`, `GitBlockedPanel.vue` and `EmptyRepositoryPanel.vue`.
  - **Actual**: both answer `no references found`. `find_definition` resolves each symbol correctly
    (`STATE_ICONS` → `icons/index.ts:38:14  constant`), so the symbol is indexed; it is the
    reference edges that are missing. Two further data points narrowing it: `find_references` on
    `TAB_KINDS` returns 12 hits, all in `.ts` files, and none of `TabStrip.vue`'s six script-block
    reads (`:26`, `:32`, `:36`, `:40`, `:46`, `:122`); `find_references` on `SETTINGS` returns 15
    hits, all inside `packages/git-core/`, and none of `packages/git-ui/src/state/repoSettings.ts`'s
    eleven reads or `dialogs/RepoSettingsDialog.vue:133`. Function references (`call` kind) resolve
    correctly in the same files and across the same package boundaries, so the gap is specific to
    non-call reads of a `const`, not to `.vue` parsing or to workspace aliases on their own.
  - **Why it matters**: a "no references found" answer is indistinguishable from genuine dead code.
    This phase's §1.1 audit is exactly a dead-code audit, and `STATE_ICONS.check` would have been
    deleted on the strength of a wrong answer had the result not been cross-checked against grep.
    That is the same failure shape as v1.7's closed M1ab entry (a Go struct field reached only via
    selector expression), one language over.
  - **Fix**: needs a dedicated pass in `internal/repomap`'s TypeScript reference extraction. Not
    scheduled here.

- **P73 (planning) — the same gap is not specific to a `const`: a *function* referenced as a value
  is missed too.** Narrows the entry above rather than adding a second one.

  - **Found in**: P73 (planning)
  - **Status**: Open, same root cause as the entry above. Not fixed in P73, per this log's own rule.
  - **Query/tool call**: `find_references {"symbol":"repoFileIcon"}`
  - **Expected**: one reference —
    `apps/kira-studio/frontend/src/state/tabKinds.ts:431` (`icon: repoFileIcon`), the function used
    as a value in an object literal.
  - **Actual**: `no references found`.
  - **Contrast, same session, same tree**: `find_references` on `setiIconFor` returned all 14 call
    sites across `packages/git-ui/`, `apps/kira-studio/frontend/` and a `.vue` file;
    `renderMarkdownReading` returned its single call site. So `call`-kind edges resolve correctly
    across package and `.vue` boundaries; it is the non-call read that is missing.
  - **Why it matters**: restates the entry above with a wider scope — the miss is **any non-call
    read**, whatever the symbol's kind, not `const` objects specifically. A fix pass scoped to
    `const` declarations would leave this case open. P73's §2.4 dead-code table was verified by
    grep for exactly this reason.
  - **Fix**: same dedicated pass in `internal/repomap`'s TypeScript reference extraction. Not
    scheduled here.
