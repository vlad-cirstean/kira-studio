# History verify sample

Chapters: v1, v1.1, v1.2, v1.3, v1.4, v1.5, v1.6, v1.7, v1.8, v1.9, v2.0, v2.1, v2.2. Sample 12 of 457 phases. Fallback units: 0. Pending units: 0.
`[carried]` = at least 40% of the source line's long words appear in the phase's history lines; `[CHECK]` needs a human read.

## v2.0 P175 Studio API client follow-ups
state ok, 17 lines, source 3890 chars
history:
  Studio API client cookies list, response history and gRPC schema runtime move from hand-rolled server-state caches to TanStack Query, keyed by URL, scope and source, with the P8 D11 lazy-when-hidden rule as enabled.
  Go net/http/cookiejar cannot enumerate or delete cookies by exact id, so the cookie list can disagree with what deletes; Remove by exact domain and path needs a replacement jar, and HttpDeleteCookie plus CookiesPane.v...
  The cookie jar is forked from the Go stdlib cookiejar with exact delete; the ascii copy lives in cookiejar/internal/ascii, so jar.go and punycode.go differ from upstream only by the import path.
  .golangci.yml excludes the vendored cookiejar files from gocognit, gocyclo, gocritic and bodyclose.
  Call cancelQueries after the bridge call, not first, in deleteJarCookie and clearJarCookies, because cancelling first lets an in-flight list fetch resurrect the deleted row.
  In the dotenv bulk editor, a single-quote-wrapped value loses its quotes on a no-edit Apply, and a leading single quote without a closing one makes the editor unappliable.
  apiSavedRequestQueryOptions in api/state/apiQueries.ts and its gRPC twin should return null only for E_NOT_FOUND and rethrow other errors, instead of returning null on any error.
  applyEditRaw in api/state/raw.ts dropped disabled header rows and descriptions on a no-edit Apply (Part 7 F17); fixed in P175.
  History entries show a note in HTTP ResponsePane.vue, RawExchangePane.vue and gRPC ResponsePane.vue when requestFieldsElided or metadataElided is set.
  resolveGrpcTabState lives in views/grpcrequest/resolve.ts to avoid an import cycle with schemaQuery.ts.
  grpcSchemaSourceFor is synchronous and gated by a ready flag on the collections tree load.
  Accepted tradeoffs: a viewing flash while a different snapshot loads, and "Method not resolved" for up to 150 ms after a schema-source edit.
  P172: repoSettings.set refuses the prepare script (E_READ_ONLY); settings.setGitPath was removed (contract 43); one Approve admits only the presented pairing request; peer uid and pid are read at accept (fail closed)...
  Open decision D6 (bind token to peer identity on reconnect) is a known open item.
  P174: console and MCP results share one cap with a truncated flag and early cursor close; SQS read-only polls hide messages for 1 second because the AWS SDK cannot send 0, with a warning and confirm.
  P174: staged edits survive reload keyed by primary key, merged with P170's commit-in-flight refusals.
  Stale terminalShutdown mock entries for the unbound TerminalService.Shutdown were removed, fixing the mock-runtime-bindings failure.
source markers in unit:
  [carried] Done. Origin: P168 Part 10 F24, Part 6 F12, Part 7 F15, plus renderer halves routed from Parts 6 and 7 that did not land. Decisions: Part 10 F24 (cookies list, response history, gRPC schema runtime are hand-rolled server-state caches; move to TanStack Query...
  [carried] P172: `repoSettings.set` refuses the prepare script (`E_READ_ONLY`); `settings.setGitPath` removed, contract 43; one Approve admits only the presented pairing request; peer uid and pid read at accept (fail closed), shown in the pairing dialog. Open decision...
other SPEC marker lines naming P175:
  [carried] | **P175 Studio API client follow-ups** | Done. Origin: P168 Part 10 F24, Part 6 F12, Part 7 F15, plus renderer halves routed from Parts 6 and 7 that did not land. Decisions: Part 10 F24 (cookies list, response history, gRPC schema runtime are hand-rolled s...
  [CHECK] | **P180 Real-machine verification and pending changes (user-run)** | **Closed by user decision, partially done.** One phase for everything the Linux sandbox cannot run; P159 and P171 (rows removed, numbers not reused) and the workflow patches formerly item...

## v1.8 P80 Update main docs
state ok, 7 lines, source 3780 chars
history:
  Use git rebase --rebase-merges, because a plain rebase flattens merge commits and reproduces spurious conflicts (recorded in docs/DEV_ENVIRONMENT.md).
  P76 shipped the blame status-bar readout as a sibling item, not a LAW-14 violation.
  The v1.8 docs update documents only externally visible P79 changes: two settings leaves, GHES host support, link.openExternal, the PR-ancestry base cutoff, preview-model LRU refcounting, and the KeepAlive-visibility p...
  Per CLAUDE.md's repo-map process, the next phase waits for a dedicated fix pass to close an open dogfooding entry. docs/v1.8/mcp-repo-map-issues.md has two open non-trivial entries with no fix-pass phase in v1.8, so t...
  Biome does not check .md files; it reports them as ignored, so markdown docs need a manual read for consistency.
  The pre-commit hook runs bun run typecheck across all 5 sub-projects.
  docs/ARCHITECTURE.md covers incognito tabs and the external-open capability (link.openExternal, IsGitHubHost/GHES support).
source markers in unit:
  [CHECK] current source at edit time rather than trusted from the plan's own prose (itself already written
  [CHECK] omitted but its §6 verification checklist required (flagged as a plan gap rather than silently
  [carried] pass to close it"), left open rather than folded into a docs-only phase.
  [carried] rather than `CLAUDE.md`'s standard two), P80 (main-docs update) and P81 (fix the flaky UI tests
other SPEC marker lines naming P80:
  [CHECK] | **P81 Fix flaky UI tests** | P79's own full-suite verification pass (`bun run test:ui`) found three Playwright UI tests that fail intermittently under full-suite parallel load but pass every time in isolation: `cell-editor.spec.ts`'s "autodetect, beautify...

## v2.0 P126 Kira Space "Data font size" renders much smaller than set — find the cause li...
state ok, 12 lines, source 4967 chars
history:
  Static tracing of the Kira Space Data font size pipeline (settings domain, applyAppearance(), tokens.css --kira-font-size/--kira-t-* scale, Monaco/xterm/git-ui consumers) found it unit-correct: px throughout, no rem/e...
  P123 intentionally splits chrome vs data text roles by 1-2px, which is too small to explain the reported 'much smaller' Data font size rendering in Kira Space.
  P126 acceptance: record root cause plus before/after computed-style evidence; the affected node must compute to the configured size after the fix; a test:ui:space assertion on computed font size must guard it, shaped...
  Fix the cause found by a live runtime check (getComputedStyle and cascade walk in a running Kira Space), never an assumed cause.
  The dead xs class was removed from StatusBar.vue because no built CSS chunk in either app's frontend/dist defines a .xs rule; the node still computes 11px from its parent's text-kira-sm.
  For a Kira Space real backend in a sandbox, build with go build -tags server and seed windows('main') plus a code_repos row before loading /?window=main, otherwise internal/appstorage/tabs.go:117 fails with 'unknown w...
  Git discovery in Kira Space is darwin-only (apps/kira-space/internal/gitclient/discovery.go), so exercising real git in the sandbox recipe needs a local-only, never-committed Locate patch.
  Live measurement in a Linux sandbox (Go server-mode backend, WebKit and Chromium) showed every text node computing exactly the configured Data font size, none below 11px, applied live with no stale value, so no defect...
  Reading source for macOS-only layers (WKWebView zoom clamps, -apple-system vs Menlo face, git.graphFontSize override) found no defect.
  The P126 root cause is still open; it is blocked on plan §4's live measurement on a real macOS host (inspectable dev:space or devtools-tagged build, Safari Develop console script, sqlite3 read of ~/.kira-space/kira.db).
  The §5 fix and the test:ui:space guard spec for P126 are gated on §4's macOS measurement output existing first.
  Phase numbering continues the single running sequence (P126+) rather than taking a fresh letter, per CLAUDE.md's one-running-sequence rule.
source markers in unit:
  [carried] numbering (`P126`+) rather than taking a fresh letter, per `CLAUDE.md`'s one-running-sequence rule.
other SPEC marker lines naming P126:
  [CHECK] | **P127 Extract agent-activity monitoring into a shared package; Kira Studio stops consuming it** | P86 (`docs/v1.8/SPEC.md`'s P85/P86 rows and result sections) built Claude Code hook monitoring inside Kira Studio: the Go hook listener `apps/kira-studio/in...
  [CHECK] | **P134 Fix intermittent flake in api-secret-reveal-isolation.spec.ts** | Pre-existing flake, found and left unfixed by P128 per `CLAUDE.md`'s own exception clause (a different subsystem, not this phase's design decision to make). `apps/kira-studio/tests/u...
  [CHECK] | **P135 `ade` icon, dependency nodes, inline Jira line, extend-only estimate** | **Four user requests against the already-shipped `ade` module, merged into one phase per explicit user instruction** (originally separate rows P135-P138; this row keeps the lo...
  [CHECK] | **P141 Code review round 1 of 2** | Scope: everything changed since the last review session. That session is P108 (v1.9, whole-codebase review; close-out `771512bc`, 2026-09-24); no review has run since, so P109-P125 and P126-P140 are all unreviewed. Base...

## v1.9 P108 Part 13 Shared frontend base
state ok, 18 lines, source 8677 chars
history:
  Part 13 (shared frontend base, Stream B position 1 of 8) owns packages/{workbench,theme,kira-ui}/**, packages/shared/caps.ts, packages/shared/protocol/events.ts, and packages/shared/domain/{base64,color,connection,git...
  Part 13 closes first so Part 6 (gate G2) and every later TS chunk review against a settled base, because every TS chunk in both apps one-hops into it.
  useVirtualRows in virtualRows.ts watches rowHeight()/rowHeights() and calls virtualizer.value.measure(), because estimateSize is not one of virtual-core's memo deps and measure was not re-triggered when heights change...
  monacoTheme.ts normalizeColor draws a 1×1 fillRect and reads the pixel via getImageData, emitting #rrggbbaa, because Chromium and WebKit serialize color-mix() tokens as color() strings that the old rgba regex missed,...
  Monaco's 8-digit #rrggbbaa form is valid for token rules foregrounds as well as colors widget entries, per ColorMap.getId's regex in tokenization.js.
  DateFormatField, FontSizeField and GitLogLevelField.vue tie their Label to the control via for+useId instead of wrapping the Reset button inside the label.
  KuiDialog.vue and KuiPopoverPanel.vue must not put aria-hidden="true" on the backdrop when it is an ancestor of the panel, because it hides the whole dialog/popover subtree from assistive tech.
  modalFocus.ts's watch is immediate with an onScopeDispose backstop, so a dialog that mounts already open still gets initial focus, Tab-trap and Escape handling.
  TabStrip.vue no longer reassigns dragId to the hovered tab mid-drag, and createTabsStore's moveTab looks up the target's pre-removal index.
  hydrateTabs syncs the defaulted tab's own active flag, not just activeIdByWorkspace, and closeOthers goes through setActiveTabId instead of setting keep.active directly.
  confirmDialog.ts and useTextPrompt.ts settle a still-pending promise before a second call overwrites it.
  createLayoutStore's applyRemote reapplies the still-pending local patch on top of a same-window layoutChanged echo.
  createTerminalsStore only buffers output into the drain when byTabId still has the tab; routeTerminalData and applyTerminalStatus helpers were extracted from the onTerminal callback to stay under the lint cognitive-co...
  shortcuts/keys.ts matches letter/digit chords against e.code instead of e.key, so Option-modified macOS shortcuts (e.g. tree.copyUri ⌥⌘C) match the physical key; this is unconfirmed on real macOS hardware.
  shared/domain/path.ts canonicalPath keeps a lone separator instead of stripping the filesystem root down to an empty string.
  KuiColumnResizeHandle.vue cleans up on pointercancel and lostpointercapture as well as pointerup, so an interrupted drag cannot leak window-level listeners or fire a stale change.
  The --color-input Tailwind @theme collision: packages/theme/src/base.css:31 (var(--kira-bg-input), wins) shadows shadcn-bridge.css:74 (var(--input)); both resolve to #313131 so nothing is visibly broken. To be folded...
  CommandPalette.vue (shortcuts/) and FkPreviewPopover.vue (views/grid/) in apps/kira-studio each hand-roll the backdrop-ancestor aria-hidden="true" shape outside the shared Kui components. They belong to Part 12 and Pa...
source markers in unit:
  [CHECK] other) rather than a deliberate reset — `--no-verify` was never used to route around it (one
  [CHECK] same shell invocation rather than across separate tool round-trips, was what finally got them to
  [CHECK] there rather than duplicated here at length, since the fixer's own retry cycle above already
  [carried] tie their `Label` to the control via `for`+`useId` instead of wrapping the Reset button inside
  [carried] not just `activeIdByWorkspace` (F7); `closeOthers` goes through `setActiveTabId` instead of
  [carried] matches letter/digit chords against `e.code` instead of `e.key`, so an Option-modified macOS
  ... 2 more
other SPEC marker lines naming P108 Part 13:
  (none)

## v2.1 P198 Agents module: task context menu
state ok, 7 lines, source 797 chars
history:
  The Agents module task context menu opens by right-clicking a task card, pressing Shift+F10, or using the panel header's More actions button.
  The task context menu is built only on existing calls.
  Task context menu items: current stage action, Move to stage, Skip stage, Stop running agents, Open session, Show sessions, Plan (today, next work day, Later), Mark as (not) merging, Open Jira / GitHub, Copy (title, i...
  A review task gets only a read-only subset of the task context menu.
  P198 (task context menu) belongs to Stream E and comes after P197; its Skip item uses P197's traversal.
  The task menu uses descriptors in board/taskMenu.ts and useTaskMenu.ts, and is covered by the spec ade-v2-task-menu.spec.ts.
  The context menu handler sits on the whole card box, because review cards have no head.
source markers in unit:
  (none)
other SPEC marker lines naming P198:
  (none)

## v1.2 P12 Studio/Http(→Api) modularization & separability audit
state ok, 10 lines, source 2067 chars
history:
  Phase P12 (v1.2) is a structural pass on the Studio/Http boundary, not a feature phase: no new user-facing behavior beyond the Http → Api rename.
  P12 extracts the Api-facing frontend code into its own genuine Bun workspace package(s) (e.g. packages/api-core, packages/api-ui), not a tidier directory inside apps/kira-studio; exact naming and split are left to P12...
  The root workspaces config gains packages/* in P12.
  The package split (rather than a directory-only move) follows v1.3's Git module precedent, so the two modules end up structurally consistent.
  P12 splits any test file that grew to cover both modules' cases into one file per module, folder-separated, even where the runner command still runs both suites together.
  P12 audits internal/bridge and the remaining Go side for coupling that would block splitting Http into a standalone app later.
  P12 renames the module Http → Api in user-facing text (the mode tab and other text naming the mode) and in code wherever an identifier, file or directory names the module rather than the HTTP protocol.
  internal/httpclient and other genuinely protocol-shaped names are not renamed in P12.
  The rename to Api is done because gRPC (P11) makes the mode more than an HTTP client, and it goes in the same pass because it touches the same files the separability audit is already moving.
  P12 is the phase every other phase should minimize work for; doing the separation once, deliberately, after the module is feature-complete is cheaper than enforcing perfect separation through ten prior phases or leavi...
source markers in unit:
  [carried] Go back over every phase's output (P1-P11) and tighten the Studio/Http boundary described above: extract the Api-facing frontend code into its own genuine Bun workspace package(s) (`packages/api-core`, `packages/api-ui`, or similar — exact naming and split...
  [carried] Named up front as the phase every other phase should be minimizing work for, not a surprise cleanup at the end: doing this once, deliberately, after the module is feature-complete, is cheaper than either enforcing perfect separation through ten prior phases...
  [carried] written rather than accumulate coupling for P12 to undo later.
  [CHECK] P12 is where that gets a real shared home rather than staying two copies with a comment each.
other SPEC marker lines naming P12:
  [carried] | **P12 Studio/Http(→Api) modularization & separability audit** | Go back over every phase's output (P1-P11) and tighten the Studio/Http boundary described above: extract the Api-facing frontend code into its own genuine Bun workspace package(s) (`packages/...
  [CHECK] | **P13 Api module UI check and improvement** | A dedicated pass over every Api-mode surface (request builder, response viewer, collections tree, dialogs, empty/error states, and so on) checked against the rest of the app's own design system (`docs/design/k...
  [CHECK] | **P14 Api module code review (2 rounds)** | Two rounds of dedicated code review scoped to the Api module only (renamed from Http in P12) — everything under its now-separated directories, plus its facing halves of `internal/httpclient`, `internal/postman`,...
  [CHECK] | **P15 (new) Request builder UX pass — part 1: layout, primitives and body mode** | A user-driven follow-up polish pass over the request builder's own surfaces, split from the editor-behaviour half below (see the two plan docs for the split's own rationale...

## v2.1 P191 Agents module: git refresh does nothing — diagnose and fix
state ok, 5 lines, source 844 chars
history:
  TaskBoard.Refresh in internal/ade/board.go fetches correctly for both Refresh(nil) and Refresh([ids]); the suspected repo-set mismatch does not cause the git refresh problem.
  The UI (AdePlanView.vue runRefresh and AdeReviewSync.vue) sends explicit repo ids to adeTask.Refresh.
  Env scripts, which can take up to 60 s, run beside the git fetch in the refresh.
  AdeReviewSync shows a per-repo error row when a refresh fails for a repo.
  The refresh fix is covered by board_refresh_test.go and ade-v2-plan.spec.ts.
source markers in unit:
  (none)
other SPEC marker lines naming P191:
  (none)

## v1.2 P21 (new) Code review, three rounds — whole application
state ok, 62 lines, source 18816 chars
history:
  P21 is a three-round code review of the entire application (Studio and Api, every phase up to P20), a from-scratch review of the current tree, not a diff. Earlier reviews were module-scoped (P14, Api only); P21 is seq...
  Each review round uses three parallel Opus analysis agents (architecture/structure/maintainability/security, functional correctness/business logic, performance/resource efficiency) that report findings only, then one...
  MySQL/MariaDB URI query parameters no longer splice into a connect-time SET statement.
  sslmode=require verifies the server certificate on Redis/MongoDB (matching Kafka), with an explicit verify-none escape hatch, and rediss:// enables TLS.
  An imported Postman collection's file reference is never carried into a live, sendable path, and curl import (-F name=@path, a lone --data-binary @path, -T path) likewise no longer resolves a live local file path, to...
  Response headers are masked for secrets the same as the request half; a successful gRPC call's StatusMessage/headers/trailers are masked before the renderer or kira.db sees them.
  All transient revealed-secret maps (variables, history popover, Copy-as-curl) re-mask on the same 5-minute auth grace expiry, not only when their dialog closes.
  internal/ipcerr lives outside internal/bridge, and a go list -deps test guards the layering; the layering test enumerates every internal/* package rather than a hand-maintained list.
  The database file is named kira.db (not kira.sqlite) since the Go port; docs/ARCHITECTURE.md, README and PACKAGING were corrected.
  A failed collection import rolls back the collection it partially created, and postman.Parse's whole-file read is bounded.
  safeRun's recover() preserves a panicked *adapters.Error's own code instead of always folding to E_INTERNAL.
  StreamView.vue's compose dialog and Delete button read Caps instead of connection.kind; DocumentView and StreamView also gate writes on the connection's ReadOnly flag as well as adapter Caps.
  connections.Update reconnects a live connection when its destination or ReadOnly flag changes, so the adapter, cache and server-side enforcement do not stay pointed at the old destination.
  kira:v2 ciphertext does not bind additional authenticated data to its row; this is an accepted design constraint because binding it would break SecretStore.copy()'s duplication path.
  sslmode vocabulary differs across the six adapters ("six adapters, six vocabularies"); this duplication and libpq's allow semantics remain an open separate refactor, while Kafka verify-none/insecure, ClickHouse prefer...
  MySQL/MariaDB TLS ServerName uses net.SplitHostPort (fixing IPv6 hosts), and its process-global TLS config registry no longer leaks one entry per connection id.
  Concurrent Test connection presses across multi-window no longer share one Preconnect key, so they cannot kill each other's pre-connect script; a pre-connect script's fallback PATH no longer leads with an empty (.) el...
  internal/storage/model reuses internal/httpclient types; this coupling is a known open refactor.
  Generated SQL literals are dialect-aware (backslash escaping), and dollar-quoting in the SQL splitter/linter is Postgres-only.
  The {{name | transform}} pipe vocabulary (base64/urldecode/case-mapping) is byte-identical between Go and TypeScript.
  The column projection cannot be reduced to zero columns, and hiding one column of a composite primary key fails loudly naming the hidden column rather than reaching an opaque server-side refusal; a blanket primary-key...
  Duplicate row(s) no longer stages a truncated cell as real data, and Commit fails loudly instead of silently no-opping on an unaddressable row.
  A server-streaming gRPC call's terminal event can no longer be dropped by a network-vs-event-channel race, and a streaming call's history row is recorded before its terminal event fires.
  Both history tables cap the whole snapshot rather than field by field, and both history repos gate the byte-budget sweep on a cheap aggregate; the response-history stale flag is sequenced against a concurrent send.
  applyLoadFailure sets a real status on disconnect for every view, not just console.
  SQS never polls automatically; all reload paths (mutation self-reload, sibling-tab fan-out, project-tree double-click reuse) go through one guarded reload().
  Deleting a folder or collection purges every cascade-deleted descendant's cached request, avoiding a live-looking Save button on an orphaned tab.
  Copy-as-curl emits a form-data text row's own Content-Type.
  A stream/Kafka view's "N total" is scoped to the active partition/offset/timestamp filter rather than the whole topic.
  A failed tabsSave no longer permanently blocks a later, identical-looking save.
  MariaDB's fake-data generator respects signed integer display widths and mysql/ClickHouse temporal formats.
  The row context menu builds clipboard snapshots lazily, and resolveColumnOrder is memoized and no longer O(cols²); the console's document parse cache is pruned to the rendered window.
  An oversized page is rejected by its own measured size before being encoded.
  Never spread into Array.push in the project tree row builder, because it hard-fails past ~65k rows.
  Known deferred items: duplicated protocol-neutral field-walk in internal/apivars and bridge/grpc.go; nested-block-comment splitting edge case; DocumentView's per-toggle full-page height recompute and ConsoleResultGrid...
  budgets.spec.ts's scroll p50 threshold is a documented pre-existing flake in the test:ui suite, passing in isolation.
  The gRPC live-message buffer is trimmed to exactly its cap, keeping the most recent 10,000 messages; trimming to 90% of the cap was reverted because it broke the D15/D17 contract.
  The gRPC live-stream buffer uses markRaw so incoming messages are not deep-reactivated.
  MySQL/MariaDB connections serialize concurrent operations against the same pinned connection, matching Postgres's existing fix.
  The Postgres, MySQL/MariaDB and Redis connection sets use dial single-flight and a lock-free LRU-eviction split, so eviction does not block operations and concurrent dials of the same cold database do not race or leak...
  variables.Upsert purges a variable's plaintext-value history when the variable becomes a secret, so earlier plaintext revisions are not readable through the history endpoint.
  oplog's Stop() blocks until its own consumer goroutine has exited, closing a shutdown race.
  connections.Update and Insert route a changed secret through the secret store transactionally, as a fresh connection does, so a rotated password is not left under the connection's old field.
  httpclient redirect handling strips caller-supplied headers, including auth tokens, before following a cross-host redirect.
  Collection export writes its file atomically, so a failed write cannot leave a half-written file in place of the original.
  Postman export reduces a local absolute file path to its base name instead of writing it into the exported collection.
  SQLite DSN parsing rejects URI metacharacters that could smuggle extra file: query parameters past the app's validation.
  Grid and console clipboard TSV export neutralizes a leading formula-trigger character (=, +, -, @, tab, CR), as CSV export already did (CWE-1236).
  The Tree, Connections and Collections services have inconsistent context.Context threading; this was left unfixed because it is a large, invasive refactor across every call site with no single active bug behind it.
  The fake-data generator clamps every generator's output to its declared column bounds, so finance.amount, binary.hex and others cannot emit out-of-bounds values.
  The curl importer/generator round-trips --data-urlencode verbatim and applies the existing ;-in-value guard to -F.
  The URL query codec treats a bare + and an escaped %2B symmetrically on round trip.
  ClickHouse computeOrderBySql falls back to a deterministic all-columns ORDER BY when no better ordering is available.
  enginecache's stale-flip path uses ByteLru.Update() rather than a Set-based re-insert, which lost the entry's place in LRU eviction order.
  The paged find box budgets its per-frame scan by cell count rather than row count and debounces query input at 150 ms, the same as the tree/collections search boxes.
  The HTTP response find bar's findRanges is memoized by (doc, query).
  The browse view's loaded node list is markRaw'd rather than deep-reactive, matching the project tree, since it can hold up to 200,000 entries.
  TabsRepo.Save upserts and prunes rows instead of deleting and reinserting every row for the window on each save.
  Read pendingChanges per cell in SlickGrid's staged-edit extractor, not at build time, because the extractor is not rebuilt on every staging change; hoisting the read broke staged-edit rendering.
  rangeHighlightPlugin's full-document rescan per keystroke was deliberately not changed: it is a CodeMirror ViewPlugin with no unit-test seam and a correctness risk around viewport-boundary widening.
  BrowseView.vue's filter-input debounce was skipped because it has no Playwright coverage to verify a script-setup refactor.
  The gRPC response pane's per-batch row-height remap was left unchanged because it lives in VirtualList.vue, shared across grid/documents/browse/console/gRPC, so changes carry a large blast radius.
source markers in unit:
  [carried] `CLAUDE.md`'s code-review process (three parallel analysis agents per round — architecture/structure/maintainability/security, functional correctness/business logic, performance/resource efficiency — findings only, then one sequential agent fixes everything...
  [carried] This chapter has had two prior module-scoped reviews (P14, scoped to the Api module only) but never a whole-application pass covering Studio and Api together — the same discipline v1.1's P2/P12 applied chapter-wide for that chapter. Sequenced last, after ev...
other SPEC marker lines naming P21:
  [carried] | **P21 (new) Code review, three rounds — whole application** | `CLAUDE.md`'s code-review process (three parallel analysis agents per round — architecture/structure/maintainability/security, functional correctness/business logic, performance/resource effici...
  [carried] | **P22 (new) Sixth user-driven batch — Api/Studio polish, global sizing tokens, search sweep, and schema-aware SQL tooling** | A large, mixed batch of concrete user-reported items, grouped by theme rather than sequence (this phase's own plan may re-split i...
  [carried] | **P23 (new) SQLite storage unbounded-growth audit** | A dedicated audit of every table and cache in the app's own `kira.db` (and any on-disk cache alongside it) for unbounded accumulation, beyond the response/gRPC-history caps already enforced (P8/P18/P21...
  [carried] | **P29 (new) Bind secret ciphertext to its kind (AAD)** | Close a documented, deliberately-accepted gap in this app's credential encryption: `internal/secrets/cipher.go`'s `Seal`/`Open` calls carry no AAD (Additional Authenticated Data) at all, so a `kira:...

## v2.0 P168 Part 10 Studio API client UI
state ok, 6 lines, source 1035 chars
history:
  P168 Part 10 (Studio API client UI) is in Stream C, position 1 of 4, moved from Stream A by user instruction (3 streams).
  Stream C owns frontend/src/{api,views/httprequest,views/grpcrequest}/**, tests/unit/{api-*,grpc-*,http-*,history-runtime-*}, tests/ui/{http-*,grpc-*,collections,api-*,secrets,credential-reveal}, tests/perf/http-* and...
  Part 10 may reach one hop out to workbench/tabViews.ts, App.vue and tab kinds; its callees are api-core, views/shared/request, editor, parse worker and state.
  Route a fix that needs a Stream A-owned file to Stream A; Stream C must not make it, because callee Parts 7 and 9 were not yet reviewed.
  Per-chunk review loop (plan §6): one Opus reviewer with no separate plan step (CLAUDE.md); findings go to plans/P168-part10-findings.md and are committed before the Sonnet fixer; fixes are committed per related group;...
  The plan for P168 Part 10 is in docs/v2.0/plans/P168-prep-plan.md §5.9.
source markers in unit:
  (none)
other SPEC marker lines naming P168 Part 10:
  [CHECK] | **P175 Studio API client follow-ups** | Done. Origin: P168 Part 10 F24, Part 6 F12, Part 7 F15, plus renderer halves routed from Parts 6 and 7 that did not land. Decisions: Part 10 F24 (cookies list, response history, gRPC schema runtime are hand-rolled s...

## v1.8 P79 Code review
state ok, 23 lines, source 10149 chars
history:
  P79 code review was a single round, by SPEC.md's explicit instruction, rather than CLAUDE.md's standard two rounds.
  Close every review round with a full-suite verification pass; it is mandatory and not part of any fix batch's own scope.
  AdvancedSettings.GitLogLevel and AppearanceSettings.DateFormat existed in the settings schema but were never wired to the storage patch structs, repo read/write or downstream, so they were silently no-op; they are now...
  internal/logging has SetLevel, called by a SettingsService.Set hook; the level was previously hardcoded to slog.LevelInfo, and "off" silences logging via LevelError + 4.
  SettingDef.instanceWide was deleted as a dead flag left over from a removed sentinel-row mechanism.
  PrBrowserURL (gitsession/gh.go) and the bridge/github.go validator hardcoded github.com, which broke GitHub Enterprise and made the authenticated-host allowlist not a real allowlist for GHES hosts; both now use repo.H...
  VS Code's proxyHandlers.ts now validates PR URL shape via prUrl.ts, which it previously lacked.
  linkify.ts renders commit-body URLs as a button calling the generic link.openExternal wire method, which validates scheme/host before opening, instead of a live anchor href that bypassed external-open capability gates...
  goInterfacesSatisfiedBy's reverse-direction search unions candidates over every method name in have, because seeding from the single rarest method name is only sound in the forward direction.
  Never write a truncated depth-cap/cycle-guard result to the memo, because it poisons later unrelated lookups; a truncated bool return gates the memo write.
  codeworkspace/nav.go's Definitions, Implementations and References share resolveQueryPoint/resolvePosition helpers, which hold the security-relevant symlink-containment guard.
  Anonymous-nested-struct-embed over-promotion in methodsets.go is left as a documented limitation.
  Always-on blame RPCs regardless of inlineBlame are a deliberate prior design choice and were not changed.
  pr.ts rebuildAncestry excludes ancestors of each PR's baseRef, resolved via the new CommitStore.rowOfBranchTip (local decoration scan, no new RPC); previously it had no base cutoff and tagged nearly all loaded history.
  CommitGrid.vue coalesces PR ancestry rebuilds through a shared ancestryRebuildPending flag drained once via nextTick, which also fixes newly-loaded rows never getting PR badges.
  Preview-cohort eviction in state/tabs.ts batches evicted tabs into one state mutation and one save, and incognito-off now triggers a save.
  The pickerModel Stacks tab count uses the same units as capItems (entries/groups) instead of counting branches.
  navigation.ts provideReferences/provideImplementation capture the active tab id before await and check it is unchanged afterward, to avoid publishing a stale nav-status after a fast tab switch.
  buildPickerModel's expensive filter is split into filterPickerInput (query-gated) and orderAndCapTab (cheap, per-tab), so tab switches no longer refilter when the query is unchanged.
  CommitMeta.vue's PR icon is gated on capabilities.openExternal, like every other external-open surface.
  The scheduleResize zero-size guard raced the detailOpen-watcher rebuild, handling the same host resize twice and letting invalidateAllRows() detach a DOM node mid-measurement; fixed with a lastRebuiltHostWidth dedup a...
  When rebasing a branch containing merge commits, use git rebase --rebase-merges, because a plain git rebase flattens merges and replays batch commits linearly, causing spurious conflicts with already-integrated content.
  Several UI tests are flaky under full-suite parallel load but pass standalone: cell-editor.spec.ts, grpc-request.spec.ts, slick-grid.spec.ts spike test, and commit-meta-clamp.spec.ts; they were filed as P81.
source markers in unit:
  [carried] invalidate/render per individually-resolved PR branch instead of coalescing a burst into one — a
  [carried] evicted tab instead of batching into one state mutation + one save; incognito-off never triggered a
  [CHECK] where a fresh worktree checked out an orphaned "Initial commit" scaffold instead of the real branch
  [CHECK] E's two isolated attempts correctly stopped and reported per explicit instruction rather than
  [carried] width) plus keying the KeepAlive skip off the actual `graphVisible` signal instead of inferring
other SPEC marker lines naming P79:
  [CHECK] | **P81 Fix flaky UI tests** | P79's own full-suite verification pass (`bun run test:ui`) found three Playwright UI tests that fail intermittently under full-suite parallel load but pass every time in isolation: `cell-editor.spec.ts`'s "autodetect, beautify...

## v1.3 G2 
state ok, 0 lines, source 226 chars
history:
source markers in unit:
  (none)
other SPEC marker lines naming G2:
  [CHECK] | **G9** | Switch the repo watcher from `fsnotify`'s kqueue backend to FSEvents, matching what VS Code (`@parcel/watcher`) and Zed (the `notify` crate's macOS backend) actually do. `fsnotify`'s kqueue path needs one open file descriptor per watched director...
  [CHECK] | **G12** | Connectivity, pairing, and review-UI hardening — a real bug/UX batch found by actually using the shipped G10 extension against Kira Studio, not speculative, added 2026-09-08. **(1) Revoke-then-relist**: revoking a connected editor's pairing toke...
  [CHECK] | **G27** | Unicode path normalization (NFC vs. NFD): APFS returns filenames from the filesystem in NFD (decomposed) form, while git stores paths as whatever bytes the committer's platform produced — usually NFC (composed). A non-ASCII filename (accents, mo...

## v2.1 P197 Agents module: skip a workflow stage
state ok, 9 lines, source 1125 chars
history:
  A workflow stage can be skipped via a stage flag in the workflow file (skip: true), implemented in the adeflow parser and writer and as adewire.Stage.Skip.
  No task enters a skipped stage when created, on StageDone or by SetTaskStage; a skipped stage the task already sits on stays its current stage.
  A workflow must keep at least one stage runnable (not skipped).
  The skip toggle in the workflow editor goes through P196's explicit Save, so a started task keeps its snapshot of the workflow.
  Right-clicking a stage in the workflow editor (AdeStageCard.vue) opens the shared context menu with Skip / Don't skip, move up, move down and remove.
  The task view offers a one-off skip: right-clicking a stage block gives Move task here / Skip this stage, using P192's SetTaskStage.
  The stage mover, progress segments and Done action step over skipped stages.
  The stage-card right-click menu uses the workbench ContextMenu.vue, not a new shadcn ContextMenu.
  Refusal to enter a skipped stage lives in Go (ade/stages.go traversal, tested in stages_test.go), so the mock runtime was not changed.
source markers in unit:
  (none)
other SPEC marker lines naming P197:
  (none)
