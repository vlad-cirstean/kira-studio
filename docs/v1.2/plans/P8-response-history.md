# P8 — Response history

> **What this phase is.** `docs/v1.2/SPEC.md`'s P8 row: **past responses are persisted per request,
> not just the most recent** — **browsable** in the response viewer, and **comparable against each
> other**. The SPEC's own "why here" column states the shape the design has to honour: *"a response
> history entry is a saved snapshot of exactly what P2's response viewer already renders"*, and
> *"history is naturally scoped per saved request"*.
>
> **What does not land here.** The raw byte-level inspector and raw editor (P9), the
> DNS/connect/TLS/TTFB timeline (P10), gRPC (P11), the module rename and package split (P12), the
> UI-consistency pass (P13). Also explicitly not here: a Postman-style **app-wide** History list
> (§8 OQ-3), comparing entries belonging to *different* requests (OQ-4), replaying a stored entry as
> a new send (OQ-5), saving a stored response to a file (OQ-9), rendering a stored binary body (D5,
> OQ-2), and any new Advanced setting (D6, OQ-1). Nothing here is half-built toward any of them
> (`AGENTS.md`: *"Scope left out of a phase is left out entirely, not half-implemented"*).
>
> **Every claim below was re-read against the tree, not inherited from P2's/P4's/P5's prose.** Base:
> branch `claude/feature-v1-2` at `6aa0699` (*"docs(plan): fill in P7's acceptance checklist"*).
> File:line citations point at that content. Four claims that a plan can get wrong by reading alone
> — SQLite window functions, a `DESC` index, a `GENERATED ALWAYS AS … VIRTUAL` column and whether
> the planner uses an index on one — were **run** against `modernc.org/sqlite`, the driver this app
> actually ships, not assumed from the docs (F7, F8).
>
> **The one-sentence design.** Go already holds both halves of every exchange at one point
> (`bridge/http.go`'s `Send` closure), so recording is one repo call inside the op that already
> exists; the entry lands in one new `kira.sqlite` table bounded by three caps that each bound a
> different thing; and the viewer needs no second renderer, because `ResponsePane.vue` is already a
> pure function of one response object — history swaps the object.

---

## 0. Scope, non-scope, ground rules

### 0.1 In scope

| File | What changes |
|---|---|
| `packages/shared/domain/response-history.ts` | **new** — the summary/snapshot TS mirrors (D9) |
| `packages/shared/domain/http.ts` | `httpResponsePaneSchema` gains `'history'` (D10) |
| `apps/kira-studio/internal/storage/migrations/0008_p8_response_history.sql` | **new** — one table, three indexes (D3) |
| `apps/kira-studio/internal/storage/migrations/embed.go` | one `names` entry |
| `apps/kira-studio/internal/storage/model/responsehistory.go` | **new** — `ResponseHistoryEntry`, `ResponseHistorySnapshot`, `ResponseHistoryRecord`, `Validate` |
| `apps/kira-studio/internal/storage/repos/response_history.go` | **new** — `Record`, `List`, `Get`, `Delete`, `Clear`, `Adopt`, `SweepOrphans` (D4–D7) |
| `apps/kira-studio/internal/storage/repos/response_history_test.go` | **new** — §6.2 |
| `apps/kira-studio/internal/storage/repos/repos.go` | one field, one constructor line |
| `apps/kira-studio/internal/bridge/responsehistory.go` | **new** — `ResponseHistoryService`, five methods (D8) |
| `apps/kira-studio/internal/bridge/http.go` | `HttpSendArgs.ItemID`; the one `Record` call inside the existing closure (D2) |
| `apps/kira-studio/main.go` | one `application.NewService(...)` row; one startup `SweepOrphans()` beside `oplog`'s own prune |
| `apps/kira-studio/frontend/src/bridge/control.ts` | five wrappers |
| `apps/kira-studio/frontend/src/views/httprequest/state.ts` | `itemId` in the send args; the history-staleness hook |
| `apps/kira-studio/frontend/src/views/httprequest/history.ts` | **new** — the per-tab history runtime store (D11) |
| `apps/kira-studio/frontend/src/views/httprequest/ResponsePane.vue` | the source swap, the History segment, the viewing band (D10) |
| `apps/kira-studio/frontend/src/views/httprequest/ResponseHistoryList.vue` | **new** — the list, its per-row actions, the compare selection |
| `apps/kira-studio/frontend/src/views/httprequest/ResponseDiffDialog.vue` | **new** — D12 |
| `apps/kira-studio/frontend/src/views/httprequest/mergeEntry.ts` | **new** — the lazy `@codemirror/merge` entry file (D13) |
| `apps/kira-studio/frontend/src/http/state/collections.ts` | the `Adopt` call after Save as… (D14) |
| `package.json` | `@codemirror/merge` (D13) |
| `apps/kira-studio/tests/ui/support/{ipcChannels,mockRuntime}.ts` | five channels, five FQNs, one `WILDCARD_DEFAULTS` entry |
| `apps/kira-studio/tests/ui/http-history.spec.ts` | **new** — §6.3 |
| `docs/ARCHITECTURE.md` | the schema block, a Storage paragraph, a UI paragraph, the Stack table's chunk note |

### 0.2 Out of scope, explicitly

- **P9–P13's own rows**, listed in the header blockquote.
- **A global "History" view.** Postman's sidebar History lists every request ever sent, across
  collections. The SPEC's row says *"per request"* and its reasoning says *"naturally scoped per
  saved request"*; the schema would support a global list by dropping one `WHERE`, and §8 OQ-3
  hands it forward with that note rather than half-building a second surface.
- **Replay.** Nothing in this phase re-sends a stored entry. P6 §8 OQ-6 asked for the *record* so a
  dynamic value's generated value is knowable after the fact — D2 delivers exactly that and no
  more; OQ-5 states what a replay would additionally cost.
- **Storing a binary response's bytes** (D5). Reported, not stored.
- **Any new op kind, any new tab kind, any new accelerator or menu item.** §3 establishes why none
  is needed.
- **Any new Advanced setting** for retention (D6, OQ-1).
- **Any `internal/httpclient` change.** F1: `httpclient.Response` already carries every field an
  entry stores.

### 0.3 Ground rules

- **A secret's plaintext must never reach `kira.sqlite` outside `http_variables.secret_value`.**
  P5 built a schema where that is true *by construction*, and `bridge/http.go:63-67` already draws
  the exact line this phase has to draw again, one payload larger. F3/D2 is that invariant applied,
  not a preference.
- **`http/**` may not import `views/**`** (`biome.json:124-147`, P1 D7), while `views/** → http/**`
  is permitted and already used. F16 decides every placement question in §4 from that rule.
- **Storage policy lives in the repo, not the bridge.** The three caps (D5, D6) are properties of
  the table, so `ResponseHistoryRepo.Record` applies them; `bridge/http.go` hands over the raw
  request and response and knows nothing about bytes.
- **Unbounded growth is the phase's real risk and is answered with mechanisms, not intentions.**
  §4 D5/D6 state the arithmetic for each cap and what each one bounds that the others do not.

---

## 1. What the code does today

### 1.1 A response exists for exactly as long as its tab is mounted

`views/httprequest/state.ts:131-148` — `HttpRequestViewRuntime` is
`{status, opId, error, response}` over `createRuntimeStore`, with the comment stating the rule
directly: *"D6: the response is runtime-only, never persisted (mirrors consoleTabStateSchema's own
results comment) — a restored tab's response pane starts empty, exactly like a fresh one"*, and a
`registerTabRuntimeCleanup` that deletes the record outright when the tab closes (`:146-148`).

`send()` (`:155-208`) writes `rt.response = response` on success and nothing else; there is no
second consumer, no cache, no persistence. Closing the tab, or quitting, loses it.

### 1.2 `ResponsePane.vue` is a pure function of one response object

`ResponsePane.vue:16-17` is the whole data path:

```ts
const rt = computed(() => runtime[props.tab.id]);
const response = computed(() => rt.value?.response ?? null);
```

Everything below reads only `response.value`: the status chip and `statusClass` (`:86-88`), the hint
(`:54`), `elapsedMs` and `formatBytes(bodyBytes)` (`:91-92`), the redirect caption (`:56-61`), the
truncation strip (`:108-110`), the headers list (`:115-120`), the base64 note (`:122-124`), and
`prettyFormat`/`bodyText`'s `scanJson`/`scanXml`/`beautifyJson`/`beautifyXml` pair (`:33-75`). The
only other input is `tab.state.responsePane` / `tab.state.responseView`, two persisted enums.

### 1.3 The send path already holds both halves at one point

`bridge/http.go:50-96`. Inside `RunOp`'s closure, in this order:

1. `op.SetCommand(method + " " + args.URL)` — the **unresolved** URL, deliberately (`:63-67`).
2. `s.Deps.HttpVars.ResolveRequest(args.URL, args.Headers, args.Body, …)` → `url, headers, body` —
   stage 2, where secrets enter.
3. `httpclient.Send(runCtx, …)` with those resolved values.
4. `op.SetCommand(… + " → " + status)` — again with `args.URL`, not `url`.

So at step 4 the closure holds `args` (the stage-1 form: `{{$dynamic}}` and non-secret `{{name}}`
substituted by the renderer, secret names still literal) and `resp` (the full response) at the same
time, with `s.Deps.Repos` already in scope (`appcore.Deps:40`).

### 1.4 Three history tables already exist, and none of them bounds bytes

- `filter_history` — `repos/filter_history.go:14` `historyLimit = 20`, capped per
  `(connection_id, path)` by a dedupe-`DELETE`, an `INSERT`, then
  `DELETE … WHERE id NOT IN (SELECT id … ORDER BY used_at DESC, rowid DESC LIMIT ?)`, all in one
  transaction (`:40-78`).
- `http_variable_history` — `repos/variables.go:18` `variableHistoryLimit = 20`, per `variable_id`,
  with `recordHistory` (`:405-436`) applying *the identical* insert-then-trim shape, and its own
  comment saying so.
- `op_log` — `repos/ops.go:13` `hardCapRows = 20_000` plus a retention-days cut, applied as
  `Prune` (`:123-137`): two `DELETE`s, the second the same `NOT IN (SELECT … LIMIT ?)` shape. Run
  once at `Wiring.Start()` and then every `pruneEveryOps = 500` completed ops
  (`oplog/wire.go:46`, `:85-90`, `:188-192`).

Every one of them stores short text — a `WHERE` clause, a variable value, a command string. None
stores a payload, so none of them has ever needed a byte bound.

### 1.5 Collections gave a request an identity; a scratch tab still has none

`http_items.id` is a saved request's identity, and a tab binds to one through
`tab.state.itemId` (`packages/shared/domain/http.ts:208`, `null` for a scratch request).
`docs/ARCHITECTURE.md:730-741` records why the binding lives in the state and not in `path`.
`openHttpRequestTab()` still opens a connectionless tab with `path: 'request'` and
`itemId: null`, and P2's own three create affordances (`HttpStart.vue`, the panel header, the
palette) all produce exactly that.

### 1.6 There is no diff or merge code anywhere in the repo

Verified, not assumed. `git grep -n diff` over `apps/kira-studio/frontend/src` and
`packages/shared` returns `SettingsDialog.vue`'s `diffSection` (`:53-65`, a one-level
`Object.keys` comparison producing a settings patch) and prose in comments. No text diff, no LCS, no
Myers, no merge view, no `@codemirror/merge`.

---

## 2. Findings

### F1 — `httpclient.Response` already carries **every** field an entry needs
`client.go:84-96`: `Status`, `StatusText`, `Proto`, `Headers []Header`, `Body`, `BodyEncoding`,
`BodyBytes`, `BodyTruncated`, `ElapsedMs`, `FinalURL`, `Redirects []RedirectHop`. That is exactly
the set `ResponsePane.vue` renders (§1.2) and exactly the set the SPEC's *"a saved snapshot of what
P2's response viewer already renders"* asks for. **`internal/httpclient` needs no change of any
kind** — not a field, not a constant, not a signature.

### F2 — Recording is one call inside the op that already exists, not a second bound call
§1.3. The alternative — the renderer calling a `historyRecord` bound method after
`control.httpSend` resolves — costs a second round trip per send, re-serialises a body that just
crossed the bridge once, and loses the entry outright if the window closes between the two calls
(`CancelWindowCalls`, P2 F11). Go already holds both halves; the insert is local and in the same
goroutine Wails gave the call (P2 F12/P4 F10).

### F3 — The secret line is already drawn, and it is `args` versus `resolved`
`bridge/http.go:63-67`, verbatim:

> *"P5 D6/F3: `op.SetCommand` is called with the **unresolved** URL, both times — `op_log.command`
> is a persisted SQLite column rendered in the Operations panel, and a `{{token}}` in a URL is
> exactly the kind of thing a user puts a credential in. Resolving secrets before this line would
> write a plaintext credential into `kira.sqlite` on every send."*

A response-history entry is a **much** larger persisted payload than `op_log.command`, and it
carries headers and a body as well as a URL — so the same rule binds harder, not less. Recording
`url`/`headers`/`body` (step 2's output) instead of `args.URL`/`args.Headers`/`args.Body` would
write a decrypted `Authorization: Bearer …` into `kira.sqlite` on every send and quietly undo P5's
entire `value`/`secret_value` schema split. D2 records `args`.

### F4 — `tab_id` **cannot** be a foreign key into `tabs`, and this is not a stylistic call
`repos/tabs.go:96` — `TabsRepo.Save` opens its transaction with
`DELETE FROM tabs WHERE window_key = ?` and re-inserts every record. `state/tabs.ts:128-134` —
`saveDebounced()` fires that save **1 000 ms** after any tab-state mutation, and
`patchHttpRequestTabState` is called on every keystroke in the URL field
(`HttpRequestView.vue:55-57`), every pane switch, every splitter drag.

So `tab_id TEXT REFERENCES tabs(id) ON DELETE CASCADE` would delete a scratch tab's entire response
history **about one second after the user typed a character into the URL bar** — every time. The
`_foreign_keys=1` DSN (P4 F9) makes that cascade genuinely fire, which turns a plausible-looking
declaration into silent, reproducible data loss. D3 declares no FK on `tab_id` and D7 sweeps
orphans at startup instead.

### F5 — `item_id` *can* be a foreign key, and it cascades for real
`storage/db.go:35` sets `_foreign_keys=1` on every connection the pool opens (P4 F9, and
`repos/helpers_test.go:36-45` already relies on it). `http_items` rows are written by
`CollectionsRepo` and are never deleted-and-reinserted wholesale the way `tabs` are — `Delete` is a
real user action. So `item_id TEXT REFERENCES http_items(id) ON DELETE CASCADE` means deleting a
saved request (or the folder or collection above it, both already cascading) takes its history with
it, in one statement, with no Go-side recursion. **Verified end to end in F8's run.**

### F6 — The three existing history/log caps, and the one thing none of them does
§1.4. Two of them (`filter_history`, `http_variable_history`) bound *count per scope* at 20 with the
same insert-then-trim SQL; the third (`op_log`) bounds *count globally* at 20 000 plus an age cut.
**None bounds bytes**, because none stores a payload larger than a sentence. A response-history
entry's payload is a response body, so a count cap alone bounds the number of rows and says nothing
about the size of the database — which is exactly the growth risk this phase has to answer. D5/D6
add a per-entry byte cap and a global byte budget *on top of* the count cap the repo already knows
how to write, rather than replacing it.

### F7 — *Verified by running it*: window functions and a `DESC` index work on the shipped driver
A throwaway `go test` package against `modernc.org/sqlite` (removed before commit) reported
`sqlite_version = 3.53.3`, accepted `CREATE INDEX … ON h(sent_at DESC)`, and ran the byte-budget
eviction as **one statement**:

```sql
DELETE FROM http_response_history WHERE id NOT IN (
  SELECT id FROM (
    SELECT id, SUM(stored_bytes) OVER (ORDER BY sent_at DESC, rowid DESC
                                       ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running
      FROM http_response_history
  ) WHERE running <= ?
)
```

Seeded with three 100-byte rows and a 250-byte budget it deleted exactly one — the oldest — and left
the two newest. So D6's budget needs no Go-side loop, no read-then-delete round trip, and no second
statement.

### F8 — *Verified by running it*: a `GENERATED ALWAYS AS … VIRTUAL` scope key is indexable, and the planner uses it
Same throwaway package. `scope_key TEXT GENERATED ALWAYS AS (COALESCE(item_id, 'tab:' || tab_id)) VIRTUAL`
was accepted, `CREATE INDEX h_scope ON h(scope_key, sent_at)` was accepted, and
`EXPLAIN QUERY PLAN SELECT id FROM h WHERE scope_key = 'tab:t1' ORDER BY sent_at DESC` reported
`SEARCH h USING INDEX h_scope (scope_key=?)` — an index search, not a scan. The same run also
confirmed both properties D3/D14 depend on: a bare `UPDATE h SET item_id = 'i1' WHERE item_id IS NULL AND tab_id = 't1'`
moved three rows' scope with **no second write**, and `DELETE FROM items WHERE id='i1'` then
cascaded all three away.

This matters because the scope of a history entry is *"the saved request, or — when there is none —
the tab"*, and expressing that as a stored column would mean two writers that can disagree, while
expressing it as a raw `COALESCE(...)` in each `WHERE` would defeat the index (P52 §5.4 also
forbids per-call-shape SQL, so two `WHERE` variants are out on their own terms).

### F9 — There are **two** truncations to keep apart, and conflating them misreports
`client.go:36` — `maxResponseBytes = 10 MiB`; over it, `data` is cut and `BodyTruncated: true`
(`:314-318`), which `ResponsePane.vue:108-110` renders as *"Response truncated … the server sent
more than that"*. That is a statement about the **transfer**. D5 adds a second, smaller cap on what
a history entry **stores**. An entry whose body was stored short must not claim the server sent
more than it did, and an entry whose transfer was truncated must keep saying so even if what was
stored fits. Two independent booleans, two different sentences.

### F10 — A base64 body costs the most and shows the least
`client.go:321-326`: a body failing `utf8.Valid` comes back base64-encoded, i.e. **4/3 of its
bytes**. `ResponsePane.vue:122-124` then refuses to render it at all — *"{{ bodyBytes }} bytes of
binary data"* — because P2 D4 deliberately deferred rendering to P9's raw inspector. So storing a
binary body would inflate the single largest payload class by a third in exchange for a view that
still says *"N bytes of binary data"*. D5 stores the metadata and not the bytes, and says so.

### F11 — *Verified safe*: widening a persisted enum is a two-character change
`httpResponsePaneSchema` (`http.ts:172-173`) is `z.enum(['body','headers'])`, used at `:211` as
`httpResponsePaneSchema.default('body')`. Adding `'history'` cannot break a restored tab: every
stored value is still a member, and `state/tabKinds.ts`'s `parseState` merge-normalises the rest.
The reverse direction (a tab saved with `'history'` opened by an older build) is not a case this
app has — it has never shipped.

### F12 — *Verified safe*: `tests/ui`'s one-snapshot-per-channel limit does not bite this phase
`mockRuntime.ts:386` is still `const snap = list.length === 1 ? list[0] : findSnapWithRefreshFallback(callArgs)`
— P2 §8 OQ-8's limitation, unfixed, and P2 predicted it *"will not be [fine] for … history"*. It
turns out not to bite, because history does not arrive through a second `httpSend`: a spec seeds
`historyList`/`historyGet` snapshots directly and never needs two sends in one test. The prediction
was about a design where the renderer replayed sends; D2's Go-side recording sidesteps it.

### F13 — *Verified safe*: no new tab kind, no new op kind, no fourth-vocabulary edit
History renders **inside** the existing `'http-request'` tab and is recorded **inside** the existing
`'http'` op, so `tabKindSchema` / `RENDERABLE_TAB_KINDS` / `TAB_KIND_MODE` / `tabRecordSchema` /
`model.RenderableTabKinds` and `opKindSchema` / `model.opKinds` are all byte-identical after this
phase. `tests/unit/go-ts-vocabulary-parity.spec.ts` needs no edit.

### F14 — The library check for "comparable" has one strong candidate and it costs zero new packages
`@codemirror/merge` **6.12.2**, **MIT** (read from the registry, and from the tarball's own
`LICENSE`). Its five dependencies are `style-mod ^4.1.0`, `@codemirror/view ^6.17.0`,
`@codemirror/state ^6.0.0`, `@codemirror/language ^6.0.0`, `@lezer/highlight ^1.0.0` — and **every
one is already resolved in `bun.lock` at a satisfying version**: `@codemirror/view` 6.43.10,
`@codemirror/state` 6.7.2, `@codemirror/language` 6.12.4, `@lezer/highlight` 1.2.3 are direct
devDependencies (`package.json:38-48`), and `style-mod` 4.1.3 is already there as a transitive dep
of both `@codemirror/view` and `@codemirror/language` (`bun.lock:95`, `:101`, `:625`). So adding it
adds **one** package to `node_modules`, not a subtree.

Its dist is 71 734 bytes of unminified ESM, and it exports both the UI (`MergeView`,
`unifiedMergeView`) and the algorithm on its own (`diff`, `presentableDiff`, `Chunk`, `getChunks`).
The README's own read-only recipe is `EditorView.editable.of(false)` + `EditorState.readOnly.of(true)`
on a side's `extensions`.

### F15 — The lazy-chunk entry-file shape is established, so Compare costs no launch bytes
`docs/ARCHITECTURE.md:28` records three existing lazy chunks reached through one-line entry files:
`views/console/sqlFormatterEntry.ts` (`sql-formatter`, ~37 KB gzip),
`views/grid/fakeData/fakerEntry.ts` and `http/dynamic/fakerEntry.ts` (faker's `en` locale, ~155 KB
gzip shared), and `http/dynamic/generators.ts` (~0.8 KB gzip). The pattern is a module whose only
export is `await import('…')`, called on first use. A diff view opened by an explicit **Compare**
click is exactly that shape.

### F16 — The import rules decide every placement question in this phase
`biome.json:124-147` forbids `http/** → project/**` and `http/** → views/**`. `biome.json:66-103`
forbids `views/** → workbench/**` and `views/<kind>/** → views/<other kind>/**`. It does **not**
forbid `views/** → http/**`, and `HttpRequestView.vue:5-9` already imports four modules from
`http/`. So:

- the history store, the History list and the diff dialog all belong in **`views/httprequest/`** —
  they are part of the response viewer, are mounted from inside it (never from `App.vue`), and being
  there is what lets them use `editor/`, `theme/primitives/` and `beautify.ts`;
- the one thing that must live in `http/` is D14's `Adopt` call, because it belongs to the Save-as
  flow that `http/state/collections.ts` already owns.

That is the mirror image of P4's own placement: `SaveRequestDialog.vue` is in `http/` because
`App.vue` mounts it, and `App.vue` is workbench-level.

### F17 — *Verified safe*: every surface this phase draws already has its primitive
`SegmentedControl` (the third pane option), `MessageStrip` (the viewing band, the two truncation
notices), `EmptyState` (no history yet), `IconButton` (per-row delete, the compare trigger),
`AppButton`, `DialogFrame` (`title`/`width`/`maxHeight`/`testId`, `DialogFrame.vue:13-22`),
`.p-chip`'s `ok`/`warn`/`err`/`info` variants (`primitives.css`), `formatBytes` (`format.ts:8-12`),
`statusClass`/`statusHint`/`httpMethodClass` (`http.ts:270-307`). `@vscode/codicons` ships
`history.svg`, `diff.svg`, `git-compare.svg` and `compare-changes.svg`, so the two new icons need no
asset work. **No `theme/primitives/` addition.**

### F18 — `main.go` already has the startup-prune slot D7 needs
`main.go:140` is `oplogWiring := oplog.New(router.Host(), repositories.Ops, settings.Advanced.OpLogRetentionDays)`,
whose `Start()` prunes once before consuming events (`oplog/wire.go:85-90`). A one-line
`repositories.ResponseHistory.SweepOrphans()` beside it is the same kind of once-per-launch
maintenance in the same place, with no new goroutine, hook or lifecycle.

### F19 — `PopoverPanel` is the wrong shape for this list, and `DialogFrame` is the right one for the diff
`PopoverPanel.vue:14-21` is anchored, 240 px wide by default, and every consumer wraps a short menu
(P5's `VariableHistoryMenu.vue` is 280 px with a `max-height: 320px`). A response-history list wants
one row per entry with a method chip, a status chip, a time, a duration and a size, plus a
two-of-N selection — that is a pane, not a popover. Conversely a side-by-side body diff needs the
width and the scrim `DialogFrame` gives (P4's `SaveRequestDialog`, `ConnectionDialog`,
`SettingsDialog` are its three existing consumers).

---

## 3. Checked, and not fired

- **No `internal/httpclient` change.** F1.
- **No new tab kind and no new op kind**, so none of the six vocabularies and neither parity test
  moves. F13.
- **No `tabs` table change, no `TabsRepo` change, and deliberately no foreign key on `tab_id`.**
  F4 — an FK here is not a missing safeguard, it is a bug.
- **No second bound call per send, and no renderer-side recording.** F2.
- **No `op_log` widening and no second Operations-panel row.** The exchange is already one `http`
  op; a history entry is a *result* of that op, not a second operation. `op.SetCommand` keeps
  saying exactly what it says today.
- **No new Advanced setting.** D6 — `internal/logging/sweep.go:12-15` already set the precedent of
  declining exactly this (*"a fixed constant, not `advanced.opLogRetentionDays` — that setting is
  documented as the op log's own"*), and a leaf costs a TS schema entry, a Go model field, a patch
  field, a validator, a `SettingsDialog` row and a reset button.
- **No `beautify.ts`, `editor/languages.ts` or `CodeMirrorHost.vue` change.** A history entry's
  Pretty rendering is the *same* `scanJson`/`scanXml` → `beautifyJson`/`beautifyXml` path
  `ResponsePane.vue:33-75` already runs; the diff dialog mounts a `MergeView` directly rather than
  widening the single-document `CodeMirrorHost` for one caller (which would mean two docs, two
  language compartments and a `readOnly` compartment per side inside a component whose entire
  contract is one document).
- **No `layoutSchema` change and no fourth workbench panel.** The History list lives inside the
  response pane, under the splitter that already exists (P2 D12/F18).
- **No `theme/primitives/` addition.** F17.
- **No `menutemplate.go` change, no accelerator, no palette entry.** History is reached from the
  response pane the user is already looking at; P1 §8 OQ-3 / P2 §8 OQ-7 stay open, unchanged.
- **No `mockRuntime.ts` `findSnap` change.** F12 — P2 OQ-8's predicted forcing function does not
  materialise here.
- **No `NOTICES.md` change.** That file is scoped to *bundled icon assets* (`NOTICES.md:1-3`);
  `@codemirror/merge` is MIT code, in the same family as the six CodeMirror packages already listed
  in `package.json` and not in `NOTICES.md`.

---

## 4. Decisions

### D1 — The library check, stated rather than asserted
`AGENTS.md` requires reaching for a maintained library first and **naming the requirement** when
declining one. Two questions here, one answered yes and one no.

- **A text-diff / merge view for "comparable against each other": `@codemirror/merge` (MIT),
  adopted.** The requirement is a *readable* comparison of two response bodies that are commonly
  JSON, commonly thousands of lines pretty-printed, and always read-only — i.e. line alignment,
  intra-line change highlighting, collapsing of unchanged regions, and syntax highlighting on both
  sides. Hand-rolling that means a diff algorithm *and* a two-editor scroll-locked view *and*
  gutter/chunk rendering; F13 confirms none of it exists in the repo. F14 confirms the library is
  MIT, actively released, from the same maintainer as the six `@codemirror/*` packages this app
  already ships, and adds **one** package to `node_modules` because all five of its dependencies are
  already resolved. Declining it would mean writing several hundred lines to be worse at a solved
  problem — the opposite of the rule.
- **A standalone diff library** (`diff`/jsdiff, `fast-diff`, `diff-match-patch`) — declined, on
  placement rather than merit. Any of them would give the algorithm and none of them the view, so
  the merge view would still have to be written; and `@codemirror/merge` already exports `diff` and
  `presentableDiff` on their own, so adopting it gives the algorithm too (D12 uses it for the
  headers table, with no second dependency).
- **A Go-side diff** — no subject. Both documents are already in the renderer when the user presses
  Compare; sending them to Go to be diffed and back would be two round trips for a computation the
  webview does locally.
- **A JSON pretty-printer / a syntax highlighter** — no subject. `beautifyJson`/`beautifyXml` and
  `@codemirror/lang-json`/`lang-xml` are already in the tree and already used by this exact pane
  (P2 D1/F13, P3).
- **A Go SQLite helper for the eviction** — no subject. F7 ran the byte-budget eviction as one
  statement on the driver this app ships.

### D2 — An entry is recorded in Go, inside the existing op, from `args` and never from `resolved`
`bridge/http.go`'s `Send` closure gains exactly one call, placed after the second `op.SetCommand`
and before `return resp, nil`:

```go
if err := s.Deps.Repos.ResponseHistory.Record(model.ResponseHistoryRecord{
    ItemID:        args.ItemID,        // "" for a scratch tab
    TabID:         args.TabID,
    EnvironmentID: args.EnvironmentID, // resolved to a *name* by the repo, at record time
    Method:        args.Method,
    URL:           args.URL,           // F3: stage 1. NEVER the ResolveRequest output.
    Headers:       args.Headers,       // F3
    Body:          args.Body,          // F3
    Response:      resp,
}); err != nil {
    slog.Warn("recording response history failed", "scope", "bridge/http", "opId", args.OpID, "err", err)
}
```

Four properties, each deliberate:

- **`args`, not `resolved`** (F3). What is stored is therefore *"what this app was asked to send"*
  with every dynamic value and every non-secret variable already substituted, and every **secret**
  still spelled `{{name}}`. That is precisely what P6 §8 OQ-6 asked for — it wanted the generated
  `{{$guid}}` knowable after the fact, and it is — and it is the only version of the request that
  can be persisted without undoing P5's schema.
- **Best-effort.** A failed insert logs and the send still returns its response. A history feature
  must never be the reason a user loses the answer they were waiting for. The converse — a failed
  send — records nothing, because an entry *is* a response (the SPEC's own noun) and there is no
  response; the failure is already an `error` row in `op_log` with its command and message.
- **Inside the op closure, not after `RunOp` returns.** A cancelled or timed-out send never reaches
  the line at all, so a cancel cannot leave a half-entry, and the write is inside the same
  cancellable context the rest of the send runs under.
- **`HttpSendArgs` gains one field, `ItemID`**, supplied by `state.ts`'s `send()` as
  `tab.state.itemId ?? ''` — the tab already knows it (`http.ts:208`), and `collectionIdFor` already
  reads the same field for P5's own scope. No new lookup, no new store.

**One honest consequence, stated rather than discovered:** a user who types a credential *literally*
into a header (rather than through a secret variable) persists it here — but that same literal is
already in `tabs.state_json` and, if saved, in `http_items.request_json`, both plaintext. History
adds no new exposure for a literal; it would have added a large new one for a secret, which is why
F3 is load-bearing. §8 OQ-6 records the one place this genuinely is new: a **response body** that
contains a token is now persisted, which is what every comparable tool does and is stated so it is
a decision.

### D3 — The exact SQLite schema
`migrations/0008_p8_response_history.sql`, with `embed.go`'s `names` gaining
`{8, "p8_response_history", "0008_p8_response_history.sql"}`:

```sql
-- P8 D3: one row per response actually received (docs/v1.2/SPEC.md's P8 row). The request half is
-- stored in its STAGE-1 form -- {{$dynamic}} and non-secret {{name}} substituted, a secret still
-- spelled {{name}} -- which is the same line op_log.command already draws (bridge/http.go, P5
-- D6/F3): a secret's plaintext lives in http_variables.secret_value and nowhere else.
CREATE TABLE http_response_history (
  id            TEXT PRIMARY KEY,
  -- The saved request this belongs to, or NULL for a scratch tab's own history. Cascades for real:
  -- db.go's DSN sets _foreign_keys=1 on every connection (P4 F9), so deleting a request -- or the
  -- folder or collection above it -- takes its history with it in one statement.
  item_id       TEXT REFERENCES http_items(id) ON DELETE CASCADE,
  -- The tab that sent it. Deliberately NOT a foreign key into `tabs` (F4): TabsRepo.Save deletes
  -- and re-inserts a window's whole tab set on a 1 s debounce that fires on every keystroke in the
  -- URL field, so ON DELETE CASCADE here would erase a scratch tab's history a second after the
  -- user typed. SweepOrphans() at startup is the bound instead (D7).
  tab_id        TEXT NOT NULL,
  -- The one axis List/trim/Clear key on: the saved request when there is one, else the tab.
  -- GENERATED rather than written, so it cannot disagree with its two sources and so Adopt (D14)
  -- is a single UPDATE of item_id. Verified indexable, and used by the planner, on
  -- modernc.org/sqlite 3.53.3 (F8).
  scope_key     TEXT GENERATED ALWAYS AS (COALESCE(item_id, 'tab:' || tab_id)) VIRTUAL,
  sent_at       TEXT NOT NULL,
  -- Denormalized out of snapshot_json so the list renders without reading a single body (the same
  -- reason http_items carries method/url). `environment` is the environment's NAME at send time,
  -- not its id: a frozen name still reads correctly after the environment is deleted, which is
  -- exactly when the user wants to know which one it was. '' when none was active.
  method        TEXT NOT NULL,
  url           TEXT NOT NULL,
  environment   TEXT NOT NULL DEFAULT '',
  status        INTEGER NOT NULL,
  status_text   TEXT NOT NULL,
  elapsed_ms    INTEGER NOT NULL,
  -- What the server sent (httpclient.Response.BodyBytes) vs. what this row actually costs. The
  -- second is the byte budget's unit (D6) and is len(snapshot_json), not a body length.
  body_bytes    INTEGER NOT NULL,
  stored_bytes  INTEGER NOT NULL,
  -- model.ResponseHistorySnapshot: the stage-1 request, the full response, and the two storage
  -- flags. Last column, and List never selects it -- SQLite stores columns in declaration order
  -- and spills the tail into overflow pages (P4 D2's own projection reasoning).
  snapshot_json TEXT NOT NULL
);

CREATE INDEX http_response_history_scope ON http_response_history(scope_key, sent_at);
CREATE INDEX http_response_history_age   ON http_response_history(sent_at);
CREATE INDEX http_response_history_tab   ON http_response_history(tab_id);
```

Five choices, each with its reason:

- **One table, not one-per-scope and not a column on `http_items`.** An entry is an event with its
  own lifetime; a column would hold one, and the SPEC asks for *"not just the most recent"*.
- **`item_id` nullable rather than a synthetic "scratch collection".** Matches how
  `connection_id` is nullable on `tabs` and how `http_variables` uses two nullable owners, and it is
  what lets D14's adoption be one `UPDATE`.
- **A generated `scope_key` rather than two `WHERE` shapes or a stored column.** F8. A stored column
  needs two writers to agree forever; two `WHERE` shapes are per-call-shape SQL (P52 §5.4) *and*
  defeat the index.
- **`http_response_history_age`** exists for D6's global sweep, which orders by `sent_at` across
  every scope; **`http_response_history_tab`** exists for D7's orphan sweep and D14's adoption,
  both of which key on the tab alone.
- **No `UNIQUE` anywhere.** Two identical sends a second apart are two entries; that is the feature.

### D4 — `ResponseHistoryRepo`, and where each rule lives
`repos/response_history.go`, `repos.Repos` gaining `ResponseHistory *ResponseHistoryRepo` and one
line in `New` (**no prepared statement** — a send is human-paced, not per-keystroke, so it does not
belong in `New`'s hot-statement set, the same judgement `CollectionsRepo` already made).

| Method | What it does |
|---|---|
| `Record(model.ResponseHistoryRecord) error` | **the whole storage policy**, in one transaction: resolve the environment name, apply D5's two body rules, marshal, insert, per-scope trim, global byte sweep |
| `List(scopeKey string) ([]model.ResponseHistoryEntry, error)` | the summary projection (every column but `snapshot_json`), `ORDER BY sent_at DESC, rowid DESC` |
| `Get(id string) (model.ResponseHistorySnapshot, error)` | the row's `snapshot_json` decoded, with the summary rebuilt from the columns rather than duplicated in the blob |
| `Delete(id string) error` | one row |
| `Clear(scopeKey string) error` | one scope |
| `Adopt(tabID, itemID string) (int, error)` | D14 — one `UPDATE`, scope follows via the generated column (F8) |
| `SweepOrphans() error` | D7 — one `DELETE`, called once at launch |

The caps are the repo's because they are properties of the table (§0.3); `bridge/` hands over a raw
request and a raw response and knows nothing about bytes. `Record` is the only writer, so the three
caps cannot be bypassed by a future caller.

`model.ResponseHistoryRecord.Validate` checks what SQL cannot — a non-empty `TabID`, a `Method`, a
`Status` in `100..599` — refusing on write (`repos/tabs.go:84-88`'s posture); a `snapshot_json` that
will not decode is **dropped and logged** on read (`repos/saved_queries.go:23-69`'s posture), so one
corrupt row never blanks a request's whole history.

### D5 — What an entry stores of the body: two rules, both about the biggest thing in it
**Rule 1 — a per-entry storage cap, `maxHistoryBodyBytes = 256 KiB`.** A body longer than that is
stored truncated at the cap, with `bodyStorageTruncated: true`, and the viewer says so in its own
`MessageStrip` — separate from, and additional to, `bodyTruncated`'s transfer message (F9).

Why 256 KiB rather than reusing the 10 MiB transfer cap: the two caps answer different questions.
`maxResponseBytes` asks *"how much can the viewer be asked to render once?"*; this one asks *"how
much is it worth keeping twenty copies of, per request, forever?"* A JSON API response is
overwhelmingly a few KB; 256 KiB keeps essentially every one of them whole while bounding a single
entry at 1/40th of what a transfer may be. The stated cost: a genuinely large document (a 3 MB
export endpoint) is browsable live and *excerpted* in history. That is the honest trade, and it is
visible in the UI rather than silent.

**Rule 2 — a binary body is not stored at all.** When `Response.BodyEncoding == "base64"`, the
entry keeps every field except the body: `bodyStored: false`, `body: ""`, and `bodyBytes` intact so
the list and the entry still read *"412 KB · binary"*. F10 is the whole argument — base64 inflates
the single largest payload class by a third, and `ResponsePane.vue:122-124` refuses to render it
anyway, so the bytes would cost the most and show the least. §8 OQ-2 hands it to P9, which is the
phase that could actually render them and therefore the phase where storing them starts to earn its
keep.

**What is always stored**, regardless of both rules: status, status text, proto, **all** response
headers, `bodyBytes`, `bodyTruncated`, `elapsedMs`, `finalUrl`, every redirect hop, and the whole
stage-1 request (method, URL, headers, body wire). Those are small, and they are what makes an
entry interpretable and comparable even when its body was not kept. A request body is capped by the
same 256 KiB rule for the same reason, with the same flag.

### D6 — Three caps, because three different things can grow
`filter_history` and `http_variable_history` each bound one thing with one cap (F6). A response
history can grow along three independent axes, so it takes three:

| Cap | Value | What it bounds | Why the others do not |
|---|---|---|---|
| per-entry body cap (D5) | 256 KiB, ×2 (request + response) | **one entry** | without it a single 10 MiB response is 10 MiB of database |
| per-scope count cap | `historyPerScopeLimit = 20` | **one request's** history | without it a request polled in a loop grows forever; this is also the number the user *experiences* ("the last twenty responses") |
| global byte budget | `historyByteBudget = 128 MiB` | **the table**, across every request and tab | the first two together still leave growth proportional to the number of requests that have ever been sent |

**The arithmetic, stated so the numbers are chosen rather than drifted into.** With the first two
alone, a workspace of 200 saved requests each holding 20 entries of 256 KiB is ~1 GB — bounded in
form but not in any useful sense. The budget makes the ceiling absolute: the table can never exceed
128 MiB regardless of how many requests exist, and the realistic case (JSON responses of a few KB)
sits three orders of magnitude below it. 128 MiB is the same order as the L2 row cache's own budget
(`cache.l2BudgetMb`, default 64, max 1024) — a deliberate echo, so the app's two largest
self-managed stores are sized on the same scale.

The budget evicts **oldest-first across every scope**, which is the honest global policy: the thing
being reclaimed is disk, and the least valuable byte is the oldest one, wherever it lives. A request
you have not touched in a month loses its history before today's does.

**No time-based expiry, deliberately.** `op_log` has one because it is a *log* — rows accumulate
from machinery (every grid scroll, every metadata fetch), and old ones are noise. A response history
is a *result the user asked for*; a two-month-old response is not noise, it is the thing you came
back for. The budget already bounds growth, and adding a fourth mechanism would bound it twice for
one gain.

**No Advanced setting for any of the three** (§3, `internal/logging/sweep.go:12-15`'s precedent).
§8 OQ-1 records the shape one would take.

**When the trims run: in `Record`'s own transaction, on every insert.** `op_log` amortises its prune
over 500 completed ops (`oplog/wire.go:46`) because it is written by machinery at machine pace. A
response history row is written **once per human pressing Send**, at most a handful per second, so
two extra indexed statements per insert cost nothing measurable and remove an entire class of
question — a counter to keep, a cadence to tune, a startup hook to remember, and a window in which
the table is over budget. The two statements, both single-shot (F7 ran the second):

```sql
-- per-scope count cap, the exact shape filter_history.go:62-73 and variables.go:425-433 use
DELETE FROM http_response_history
 WHERE scope_key = ?
   AND id NOT IN (SELECT id FROM http_response_history
                   WHERE scope_key = ?
                   ORDER BY sent_at DESC, rowid DESC LIMIT ?);

-- global byte budget, oldest-first across every scope (F7)
DELETE FROM http_response_history WHERE id NOT IN (
  SELECT id FROM (
    SELECT id, SUM(stored_bytes) OVER (ORDER BY sent_at DESC, rowid DESC
                                       ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS running
      FROM http_response_history
  ) WHERE running <= ?);
```

The per-entry cap is what makes the second statement safe: no single row can exceed the budget, so
the just-inserted row is never itself evicted.

### D7 — A scratch tab's history lives as long as its tab, and is swept at launch
F4 rules out the foreign key that would express this declaratively, so it is expressed as one
statement run once per launch, beside `oplog`'s own startup prune (F18):

```sql
DELETE FROM http_response_history
 WHERE item_id IS NULL AND tab_id NOT IN (SELECT id FROM tabs);
```

`tabs` is the liveness oracle, and it is the right one: a tab that is open is a row in that table
(`TabsRepo.Save` rewrites the set but always re-inserts what is open), and a tab that was closed is
not. So the semantics are exactly *"a scratch request's history lives as long as the tab does"*,
which is the same lifetime the response itself has today (`registerTabRuntimeCleanup`, §1.1) — the
only difference is that it now survives a quit-and-relaunch.

Running it at launch rather than on tab close is deliberate: `closeTab` is renderer-side and
fire-and-forget, and a bound call on it would be one more thing that can fail silently at the worst
moment (during a quit). The residue — a long session that opens and closes many scratch tabs keeps
their rows until the next launch — is bounded by D6's budget regardless, and is §8 OQ-8.

### D8 — One bound service, five methods, no op-log row
`bridge/responsehistory.go` is `ResponseHistoryService{Deps appcore.Deps}` — the `CollectionsService`
shape (`bridge/collections.go:32`): a typed-struct wrapper per method with an explicit guard and an
`ipcerr` translation.

| Method | Args | Returns |
|---|---|---|
| `List` | `{itemId, tabId}` | `[]model.ResponseHistoryEntry` — newest first, ≤ 20 by construction |
| `Get` | `{id}` | `model.ResponseHistorySnapshot` |
| `Delete` | `{id}` | `void` |
| `Clear` | `{itemId, tabId}` | `void` |
| `Adopt` | `{tabId, itemId}` | `{adopted int}` |

`List`/`Clear` take **both** ids and the service computes the scope key the same way the generated
column does (`itemId` when non-empty, else `"tab:"+tabId`) — one function, one place, so the Go side
and SQLite cannot disagree about what a scope is.

**No op kind and no op-log row**, for P4 D11's reasons applied unchanged: the ring-and-Stop
machinery `docs/ARCHITECTURE.md:71`'s ~150 ms invariant refers to is `ViewChrome` +
`useRunState(tabId)`, and every one of these calls is a single indexed local read or a single-row
write that the pane renders into directly. Recording, separately, is not its own op because it is
part of the `http` op that already exists (D2).

### D9 — The wire shapes live in Go and are mirrored, not re-validated
`packages/shared/domain/response-history.ts`, `trust<T>()`d by `control.ts` exactly as every other
bound call is (P2 D5, `control.ts:112`'s `trust<T>`):

```ts
interface ResponseHistoryEntry {           // the list row; no body, ever
  id: string; itemId: string | null; tabId: string; sentAt: string;
  method: string; url: string; environment: string;
  status: number; statusText: string;
  elapsedMs: number; bodyBytes: number; storedBytes: number;
}

interface ResponseHistorySnapshot {
  entry: ResponseHistoryEntry;                                  // rebuilt from the columns
  request: { method: string; url: string;
             headers: HttpHeaderWire[]; body: HttpBodyWire };   // stage 1 (D2/F3)
  response: HttpResponseWire;                                   // the P2 shape, unchanged (F1)
  bodyStored: boolean;                                          // false for a binary body (D5)
  bodyStorageTruncated: boolean;                                // D5 rule 1, NOT bodyTruncated (F9)
  requestBodyStorageTruncated: boolean;
}
```

`response` being the **unmodified** `HttpResponseWire` is what makes D10's one-line source swap
possible; the three storage flags sit in the envelope beside it rather than inside it, precisely so
the response type stays the type `ResponsePane.vue` already renders.

### D10 — Browsing: a third pane, and a swapped source — no second viewer
`httpResponsePaneSchema` widens to `z.enum(['body','headers','history'])` (F11), so the response
pane's existing `SegmentedControl` becomes **Body · Headers · History** and the choice persists the
same way it does today.

**The source swap is the whole of the rendering change.** `ResponsePane.vue:17` becomes:

```ts
const viewing = computed(() => historyRuntime[props.tab.id]?.viewing ?? null);
const response = computed(() => viewing.value?.snapshot.response ?? rt.value?.response ?? null);
```

Every consumer below — the status chip, the hint, the elapsed and byte figures, the redirect
caption, the truncation strip, the headers list, the binary note, `prettyFormat`, `bodyText`, the
Pretty · Raw toggle — is unchanged, because F10 established they all read only that one object. This
is what the SPEC's *"a saved snapshot of exactly what P2's response viewer already renders"* buys
when it is taken literally.

Three additions around it:

- **A viewing band.** While `viewing` is non-null, a `MessageStrip tone="info"` above the panes reads
  *"Viewing the response from 14:32:07 · GET /v2/orders"* with a **Back to latest** action (or
  **Close** when there is no live response, e.g. a restored tab). Without it, an old response
  rendered in the live pane is indistinguishable from a new one — the single worst failure this
  feature can have.
- **Two storage notices**, beside the existing transfer one (F9): *"Only the first 256 KB of this
  response was kept in history"* (`bodyStorageTruncated`) and *"This response's body was binary and
  was not kept — 412 KB"* (`!bodyStored`).
- **The pane's structure moves out from under `v-if="response"`.** Today the whole toolbar row and
  both panes are inside it (`:84`), so a tab with no live response renders only the empty state. It
  becomes `v-if="response || hasHistory"`, with the empty state moving inside the Body branch —
  which is what lets a **restored** tab show its history at all.

**A restored tab does not auto-load its latest entry.** It shows the empty state with one extra
line — *"12 past responses · View history"* — rather than silently rendering an old response as if
it had just arrived. Same reasoning as the viewing band: the pane must never imply an exchange
happened when it did not.

### D11 — The history runtime store: per tab, in `views/httprequest/`, never persisted
`views/httprequest/history.ts`, on `createRuntimeStore` beside `state.ts`'s own (F16 decides the
directory):

```ts
interface HttpHistoryRuntime {
  entries: ResponseHistoryEntry[] | null;   // null = never loaded; [] = loaded and empty
  loading: boolean;
  stale: boolean;                           // a send happened while the pane was not showing
  viewing: { id: string; snapshot: ResponseHistorySnapshot } | null;
  selected: string[];                       // compare selection, at most two
  error: string | null;
}
```

Runtime rather than tab state, for P2 D6's rule applied consistently: *the response is not
persisted*, and a pointer at a response is not either. What **does** persist is
`tab.state.responsePane === 'history'` — a pane choice, exactly like the two that persist today.
`registerTabRuntimeCleanup` frees the record with the tab, and a stored entry is re-fetchable by id
anyway.

**Refresh policy: eager when the pane is showing, lazy otherwise.** `state.ts`'s `send()` calls one
line after a successful response — `noteSendRecorded(tabId)` — which refetches when
`tab.state.responsePane === 'history'` and otherwise just sets `stale`, so a user who never opens
the pane pays no IPC per send.

### D12 — Comparing: two entries, three levels of difference, one dialog
Selecting exactly two entries in the History list (a checkbox per row, capped at two, defaulting the
first click to the entry under the cursor) enables **Compare**, which opens
`views/httprequest/ResponseDiffDialog.vue` on `DialogFrame` (F19), 900 px wide. It compares **A**
(the older) against **B** (the newer) — fixed by `sentAt` rather than by click order, so the diff's
direction is never a surprise.

Three levels, because a response differs in three ways and a body diff alone answers only one:

1. **A summary row.** Status, elapsed time and size, side by side, each marked changed or unchanged
   — the status through `.p-chip`'s existing `statusClass` variants on both sides. *"200 → 404"* is
   frequently the entire answer, and it should not require reading a body diff to find.
2. **A headers table.** The two ordered `Header[]` lists reduced to added / removed / changed /
   unchanged rows, with unchanged rows collapsed behind a *"N unchanged"* disclosure. Computed with
   `@codemirror/merge`'s own exported `diff` over the two header lists rendered one-per-line — the
   library is already loaded at this point (D13), so this costs no second dependency and no
   hand-rolled LCS.
3. **A body diff**, `MergeView` side-by-side, **both sides read-only**
   (`EditorView.editable.of(false)` + `EditorState.readOnly.of(true)`, F14's own recipe), with
   `@codemirror/lang-json`/`lang-xml` applied per side by the same `prettyFormat` gate
   `ResponsePane.vue` already uses.

**Both bodies are pretty-printed before diffing when both are JSON (or both XML).** This is the one
decision that makes the body diff useful at all: a minified JSON response is a single line, and a
single-line diff of two 40 KB lines tells the user nothing. `beautifyJson(text, 'indented')` is
lossless by construction (P2 F13 — a 19-digit id survives byte-identical, which `JSON.parse` would
not), so pretty-printing to diff does not misrepresent what came back. When the two sides disagree
about format, or neither is JSON/XML, the raw bytes are diffed and the dialog says so in one line.

**Not compared:** a binary body (`!bodyStored` on either side) — the dialog shows the summary and
headers levels and states that the bodies were not kept (D5). **Not offered:** comparing entries
from two different requests (§8 OQ-4) — the dialog is opened from one request's own history list and
takes its two ids from there.

### D13 — `@codemirror/merge` is a lazy chunk, on the established entry-file shape
`views/httprequest/mergeEntry.ts` is one line —
`export const loadMerge = () => import('@codemirror/merge')`, memoised — matching
`views/console/sqlFormatterEntry.ts` and the two `fakerEntry.ts` files (F15). `ResponseDiffDialog.vue`
awaits it on mount and renders a spinner for the one fetch. So the library costs **zero** launch
bytes and is fetched the first time anyone presses Compare, exactly like *SQL Format* and
*Generate data…*.

`docs/ARCHITECTURE.md:28`'s chunk paragraph gains it as a fourth entry, with its measured size (C8),
and `docs/PERF.md` gains no budget — a diff opened by an explicit click is not on any budgeted path.

### D14 — Saving a scratch request takes its history with it
When Save as… turns a scratch tab into a saved one, `http/state/collections.ts` calls
`control.historyAdopt(tabId, itemId)` immediately after the `CreateItem` that produced the id, and
before the tab's `itemId` is patched. The repo side is one statement, and F8 verified that the
generated `scope_key` follows with no second write:

```sql
UPDATE http_response_history SET item_id = ? WHERE item_id IS NULL AND tab_id = ?;
```

Without this, saving a request you have been iterating on for ten minutes silently discards
everything you sent while iterating — the exact moment the history was most useful. `tab_id` is kept
rather than cleared, so the row still records which tab produced it.

The reverse is not implemented: deleting a saved request cascades its history away (D3), and there
is no "orphan it back to the tab" path. Deleting a request is an explicit destructive action on the
request, and its responses are part of the request.

### D15 — The History list: what a row says, and what a row does
`views/httprequest/ResponseHistoryList.vue`, rendered inside the response pane when
`responsePane === 'history'`. Each row, left to right:

`[✓] 14:32:07 · [GET] · [200 OK] · 124 ms · 3.4 KB · Staging`

— the compare checkbox, a relative-then-absolute time (`v-tooltip` carries the full ISO), the method
chip (`httpMethodClass`, `http.ts:305-307`), the status chip (`statusClass`), `elapsedMs`,
`formatBytes(bodyBytes)`, and the environment name when one was active. The URL is shown on a second
line only when it differs from the row above it — within one request's history the URL is usually
identical, and repeating it twenty times is noise that hides the one time it changed.

Row actions: **click** views the entry (D10); a hover **delete** `IconButton`. The pane header
carries **Compare** (enabled at exactly two checked) and **Clear history** (behind the existing
`confirmDialog()`, since it is destructive and unrecoverable).

Empty state: `EmptyState` — *"No past responses yet. Sending this request will record one."* For a
scratch tab it adds one line: *"Scratch requests keep their history until the tab is closed — save
this request to keep it."* That is D7's lifetime stated where the user can act on it, rather than
discovered when it vanishes.

No virtualization: the list is capped at 20 rows by construction (D6), which is why
`VirtualList`/`TreeHost` are not involved.

---

## 5. Implementation order

Eight commits. C1–C3 add capability with nothing mounted (each typechecks and builds on its own);
C4 is the one that makes browsing exist; C5–C6 are additive layers on a working feature; C7–C8 are
the tests and the docs. Per `AGENTS.md`, run the fast checks (`lint`, `typecheck`, `build`) per
commit and the expensive suites once at the end.

### C1 — `feat(shared): the response-history domain`
`packages/shared/domain/response-history.ts` (D9's two mirrors), and `httpResponsePaneSchema` gains
`'history'` (D10/F11). Pure addition — nothing consumes either yet.

### C2 — `feat(storage): a bounded response-history table`
`migrations/0008_p8_response_history.sql` + the `embed.go` entry (D3),
`model/responsehistory.go` (the three types and `Validate`), `repos/response_history.go` (D4's seven
methods, D5's two body rules, D6's three caps), `repos/repos.go`'s one field and one line, and
`repos/response_history_test.go` (§6.2). No caller, no bridge —
`go test ./apps/kira-studio/internal/storage/repos/...` is the whole proof.

### C3 — `feat(bridge): record a response, and read the history back`
`bridge/responsehistory.go` (D8's five methods), `HttpSendArgs.ItemID` and D2's one `Record` call in
`bridge/http.go`, `main.go`'s service registration and the startup `SweepOrphans()` beside
`oplog`'s prune (D7/F18), `control.ts`'s five wrappers, the five `IPC.*` names and five
`FQN_SUFFIX_BY_IPC_KEY` entries plus a `historyList: '[]'` `WILDCARD_DEFAULTS` row (F11's
sibling reasoning — `mode-switch.spec.ts` and both existing `http-request*` specs boot without a
history fixture), and a bindings regeneration via `scripts/setup.sh` (**never** a hand-typed flag
list, `AGENTS.md`'s `-names` warning). After this commit a send records and nothing shows it.

### C4 — `feat(http): browse a request's past responses`
`views/httprequest/history.ts` (D11), `ResponseHistoryList.vue` (D15), `ResponsePane.vue`'s
restructure — the third segment, the source swap, the viewing band, the two storage notices, the
`v-if` move (D10) — `state.ts`'s `itemId` in the send args and its `noteSendRecorded` hook, and the
per-row delete plus Clear history. **The phase's centre**: history is browsable, complete on its own
terms, with no comparison yet.

### C5 — `feat(http): a scratch request's history follows it into a collection`
D14: `control.historyAdopt` called from `http/state/collections.ts`'s Save-as path, and the
adoption reflected in the pane (the list refetches under the new scope). Small and separable — it
touches a different module and has its own failure mode.

### C6 — `feat(http): compare two responses`
`@codemirror/merge` added to `package.json`, `views/httprequest/mergeEntry.ts` (D13),
`ResponseDiffDialog.vue` (D12's three levels), and the list's compare selection wired to it.

### C7 — `test: the response-history pane, browse and compare`
`tests/ui/http-history.spec.ts` (§6.3). `repos/response_history_test.go` already landed with C2,
where its subject did.

### C8 — `docs(architecture): response history, its three caps, and the fourth lazy chunk`
`docs/ARCHITECTURE.md`: the schema block gains `http_response_history` with its generated column and
its two cascade/no-cascade notes; a Storage paragraph stating D2's stage-1 rule, D5's two body rules
and D6's three caps with their arithmetic; a UI-architecture paragraph for the third response pane
and the swapped source; F4's no-FK-on-`tab_id` recorded as a known property with its reason; and the
Stack table's chunk note gains `@codemirror/merge` with its measured gzip size.

---

## 6. Verification

### 6.1 What runs here
`bun run lint`, `bun run typecheck`, `bun run build`, `bun run test:unit`, `bun run test:ui`,
`bun run test:ipc:fe`, plus `go build ./... && go vet ./... && go test ./apps/kira-studio/internal/...`.
`bun run setup` first in a fresh container — **mandatory this phase**: C3 changes `HttpService`'s
args and adds a bound service, so `apps/kira-studio/frontend/bindings/**` must be regenerated or the
Vite build fails on an unresolvable import.

Two bindings checks, both from `AGENTS.md`'s own warnings:

1. the regenerated `responsehistoryservice.ts` must call
   `$Call.ByName("…bridge.ResponseHistoryService.List", …)`, not `$Call.ByID(<n>, …)` — a
   `-names`-less regeneration breaks **every** `tests/ui` spec at the first bound call of boot and
   nothing about the failure points at bindings;
2. `HttpService.Send`'s generated arity is unchanged by adding `ItemID` (it is a field on the args
   struct, not a parameter) — confirm rather than assume, since C3 is the commit that would notice.

Also confirm `bun run build` still reports the **expected** chunk set: three lazy chunks today
(`docs/ARCHITECTURE.md:28`) plus exactly one new one for `@codemirror/merge`, and no growth in
`index-*.js` beyond this phase's own eager code.

### 6.2 The Go test — `repos/response_history_test.go`
It exists because `Record` is **cache eviction with interacting rules** — `AGENTS.md`'s own named
category, and the one place three caps can silently disagree — not because it is a CRUD round trip.
Seven cases, one per rule that is genuinely easy to get wrong:

1. **The per-scope count cap**: 25 recorded against one `item_id` leaves 20, and they are the 20
   newest, in order.
2. **Scope separation**: entries under `item_id = i1`, `item_id = i2` and a scratch `tab_id` are
   three independent scopes with three independent caps — the generated `scope_key` doing its job
   (F8).
3. **The per-entry storage cap**: a 1 MiB body is stored at 256 KiB with `bodyStorageTruncated`
   true, `bodyBytes` still reporting 1 MiB, and `stored_bytes` reflecting what was actually written.
4. **A binary body**: `bodyEncoding: "base64"` stores no body, `bodyStored` false, `bodyBytes`
   intact, and `stored_bytes` small.
5. **The global byte budget**: with the budget shrunk for the test, entries across *two* scopes
   evict oldest-first across both — the property a per-scope cap cannot give (D6).
6. **Cascade and sweep**: deleting an `http_items` row removes its entries (F5), and `SweepOrphans`
   removes a scratch tab's entries once its `tabs` row is gone while leaving a live tab's and every
   item-scoped row alone (F4/D7).
7. **`Adopt`**: a scratch tab's entries move to an item with one `UPDATE`, their scope key follows,
   and a subsequent `List` under the item id returns them.

**Explicitly not tested:** that `List` returns what `Record` inserted, that `Delete` deletes, that
`Get` decodes a snapshot it just wrote, that a missing `tabId` is refused. Each is a CRUD round trip
or a one-condition guard — `AGENTS.md`'s *"everything else gets nothing"*.

### 6.3 The UI spec — `tests/ui/http-history.spec.ts`
`tests/ui` drives the real built bundle in real WebKit with both wire planes mocked. Three tests,
each seeding `historyList` (and `historyGet` where needed) rather than sending twice — F12's whole
point:

1. **Browse.** Open a request tab, switch to **History**, assert three rows with their status chips,
   methods, times and sizes; click the middle one; assert `[data-testid="http-history-band"]` names
   its time, that `[data-testid="http-status"]` now reads *that entry's* status and carries its
   class, and that the body pane shows that entry's body pretty-printed. Click **Back to latest**
   and assert the band is gone.
2. **Restore, and the storage notices.** Seed `IPC.tabsList` with an `http-request` tab and a
   `historyList` carrying one binary entry and one storage-truncated entry. Assert on boot that the
   pane shows the History segment with no live response and no reconnect gate (P2 D6's property,
   still true), that viewing the binary entry renders
   `[data-testid="http-history-binary-note"]` and no editor, and that viewing the truncated one
   renders `[data-testid="http-history-truncated"]` **as well as**, not instead of, the transfer
   strip when both apply (F9).
3. **Compare.** Check two rows, press **Compare**, assert the dialog mounts, that the summary row
   shows `200` against `404` with both chips' classes, that the headers table lists one changed and
   one added header, and that both bodies are present in the merge view with the JSON indented on
   both sides (D12's pretty-print rule — the seeded bodies are minified, so an unindented render is
   a failing assertion, not a cosmetic one).

### 6.4 What only a real Mac and a real database can settle
1. **Growth against a real workspace.** Send a few hundred real requests across several saved
   requests, then measure `kira.sqlite` before and after and compare with D6's arithmetic. The
   budget is argued from the schema, not from a measurement.
2. **The byte budget actually firing.** With `historyByteBudget` temporarily shrunk, confirm the
   window-function `DELETE` evicts oldest-first across scopes on a real database with real bodies
   (F7 ran it on synthetic rows).
3. **A real binary response** (an image endpoint) records metadata only, and the pane says so.
4. **A 10 MiB response** records at 256 KiB with both truncation notices reading correctly.
5. **The launch sweep**: open several scratch tabs, send from each, close some, relaunch, and
   confirm exactly the closed ones' history is gone.
6. **`@codemirror/merge` in the packaged app** — the lazy chunk fetches over the custom URI scheme
   in a real desktop build, not only over `tests/ui`'s static server.
7. **Save as… adoption** end to end, against a real database.

### 6.5 What must not regress
- **Studio renders identically.** Nothing in this phase touches `project/**`, `views/grid/**`,
  `views/console/**`, an adapter, or the data plane.
- **`tests/ui/http-request.spec.ts`, `http-request-body.spec.ts`, `http-curl.spec.ts`,
  `http-variables.spec.ts`, `http-dynamic-values.spec.ts`, `collections.spec.ts` and
  `mode-switch.spec.ts` all pass unedited.** C3's `WILDCARD_DEFAULTS` entry is what makes that true
  for the first six; a spec edit here is a signal the pane restructure changed P2/P3 behaviour.
- **A tab with no history and no response still renders P2's empty state**, unchanged (D10's `v-if`
  move must not turn an empty pane into a chromed one).
- **`bun run test:ipc:fe` passes unedited.** No data-plane frame, adapter or fixture change;
  `git diff` must touch nothing under `internal/adapterhost/`, `internal/adapters/`,
  `internal/page/` or `packages/shared/protocol/`.
- **No file under `http/**` imports `views/**`** and no file under `views/httprequest/**` imports
  another `views/<kind>/**` — `bun run lint` is the check (F16).
- **`op_log` behaviour is byte-identical.** `op.SetCommand` still receives the unresolved URL, both
  times, and no new op kind exists (F13).
- **`docs/PERF.md` gains no budget** — D13.
- **`NOTICES.md` is unchanged** — §3.

---

## 7. Acceptance checklist

Filled in by the implementing session as each item is actually done, not in advance.

- [ ] C1 — `response-history.ts`'s two mirrors; `httpResponsePaneSchema` widened with an existing
      stored `'body'`/`'headers'` value still restoring.
- [ ] C2 — the migration applies on a fresh and an existing database; `Record` enforces all three
      caps and both body rules; `response_history_test.go`'s seven cases green.
- [ ] C3 — `ResponseHistoryService` registered; `Record` called from inside the existing op closure
      with `args`, never `resolved`; `SweepOrphans` runs at launch; bindings regenerated via
      `scripts/setup.sh` with `$Call.ByName` confirmed; the six existing http/collections UI specs
      green with **no spec edits**.
- [ ] C4 — the History segment lists entries; selecting one swaps the whole response pane and shows
      the band; Back to latest restores the live response; a restored tab shows its history with no
      live response; both storage notices render; delete and Clear history work.
- [ ] C5 — Save as… adopts a scratch tab's entries and the list refetches under the new scope.
- [ ] C6 — Compare enables at exactly two; the dialog's three levels render; both bodies are
      pretty-printed before diffing when both are JSON; a binary side degrades to summary+headers
      with a stated reason; the merge chunk is lazy and is not in `index-*.js`.
- [ ] C7 — `tests/ui/http-history.spec.ts`'s three tests, each passing twice in a row.
- [ ] C8 — `docs/ARCHITECTURE.md` updated (schema block, Storage paragraph, UI paragraph, the
      no-FK-on-`tab_id` property, the fourth lazy chunk with its measured size).
- [ ] §6.1's full command set green, including the chunk-count check.
- [ ] §6.4's seven real-hardware steps — run, or recorded as unrunnable here with what was read
      instead, in the same shape P1's own checklist line took.

---

## 8. Open questions, handed forward

**OQ-1 — The three caps are constants, not settings.** D6 fixes 256 KiB / 20 / 128 MiB, following
`internal/logging/sweep.go:12-15`'s own precedent for declining a setting. The shape one would take
is a single `advanced.responseHistoryBudgetMb` leaf (a TS schema entry, a Go model field, a patch
field, a validator, a `SettingsDialog` row and a reset button — six edits), and the honest trigger
for adding it is a real user hitting the ceiling, not a completeness urge. The per-request count of
20 is the one a user is most likely to notice and the least expensive to change.

**OQ-2 — A binary response's bytes are not kept** (D5 rule 2, F10). This is right while the viewer
refuses to render them, and it stops being right the moment **P9's raw inspector** can. When P9
lands, the question is not "store them?" but "store them under what separate budget?" — a 12 MB
image history would exhaust D6's whole budget from one request. The contained shape is a second,
much smaller binary-specific budget, or content-addressed storage outside the row. Named so P9
inherits the question rather than rediscovering the gap.

**OQ-3 — There is no app-wide History list.** Postman's sidebar shows every request ever sent,
across collections, which is a genuinely different affordance ("what was that endpoint I tried on
Tuesday?"). The schema already supports it — drop the `scope_key` filter and order by `sent_at` —
so this is entirely a UI question: where it lives (a fourth left-panel mode? a tab kind?), how it is
searched, and what clicking an entry does when its request no longer exists. Worth doing in P13 or
later, and worth **not** inventing a second surface inside a storage-and-viewer phase.

**OQ-4 — Comparing across requests is not offered.** D12's dialog takes two ids from one request's
own list. Two entries from *different* requests are perfectly comparable on the same three levels
and the store would answer both `Get`s fine; what is missing is a way to *pick* the second one,
which needs OQ-3's global list to exist first. The two should be settled together.

**OQ-5 — Recorded, but not replayable.** P6 §8 OQ-6 asked for "what exactly did that request send"
and D2 delivers it: the stage-1 request is stored, so a `{{$guid}}`'s generated value is readable
after the fact. What is *not* offered is a **Replay** action putting that exact request back on the
wire. It is close — the stored request is already the shape `httpSend` takes — but it needs three
decisions this phase does not have a mandate for: whether a secret (still `{{name}}`) re-resolves
against *today's* value or fails, whether a replay records a new entry (yes, surely) and whether it
overwrites the tab's current builder state or sends behind its back. That is a feature with a real
design, and it is the natural companion to OQ-3.

**OQ-6 — A response body containing a credential is now persisted in plaintext.** F3/D2 keep every
*declared* secret out of the database, which is the property P5 built and the one that would have
been destroyed silently. But a login endpoint's `{"token": "…"}` response body is now stored, in the
clear, in `kira.sqlite` (mode `0600`, in a `0700` directory). Every comparable tool does the same,
and encrypting response bodies under the keychain key would mean a keychain round trip per browse
and would break the byte-budget arithmetic — but this is a decision, not an oversight, and the
mitigations available today are per-entry delete and Clear history (D15). A per-request *"don't keep
responses"* toggle is the contained fix if it is ever wanted; it would live wherever P9/P13 first
build a per-request settings surface (P2 §8 OQ-4 has been waiting for the same surface since P2).

**OQ-7 — The tab strip still has no history or dirty indicator.** P4 §8 OQ-8 asked for a *general*
`dirty(tab)` member on `TabKindDef` rather than a special case, and named P8 as a second wanter. P8
does not want it after all — a history count belongs beside the response, not on a tab — so OQ-8 is
handed on unchanged and with one fewer claimed beneficiary.

**OQ-8 — The orphan sweep runs at launch only** (D7). A long-lived session that opens and closes
many scratch tabs keeps their rows until the next launch. Bounded by D6's budget regardless, so this
is a tidiness question, not a growth one. The contained fix is a bound `historyClear` on the tab's
own close path, which is one more thing that can fail during a quit — deliberately not built.

**OQ-9 — A stored response cannot be saved to a file.** *"Save response as…"* is the obvious next
ask once responses persist, and it is blocked on the same missing primitive P3 §8 OQ-3 and P4 §1.4
both recorded: there is no general *"Go, write these bytes to this path"* bound method (`ChooseSave`
has exactly one caller, and it hands its path to the **adapter data plane**). Three phases have now
wanted it; whichever needs it next should build it rather than route around it again.

---

### Critical files for implementation

- `/home/user/kira-studio/apps/kira-studio/internal/bridge/http.go`
- `/home/user/kira-studio/apps/kira-studio/internal/storage/repos/filter_history.go`
- `/home/user/kira-studio/apps/kira-studio/internal/storage/repos/variables.go`
- `/home/user/kira-studio/apps/kira-studio/internal/storage/repos/ops.go`
- `/home/user/kira-studio/apps/kira-studio/internal/storage/migrations/0007_p5_variables.sql`
- `/home/user/kira-studio/apps/kira-studio/frontend/src/views/httprequest/ResponsePane.vue`
- `/home/user/kira-studio/apps/kira-studio/frontend/src/views/httprequest/state.ts`
- `/home/user/kira-studio/apps/kira-studio/frontend/src/state/tabs.ts`
