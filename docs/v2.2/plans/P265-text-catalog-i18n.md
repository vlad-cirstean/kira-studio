# P265 plan: text catalog, copy unification and i18n

Ask (SPEC row P265, requirements line, user follow-ups): audit every user-visible string of both apps
(mobile included) and every package; one glossary and style rules; ALL user-visible text in ONE
message catalog file so wording is chosen with every other wording in view; vue-i18n wired so a
locale can be added later (English only ships); lint guards against literal text and missing keys;
a duplicate/near-duplicate wording checker; text-asserting specs updated, testids stable. Every
decision below is final; no sign-off list.

Base: `v2.0` at `48558ea9b` (P264 close-out). Builds on P262/P263 looks (guards U1-U38), P264
behaviour (U39-U63, `behaviour/format.ts`, confirm store, `QueryState`, live region).

Steps, strictly in order:

1. **F0** (one Sonnet, main checkout): dependencies, config, catalog skeleton (§3.1).
2. **F1, F2, F3** (three Sonnets, three worktrees, concurrent): runtime, foundation catalog
   content, guards (§3.2). Zero file overlap.
3. **F4** (one Sonnet, main checkout, after F1-F3 land): foundation-owned UI and Go migration,
   repo-wide mechanical edits, stream allowlists, docs (§3.3).
4. **Streams A, B, C** (three Sonnets, three worktrees off the F4 tip, concurrent): replace literals
   with keys, chunk by chunk; write every planned spec (§4).
5. **Landing** (§5.6), then **test and fix** (one serial Sonnet: all suites, baselines, §5.5), then
   **close-out** (§5.7).

Method: 8 `codegraph_explore` calls (createApp/mount sites; `runText`/`scheduleText`/`VarText`/
`format.ts`/`errorText`; Go menu builders and notification titles; `internal/shell/menu.go`;
confirm store, `ConfirmDialogView`, `QueryState`, live region, `copyAnnounced`; `SHORTCUTS` and
`CommandPalette`; `bootstrapShell`, `reviewDecorations`, mobile `main.ts`), then a scratch inventory
script (template text nodes, static and bound text attributes, mustache literals, TS text-property
literals, text sinks) over `S/` `apps/kira-studio/frontend/src`, `K/` `apps/kira-space/frontend/src`,
`M/` `apps/kira-space/frontend/mobile`, `p/workbench/src` (`Wm` = `memory/`, `W` = rest),
`p/git-ui/src` (G), `p/docker-ui/src` (D), `p/kira-ui/src` (U), `p/theme/src` (T), `p/shared` (X).
Counts are heuristic (an enum literal such as `'idle'` can count; template text split by an element
counts per fragment); the guard in §3.2 F3 is the authoritative inventory.

## 1. Inventory

### 1.1 Frontend text sites

| Area | Template text | Static text attrs | Bound/mustache literals | TS text literals | Sites | Files |
|---|---|---|---|---|---|---|
| S Studio | 516 | 242 | 128 | 572 | 1458 | 147 |
| K Space | 350 | 127 | 71 | 159 | 707 | 119 |
| M mobile | 38 | 10 | 3 | 21 | 72 | 13 |
| Wm memory | 54 | 7 | 16 | 2 | 79 | 12 |
| W workbench (rest) | 131 | 39 | 27 | 74 | 271 | 52 |
| G git-ui | 294 | 93 | 30 | 82 | 499 | 57 |
| D docker-ui | 91 | 104 | 28 | 56 | 279 | 29 |
| T theme | 3 | 3 | 2 | 7 | 15 | 10 |
| X shared | 0 | 0 | 0 | 8 | 8 | 3 |
| U kira-ui | 0 | 0 | 0 | 0 | 0 | 0 |
| **Total** | 1477 | 625 | 305 | 981 | **3388** | **442** |

2367 distinct strings. Most repeated: Cancel 58, Delete 29, Reset to default 28, Refresh 22, Close
20, Name 19, Stop 17, Save 17, Loading… 14, Retry 14, Search 13, Remove 11, No matches 10.

Text outside `.vue` templates (all frontend-owned, all cataloged):

- Menu models: `S/project/menus.ts`, `menuItems.ts`, `S/views/{browse,documents,grid,stream}/menu.ts`,
  `S/views/console/resultMenu.ts`, `S/views/shared/keyvalue/menu.ts`, `S/views/definition/columnsMenu.ts`,
  `S/api/menus.ts`, `K/repo/menus.ts`, `K/ade/v2/board/{taskMenu,dayMenu,fixMenu}.ts`,
  `G/components/rowMenuModel.ts`, `W/util/collectionMenu.ts`, `W/components/opLog.ts`.
- Text builders: `W/automations/runs/runText.ts`, `W/automations/schedule/scheduleText.ts`,
  `K/ade/v2/board/labels.ts`, `setupStatus.ts`, `G/components/gitBlockedCopy.ts`, `refBadges.ts`,
  `S/views/console/planIssues.ts` and `planParsers/*.ts` (issue sentences), `S/views/shared/typeGlossary.ts`
  (type descriptions), `S/views/shared/celleditor/{detect,formats,generate,validate}.ts`,
  `S/views/console/{lint,sqlDiagnostics,completion}.ts`, `X/domain/sql-lint.ts` (diagnostics),
  `S/workbench/DbMcpApprovalDialog.vue` `CLASS_WORDS`.
- Confirm messages: 26 `confirm({ message, confirmLabel })` calls, 6 `ConfirmDialogView` hosts.
- Announcements: `copyAnnounced(text, what)` (noun fragments composed into "Copied …"),
  git `announce()`/`detailActions.copy(text, whatCopied)`, `reportAsyncError(err, "Couldn't …")`.
- Formatter words: `W/behaviour/format.ts` (`just now`, `5m ago`, `plural()`), `useRelativeTime`.
- DOM built outside Vue: `S/views/grid/SlickGridHost.vue` cells, `K/views/repo/reviewDecorations.ts`
  (Monaco view zones), `K/views/repo/blameAnnotation.ts`.
- Defaults inside shared components: `ConfirmDialogView` (`Confirm`, `Cancel`), `QueryState`
  (`Loading…`, `Could not load`, `Retry`), `BootFailure` (`{appName} failed to start`).

Separate Vue apps (each needs the i18n plugin): `S/main.ts:351`, `K/main.ts:151`, `M/main.ts:24`,
`G/main.ts:97/101` (`mount()`), `K/views/repo/reviewDecorations.ts:489/503` (`ReviewThread` in Monaco
view zones), `W/bootstrapShell.ts:19` (`BootFailure`). `S/../proto/` is a dev prototype, out of scope.

### 1.2 Go-originated text that reaches the user

| Kind | Where | Count | Decision |
|---|---|---|---|
| Native app menu | `internal/shell/menu.go` (`"Quit " + appName`), `apps/kira-studio/internal/appshell/menu.go`, `apps/kira-space/internal/appshell/menu.go` | ~30 labels | Cataloged (`backend.menu.*`), Go reads the catalog (§2.5) |
| OS notifications | `internal/prompts/router.go:142/284`, `bound.go:54`, `internal/scriptruns/schedule.go:166`, `apps/kira-space/internal/agentnotify/agentnotify.go:205/388` | ~10 | Cataloged (`backend.notify.*`) |
| Native dialog titles and filters | `apps/kira-space/internal/bridge/memoryimport.go:55/61`, Studio/Space `bridge/files.go` pickers | ~6 | Cataloged (`backend.dialog.*`) |
| Op-log undo labels | `apps/kira-space/internal/gitsession/ops.go:786/921/1044/1068/1104` | 5 | Cataloged (`backend.git.undo.*`) |
| Definition section titles | `apps/kira-studio/internal/adapters/{kafka,sqs,clickhouse}/definition.go` | 7 | Cataloged (`backend.definition.*`) |
| Query plan root labels | `apps/kira-studio/internal/queryplan/{sqlite,mysql,mariadb}.go` | 3 | Cataloged (`backend.queryPlan.*`) |
| Backend error messages | `ipcerr.BadRequest/New/Internal*/Wrap/NotFound/SecretStore/Disconnected` | ~580 call sites | **Not cataloged.** Shown through `errorText`; P266 item (2) owns the error model (codes to catalog text). Known open item (§5.7) |
| Window titles, product names, MCP server titles | `apps/*/main.go` `AppName`/`WindowTitle`, `dbmcp/server.go`, `mcpserver/server.go` | 6 | Not cataloged: product names, not wording; MCP titles are not UI |
| Engine/adapter data | metric names, engine labels (`ServerLabel`), config keys, definition notes | — | Data, not cataloged |

### 1.3 Specs that assert text

`toHaveText`/`toContainText`/`getByText`/`getByRole(..., { name })`/`getByPlaceholder`/`getByLabel`/
attribute asserts: Studio ui 1198 (71 files), Space ui 501 (66), mobile 25 (6), visual 24 (11),
unit Studio 177, unit Space 9. Testids are the primary locator and stay unchanged.

## 2. Decisions (final)

### 2.1 Library

vue-i18n `11.4.12` (MIT, intlify, published 2026-09-16, active: 11.4.14 on 2026-10-10; exact pin per
`bunfig.toml`). Composition API only: `createI18n({ legacy: false, globalInjection: false,
locale: 'en', fallbackLocale: 'en', missingWarn: false, fallbackWarn: false })`. Built-in plural
(`a | b`), named interpolation (`{name}`), `n()` number formatting, the `Translation` component for
rich text. JIT message compilation (default since v10): no `eval`, CSP-safe in the WebView. Feature
flags defined in every Vite config: `__VUE_I18N_FULL_INSTALL__: false`,
`__VUE_I18N_LEGACY_API__: false`, `__INTLIFY_PROD_DEVTOOLS__: false`. Message syntax validation in
the checker uses `@intlify/message-compiler` (vue-i18n's own parser, same version), not a
hand-rolled parser. Source guard parses `.vue` with `@vue/compiler-sfc` and expressions/TS with
`@babel/parser` (both already in the tree through Vue).

### 2.2 One catalog file

- **`packages/theme/src/i18n/en.json`**, the only catalog. One file per locale is the i18n
  structure; a future locale is `fr.json` next to it. No per-module files.
- JSON, not TS: the Go side reads the same file (§2.5), so menus, notifications and in-app text
  share one file; translators and tools read JSON; Biome sorts and formats it.
- Home is `packages/theme`: the one package every app and package already imports through
  `@theme/*` (kira-ui reaches only theme), so no new alias.
- Nested objects, top-level = namespace; keys sorted by Biome `useSortedKeys` (natural order,
  override for this file), objects always expanded (`json.formatter.expand: "always"`), 2-space
  indent. Deterministic order makes every insertion land in its namespace's region (§4.4).
- Namespaces and owners:

  | Namespace | Holds | Owner |
  |---|---|---|
  | `automations` | `W/automations/**` | C |
  | `backend` | Go-read text (§2.5) | foundation |
  | `common` | shared vocabulary (§2.4) | foundation |
  | `docker` | `p/docker-ui` | C |
  | `format` | `behaviour/format.ts` words | foundation |
  | `git` | `p/git-ui` | C |
  | `memory` | `W/memory/**` | B |
  | `mobile` | `M/` | B |
  | `shared` | `p/shared` (sql-lint diagnostics, domain labels) | foundation |
  | `space` | `K/` | B |
  | `studio` | `S/` | A |
  | `theme` | `p/theme/src` components | foundation |
  | `workbench` | `W/` minus `memory/`, `automations/` | C (F2/F4 write the foundation files' keys before streams start) |

### 2.3 Runtime API (`packages/theme/src/i18n/`)

- `index.ts`: the `i18n` instance (`messages: { en }`), `t`, `MessageKey`, `CatalogText` re-export,
  `installCopyTestHook()`.
- `t(key: MessageKey, params?: Record<string, string | number>): string` wraps
  `i18n.global.t`. When `params.count` is a number: named `count` becomes `i18n.global.n(count)`
  (locale digit grouping, same as `formatCount`) and the raw number selects the plural branch.
  Global, reactive to `i18n.global.locale` in templates and `computed`.
- `MessageKey` = every leaf path of `typeof en` (JSON import, `resolveJsonModule`). An unknown key
  fails `vue-tsc`/`tsgo`. `PlainKey` = alias for maps of keys (`Record<Kind, MessageKey>`).
- Components: `import { t } from '@theme/i18n'` in `<script setup>`, `{{ t('studio.x.label') }}`,
  `:aria-label="t('…')"`. Never `$t`, never `useI18n()` outside this folder.
- `CatalogText.vue`: `<CatalogText k="key" :params tag="span">` over vue-i18n `Translation`, `k`
  typed `MessageKey`, named slots for rich parts (`<template #key><Kbd …/></template>`,
  `<template #path><code>…</code></template>`, `<template #name><VarText :parts/></template>`).
  The one way to put an element inside a sentence; a sentence never splits across literals.
- `pseudo.ts`: `pseudoMessages(en)` wraps each plural branch as `⟦…⟧`, keeps placeholders.
  `installCopyTestHook()` (called only inside each app's existing `if (__KIRA_DEBUG_HOOKS__)`
  block) sets `window.__kiraSetLocale(locale: 'en' | 'pseudo')`. Test builds only; never shipped.
- `types.check.ts`: typecheck fixture, `// @ts-expect-error` on an unknown key and a key with a
  typo; included by the Studio web program; knip-ignored.
- `catalog.go` (package `i18n`, import path `.../packages/theme/src/i18n`): `//go:embed en.json`,
  flattens once, `T(key string, args map[string]string) string` replaces `{name}`; panics on an
  unknown key. `catalog_test.go`: every `i18n.T("…")` literal in repo `.go` files names a
  `backend.*` key that exists and every placeholder it has is passed (the Go equivalent of the typed
  key). `backend.*` messages use named placeholders only (no plural, no `@`), checker rule C8.
- Rules for callers: `t()` runs at render or call time, never at module scope (a module constant
  holds a key, not text; guard U70). Hot paths (SlickGrid formatters, virtual rows, Monaco
  decorations) resolve `t()` once per setup or render pass into a local, never per cell. Values that
  drive logic (enum values, status ids, persisted strings, testids) are never translated; only the
  label shown for them.

### 2.4 Glossary and style rules

Recorded in `docs/ARCHITECTURE.md` "Copy and i18n (P265)" (F4) and enforced by checker rules C1-C11
and guards U64-U71 where machine-checkable.

**Style.**

1. **Sentence case** everywhere in app UI: buttons, menus, tabs, titles, headings, tooltips,
   column headers, options. Capital letters only for the first word, proper nouns and acronyms
   (checker list: Kira Studio, Kira Space, Claude, Claude Code, Git, GitHub, Docker, Docker Desktop,
   Jira, MCP, SQL, JSON, YAML, CSV, TSV, HTTP, HTTPS, gRPC, URL, URI, SHA, PR, ID, API, DDL, TLS,
   SSL, AWS, S3, SQS, Kafka, Redis, MongoDB, PostgreSQL, MySQL, MariaDB, SQLite, ClickHouse, macOS,
   Mac, iPhone, Android, Wi-Fi, EXPLAIN, SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP,
   TRUNCATE, NULL, ADE, CPU, UTC, EJSON, ObjectId, Monaco, curl, Postman, DataGrip, Colima, Enter,
   Esc, Tab, Shift, Cmd, Ctrl, Alt, Option, Return). Native macOS menu bar (`backend.menu.*`) is
   title case per the macOS HIG. CSS `uppercase` on `SectionHeading`/`DropdownMenuLabel` stays
   presentation; the catalog holds sentence case.
2. **Ellipsis `…`** (one character, never `...`): on an action label only when it opens a dialog or
   picker that needs more input before the action happens (`Import collection…`, `Choose file…`,
   `New connection…`, `Rename…` when a dialog renames). Not on an action that opens a tab, view or
   panel, nor on one followed only by a confirm (`Delete`, not `Delete…`). Progress and loading
   text always ends with `…`. Placeholders never end with `…`.
3. **Terminal punctuation by role** (key leaf, §2.6): labels, buttons, menu items, tooltips, titles,
   placeholders, options, status words, announcements: no trailing period. Sentences (body, hint,
   description, emptyHint, error): end with `.`; an error may end with `{error}` (backend detail).
   Confirm titles end with `?`.
4. **Quotes and apostrophes**: typographic `“ ”` around a named instance in prose, `’` in
   contractions. No straight `"` or `'` in values except `example` keys.
5. **Contractions** in sentences: `can’t`, `couldn’t`, `isn’t`, `doesn’t`, `won’t` (friendly,
   shorter; majority usage today). `cannot`/`could not` banned.
6. **Spelling**: British (`colour`, `cancelled`, `recognise`, `summarise`, `normalise`,
   `behaviour`, `licence` noun), matching the repo's own docs. Technical terms keep their spelling
   (`Color` only inside a code literal).
7. **No `&`** in prose (`and`); no `(s)` plurals (plural message); no `e.g.` (`for example`); no
   `Error:` prefix (the Alert/`InlineState` tone carries it); no `OK`, `Yes`, `No` buttons (use the
   verb).
8. **Clause separator**: ` — ` (spaced em dash) between clauses, as today. Before backend error
   detail: `: ` (`Couldn’t load the repository: {error}`).
9. **Numbers, sizes, dates, durations**: P264 `behaviour/format.ts` only; its word templates move to
   `format.*`. Counts with a noun are plural messages using `{count}` (`t(key, { count })`).
   Byte units (`B`…`TB`), `%` and `ms`/`s` symbols stay in `format.ts` code (symbols, not words).
10. **Interpolated values**: named placeholders, camelCase (`{name}`, `{branch}`, `{count}`,
    `{error}`). A user-provided name in prose is quoted: `“{name}”`. Resolved script variables in
    previews keep `VarText` (standing user rule): a catalog sentence around them is a
    `CatalogText` with a `VarText` slot. No string built by concatenating translated parts.
11. **Tooltips**: an icon button's tooltip and `aria-label` are one key (`.tooltip`), the action as a
    label (`Copy path`), no period, no shortcut text (`Kbd` renders chords, P263). An explanatory
    hover is a `.hint` sentence.
12. **Confirm dialogs**: title `<Verb> <object>?` (`Delete connection?`); body names the instance in
    `“ ”` and states the consequence; irreversible adds `common.confirm.irreversible`
    (`This can’t be undone.`); buttons `Cancel` + the title's verb (`Delete`; fixed compound verbs
    stay whole: `Force push`, `Take over`, `Check out`). Default title `Confirm` retired; `cancelLabel`
    variants (`Keep`, `Leave it`) retired (Cancel always).
13. **Empty states**: title `No <items> yet` when the user can create one, `No <items>` otherwise;
    filtered-empty is `No matches`; hint is a sentence saying what to do.
14. **Errors**: an attempted action failed: `Couldn’t <verb> <object>.` or `…: {error}`. A
    precondition blocks the action: `Can’t <verb>: <reason>.` Load failure in `QueryState`:
    `Couldn’t load` + `Retry`.
15. **Status words**: sentence case single words or short phrases (`Running`, `Idle`, `Failed`,
    `Stale`). Raw engine states (Docker `running`, Postgres plan node names) are data, shown as is.

**Wording audit: every action/label variant found and the one chosen.**

| Concept | Variants found (sites) | Chosen | Why |
|---|---|---|---|
| Destroy a stored item | Delete 29, Delete anyway, Delete row(s) | `Delete` | Destruction only; plural via message |
| Take out of a list, item survives | Remove 11, Remove from stack, Remove repository… | `Remove` | Detach; never destroys (repo files, script file stay) |
| Empty a list, history or field | Clear 6, Clear history, Clear all, Empty both fields and refetch, confirm button `Delete` on cookie/history clears | `Clear` | Container stays; button now matches title |
| Abandon a dialog or form | Cancel 58 | `Cancel` | Standard |
| Confirm dialog cancel | Cancel, Keep, Leave it | `Cancel` | One muscle memory; the confirm verb carries meaning |
| End a transient surface | Close 20, Close search, Close tab, Close result | `Close` | Surface ends; reopen to see it again |
| Toggle a persistent part | Hide search 5, Hide log 3, Hide/Show password, value, descriptions, output | `Show <x>` / `Hide <x>` | Visibility pair |
| Remove a notice | Dismiss 7 | `Dismiss` | Banners, strips, notes only |
| Throw away unsaved or pending changes | Discard 4, Discard pending changes, Revert row(s), Reset (discard changes) | `Discard` (`Discard changes`) | `Revert` is a git word |
| Git revert | Revert 3 | `Revert` | Git term |
| Git reset | Reset (discard changes), Reset | `Reset` | Git term; consequence in body |
| Settings back to default | Reset to default 28, Reset 7 | `Reset to default` | Explicit target |
| Persist a draft or document | Save 17, Save request, Save to, Save schema, Save filters | `Save` (+ object only when two saves share a surface) | One verb |
| Apply pending changes, stay open | Apply 5, Update 2, Confirm 2, OK — | `Apply` | `Confirm`/`OK` banned as buttons |
| New top-level thing (menu/toolbar) | New 34, Create branch 3, Create tag 2, Create Worktree…, Add repositories… | `New <thing>…` (opens dialog) | One entry verb; dialog footer verb is `Create` |
| Creation dialog primary | Create, Create branch, Save, Add | `Create` | Footer verb fixed |
| Append inside an editor or list | Add 8, Add row, Add parameter, + Add repo…, Add to backlog | `Add <thing>` | No `+` text prefix (icon carries it) |
| Import | Import collection…, Import from curl…, Import repository…, Import folder… | `Import <thing>…` | Opens picker/dialog |
| Re-fetch on demand | Refresh 22, Reload 4, Refresh repo, Refresh all | `Refresh` | `Reload` banned |
| Re-attempt after failure | Retry 14, Try again, Retry setup, Retry failed | `Retry` | One verb |
| Execute once | Run 5, Run statement, Run all, Run now, Run again | `Run` | Scripts, statements, automations |
| Long-running process | Start 8, Stop 17, Start all, Stop all | `Start` / `Stop` | Sessions, containers, agents |
| Undo an in-progress git operation | Abort, Abort rebase, Cancel restack | `Abort` | Restores prior state (rebase, merge, cherry-pick, restack) |
| Cancel an in-flight request | Cancel loading, Cancel operation | `Cancel` | UI-started work |
| Take over an agent run | Take over 8, Stop and take over | `Take over` | Stop is implied, stated in body |
| Choose in a picker | Choose… 4, Choose file…, Choose folder…, Pick a workflow…, Pick a date and time | `Choose` | `Pick` banned |
| Instruction to select in a list | Select a commit first., Pick a file to see its diff. | `Select` | List selection |
| Rename | Rename 5, Rename…, Rename branch | `Rename` (`Rename…` only when a dialog opens) | |
| Edit an attribute from a fixed set | Change base, Change engine | `Change <attribute>` | Replace one value |
| Edit generally | Edit 6, Edit…, Update credentials… | `Edit`, `Edit credentials…` | `Update` reserved for app update |
| App update | Update, Later | `Update` / `Later` | Unchanged |
| Settings | Settings, Open settings, Open Settings, Repository settings | `Settings`, `Open settings` | `Preferences` banned |
| Copy | Copy 9, Copy name, Copy JSON, Copy as JSON, Copy for AI, Copy for agent, Copy session id | `Copy <thing>`, `Copy as <format>` (conversion), `Copy for agent`, `ID` | One form each |
| Copy feedback | Copied 5, Copied ${what}, Copy failed: | `Copied`, whole messages (`Copied name`), `Couldn’t copy: {error}` | No noun fragments |
| Git checkout | Checkout 3, Checkout a branch first, Switch to it | `Check out` (verb), `checkout` (noun) | English verb form |
| Loading | Loading… 14, Loading 4, loading 5, Loading board… | `Loading…`, `Loading <noun>…` | P263 rule kept |
| Empty, none exist | No connections yet, No items, Nothing to show., No data | `No <items> yet` / `No <items>` | `Nothing to show` banned |
| Empty, filtered | No matches 10, No matching rows/items/branches/commands | `No matches` | One phrase |
| Load failure | Could not load, Could not load the board., Couldn't load X — err, Failed | `Couldn’t load <thing>: {error}` | Contraction, colon detail |
| Action failure | Couldn't open X — err, Could not open this diff., Failed to | `Couldn’t <verb> <object>: {error}` | |
| Blocked action | Can't check out, Can't pull — local changes in the way | `Can’t <verb>: <reason>.` | Precondition, not failure |
| Irreversible note | This cannot be undone. 4 | `This can’t be undone.` | Contraction rule |
| Confirm title | default `Confirm`, question in body | `<Verb> <object>?` | Title says what happens |
| Ellipsis character | `…` 131, `...` 1 (`Search for a command to run...`) | `…` | One character |
| Plural | `(s)` 6, `plural()` | plural message | Locale-ready |
| Capitalisation | Command Palette, Add Review Comment, Open Settings, Uncommitted Changes, Create Worktree…, Need You, Mark Selection Reviewed, Docker Engine | sentence case | Rule 1 |
| Spelling | Colour 9, Color 3, colouring, recognised, normalized, materialized | British | Rule 6 |
| Quotes | straight `"name"` 30+, curly `“”` 6 | `“{name}”` | Rule 4 |
| Ampersand | Reconnect & load 4, Saved & recent filters 2 | `and` | Rule 7 |
| repository / repo | repository 30, repo 17 | `repository` | One term; `repo` stays in code |
| folder / directory | folder 12, directory 4 | `folder` (except `working directory`, `home directory`) | macOS term |
| ID | ID, id, Id, session id | `ID` (`_id` literal stays) | Acronym rule |
| Example marker | e.g. 2 | `for example` | Rule 7 |
| Run in background | in the background, in background | `Run in background` | Shorter |
| Placeholder | Type a command…, Search branches…, Write notes… | `Type a command`, `Search branches`, `Write notes` | Rule 2 |
| Show more / Load more | Show more, Show more (N remaining), Load more | `Show more` (reveal capped items), `Load more` (fetch next page) | Two concepts, P264 `ShowMoreButton` vs git `LoadMoreButton` |
| Native menu | Settings…, Command Palette…, Toggle Project Panel | unchanged, title case | macOS HIG; one key each |

### 2.5 Go reads the catalog

`backend.*` holds every Go-originated string in §1.2 marked cataloged. Go calls
`i18n.T("backend.menu.newConnection", nil)` (package path above). Placeholders are product names or
names passed as `map[string]string`. Error messages stay Go literals (P266). No locale switch in Go
(English only).

### 2.6 Key naming

- `<namespace>.<area>.<surface>.<element>.<role>`, camelCase segments (`^[a-z][a-zA-Z0-9]*$`),
  depth 3-6. `<area>` mirrors the source folder (`studio.console`, `studio.grid`, `space.ade.plan`,
  `git.dialog.branch`, `docker.container`). Keys name meaning, never the English text
  (`studio.project.connectionMenu.delete.label`, not `studio.deleteConnectionDots`).
- Module-local shared vocabulary: `<namespace>.common.*` (`git.common.branch.label`). App-wide
  shared vocabulary: `common.*` (§3.2 F2 list).
- Leaf roles (checker C7 rules): `label`, `tooltip`, `aria`, `placeholder`, `title`, `option`,
  `status`, `announce`, `confirm` (label style); `body`, `hint`, `description`, `emptyHint`,
  `error` (sentence style); `empty` (empty title, label style); `loading` (ends `…`); `example`
  (code or sample text, exempt from style); a confirm group is `<surface>.<x>Confirm.{title,body,
  confirm}` (title ends `?`). `format.*` leaves are format templates, exempt from role style.
- Two keys with identical text are one key (checker C3) unless a named exemption states why
  (different grammatical role a translation would split, for example the verb `Open` and the status
  `Open`).

### 2.7 How specs reference text

- Specs keep literal expected strings. A spec reading its expectation from the catalog proves
  nothing about wording; literal assertions are the wording contract. Testids stay the primary
  locator; none renamed.
- When a stream changes a string's wording it greps the old text in `apps/*/tests` and updates every
  hit in a spec it owns; a hit in another owner's spec goes to its findings file (the test-and-fix
  agent applies it).
- New specs (§4.3) assert the unified wording on key surfaces; coverage specs use the pseudo-locale
  hook to prove chrome text comes from the catalog.

## 3. Foundation

Ownership for the whole phase (streams never edit these; needs go to the stream's findings file):
`packages/theme/**`, `packages/shared/**`, `packages/kira-ui/**`, `packages/workbench/src/
{behaviour,bridge,testing}/**`, `W/components/{ConfirmDialog,ConfirmDialogView,QueryState,
ContextMenu,BootFailure,ShowMoreButton,AppLiveRegion}.vue`, `W/state/{confirmDialog,contextMenu}.ts`,
`W/prompt/TextPromptDialog.vue`, `W/bootstrapShell.ts`, en.json namespaces `backend`, `common`,
`format`, `shared`, `theme`, `scripts/copy/**`, `biome.json`, root `package.json`, `knip.json`,
`docs/ARCHITECTURE.md`, `docs/v2.2/SPEC.md`, all Go files touched in §3.3.

### 3.1 F0 (sequential, main checkout, before any worktree)

1. Dependencies: `vue-i18n@11.4.12` in `packages/theme/package.json`; root devDependencies
   `@intlify/message-compiler` (same version vue-i18n resolves) and explicit `@vue/compiler-sfc`,
   `@babel/parser` (versions already in `bun.lock`); `bun install`.
2. `"resolveJsonModule": true` in every tsconfig whose program reaches theme: Studio
   `frontend/tsconfig.json`, `tsconfig.proto.json`, `tsconfig.tests.json`, `tests/unit/tsconfig.json`;
   Space `frontend/tsconfig.json`, `tsconfig.mobile.json`, `tsconfig.tests.json`,
   `tests/unit/tsconfig.json`; `packages/{workbench,git-ui,docker-ui,kira-ui,api-core}/tsconfig.json` (and any
   other `tsc -p` target `bun run typecheck` lists that fails without it).
3. vue-i18n flags (§2.1) in `packages/workbench/src/viteAppConfig.ts` `define`,
   `apps/kira-space/frontend/vite.mobile.config.ts`, `apps/kira-studio/frontend/vite.proto.config.ts`.
4. `packages/theme/src/i18n/en.json` skeleton: every namespace of §2.2 with one seed key each
   (`common.action.cancel` = `Cancel`, `studio.module.title` = `Kira Studio`, `space.module.title` =
   `Kira Space`, `mobile.module.title` = `Kira Space`, `memory.module.title` = `Memory`,
   `git.module.title` = `Git`, `docker.module.title` = `Docker`, `automations.module.title` =
   `Automations`, `workbench.module.title` = `Workbench`, `backend.menu.edit.label` = `Edit`,
   `format.relative.justNow` = `just now`, `shared.module.title` = `Shared`, `theme.module.title` =
   `Theme`). Seeds keep every namespace a multi-line object; duplicates among seeds get exemptions in
   F3's checker or are replaced by real keys in F2/F4 (the unused-key check is off until close-out).
5. `biome.json` stays F3's; F0 only runs `biome check --write` on en.json.
6. `knip.json`: ignore `packages/theme/src/i18n/types.check.ts`.
7. Commit `chore(i18n): vue-i18n dependency, JSON modules, catalog skeleton`. Hook green.

### 3.2 F1, F2, F3 (parallel, worktrees off the F0 tip, zero overlap)

| Task | Owns (only these) | Depends on |
|---|---|---|
| F1 runtime | `packages/theme/src/i18n/{index.ts,types.ts,CatalogText.vue,pseudo.ts,types.check.ts,catalog.go,catalog_test.go}` | F0 |
| F2 foundation catalog content | `packages/theme/src/i18n/en.json` | F0 |
| F3 guards and checkers | `scripts/copy/**`, `scripts/copy-allowlist/pending.txt`, `biome.json`, root `package.json` (scripts only) | F0 |

No ordering dependency: F1 reads en.json's shape (seed keys exist), F2 writes data only, F3 tests its
rules on fixtures and runs against whatever en.json the tree holds. Sequential after them: F4.

**F1 runtime.** §2.3 exactly. `catalog_test.go` scans `**/*.go` for `i18n.T("` literals (none yet:
the test passes vacuously until F4) and asserts `backend.*` messages parse with no plural/linked
syntax. Commit `feat(theme): i18n runtime, typed keys, CatalogText, pseudo-locale, Go reader`.
Verify: typecheck (the `@ts-expect-error` lines prove an unknown key fails), `go test
./packages/theme/src/i18n/`, lint. Measure `bun run typecheck` wall time before/after; record in
"Foundation result" (stop and report if over +30%).

**F2 foundation catalog content.** Writes these namespaces from §2.4 (wording already decided) and a
grep of the foundation-owned sources:

- `common.action.*`: add, apply, approve, back, cancel, checkOut, clear, clearAll, clearHistory,
  clearSearch, close, closeAll, closeOthers, closeSearch, closeToTheRight, collapse, collapseAll,
  copy, copyAll, copyAsJson, copyId, copyName, copyPath, copyValue, create, delete, deny, discard,
  dismiss, download, duplicate, edit, expand, expandAll, filter, find, hide, hideSearch, next,
  nextMatch, nextPage, open, openInNewTab, openSettings, openTerminal, previous, previousMatch,
  previousPage, refresh, remove, rename, reset, resetToDefault, restore, retry, reveal, run, runAll,
  save, search, select, send, show, showAll, showLess, showMore, start, startAll, stop, stopAll,
  takeOver (each `.label`; text per §2.4 table).
- `common.state.*`: loading `Loading…`, loadFailed `Couldn’t load`, noMatches `No matches`, none
  `None`, all `All`, default `Default`, inherit `Inherit`, saving `Saving…`, running `Running`,
  failed `Failed`, idle `Idle`, readOnly `Read-only`, unsavedChanges `Unsaved changes`, copied
  `Copied`.
- `common.field.*`: name, type, value, key, description, status, source, command, timeout, colour,
  noColour, title, kind, email, branch, text, number, date, time, duration (`.label`).
- `common.module.*`: settings, memory, automations, operations, terminal, repositories, worktrees,
  git, history, variables, connections, branches, commits, files.
- `common.product.*`: kiraStudio, kiraSpace, claudeCode, docker, github, jira.
- `common.confirm.*`: irreversible `This can’t be undone.`, cancel → reuses `common.action.cancel`
  (no second key).
- `common.copy.*`: copied `Copied`, failed `Couldn’t copy: {error}`, and the announcements every
  module shares (`copiedName`, `copiedPath`, `copiedId`, `copiedValue`, `copiedJson`).
- `common.key.*`: enter `Enter`, escape `Esc`, tab `Tab`.
- `common.error.withDetail` is NOT created (no composed errors).
- `format.*`: `relative.justNow`, `relative.minutes` `{count}m ago`, `relative.hours`,
  `relative.days`, `relative.future` `in {time}`, `relative.unitMinute` `{count}m`,
  `relative.unitHour`, `relative.unitDay`, `duration.ms` `{value} ms`, `duration.seconds`
  `{value} s`, `duration.minutesSeconds` `{minutes}m {seconds}s`, `duration.hoursMinutes`.
- `theme.*`: every string in `packages/theme/src` (`NumberStepperInput` Increase/Decrease,
  `RunState`, `SwatchRadio`, `ScriptProgress`, `SearchField` default placeholder `Search`,
  `Spinner` label, `VarText` aria `{name}: {value}`, `CommandDialog` defaults, `DialogHeader` close,
  every `sr-only` text in `components/ui/**`).
- `shared.*`: `domain/sql-lint.ts` diagnostics, `domain/connection.ts` labels that are wording (not
  engine product names), `protocol/frame.ts` user text.
- `workbench.*`, foundation part: `ConfirmDialogView`, `QueryState`, `BootFailure`
  (`{product} couldn’t start`), `ContextMenu`, `AppLiveRegion`, `TextPromptDialog`,
  `ShowMoreButton`.
- `backend.*`: every cataloged §1.2 string, enumerated with `grep -rnE 'Label: +"|"Quit "|Title: +"|Body: +"|FilterName: +"|Label: +"(Deleted|Dropped|Removed|Undo)' --include=*.go apps internal | grep -v _test`
  plus the definition/queryPlan sites; `backend.menu.*` title case.

Commit `feat(i18n): foundation catalog: common vocabulary, format, theme, shared, backend`. Verify:
`biome check` clean on en.json; after F3 lands, `bun scripts/copy/check-catalog.ts` clean (landing
order puts F2 last so this runs before its fast-forward).

**F3 guards and checkers.**

- `scripts/copy/catalogRules.ts`: pure functions, C1-C11 below. `scripts/copy/check-catalog.ts`:
  loads en.json, runs the rules, prints `check-catalog: <key>: C<n> <message>`, exit 1 on any.
  Flags: `--unused` adds C10 (off in lint until close-out).
- Catalog rules:
  - C1 every value parses with `@intlify/message-compiler` (catches stray `@`, `|`, `{`, `}`);
    literal `@` is written `{'@'}`.
  - C2 key segments camelCase, depth 3-6, leaf role from §2.6 (except `format.*`).
  - C3 identical values (whitespace-normalised) under two keys: fail unless an `ALLOWED_DUPLICATES`
    entry (keys plus reason) covers them.
  - C4 near-duplicates: lowercase, strip trailing `.…:`, unify quotes and apostrophes, replace every
    `{x}` with `{}`, collapse spaces; equal → fail, same exemption list.
  - C5 banned forms: `\.\.\.` (not `example`), straight `'`/`"` (not `example`), `\(s\)`, ` & `,
    `\be\.g\.`, `\bOK\b`, `\bPreferences\b`, `\bColor\b|\bcolor\b`, `\bcanceled\b`, `\bcannot\b`,
    `\bcould not\b`, `\bfailed to\b`, `\bunable to\b`, `\b[Pp]ick\b`, `\b[Tt]ry again\b`,
    `\b[Rr]eload\b`, `^Checkout\b`, `\brepo\b`, `\b[Dd]irectory\b` (allowed in `working directory`,
    `home directory`), `\b(Id|id)\b`, `^Error:`, `^\+ `, `Nothing to show`.
  - C6 case: sentence case per §2.4 rule 1 (proper-noun and acronym list in the module; the word
    after `. `, `? `, `: ` or ` — ` may start a new sentence); `backend.menu.*` title case.
  - C7 punctuation by role (§2.4 rule 3, confirm titles `?`, `loading` ends `…`, placeholders no
    trailing `…`/`.`).
  - C8 plural: a value containing ` | ` has 2 or 3 branches and uses `{count}`; `backend.*` has no
    plural, no linked message, only `{name}` placeholders.
  - C9 placeholders camelCase; no HTML tags (`<`/`>` outside `example`).
  - C10 (`--unused`) every key appears as a quoted literal in a scanned source (`.vue`, `.ts`, and
    `.go` for `backend.*`).
  - C11 no value is empty or only whitespace.
- `scripts/copy/catalogRules.spec.ts` (bun unit): C4 normalisation pairs, C6 with proper nouns,
  acronyms and new-sentence starts, C7 per role incl. `{error}` endings, C8 branch shapes, C3/C4
  exemption matching. Decision structure too large to hold in your head (CLAUDE.md bar).
- `scripts/copy/check-copy.ts` (source guard, AST): scans the U1-U63 `DIRS` plus the whole of
  `packages/theme/src` (F4 migrates it) and `packages/shared`. Skips `/testing/`, `*.spec.ts`,
  `*.test.ts`, `packages/theme/src/i18n/`. Rules (ids continue the UI guard numbering):
  - U64 (vue template) a text node with a letter `[A-Za-z]` after removing `{{ }}`; text inside
    `<code>`/`<kbd>` exempt only when the parent is a `CatalogText` slot.
  - U65 (vue template) a static attribute with a letter whose name is one of `title`, `placeholder`,
    `aria-label`, `aria-description`, `alt`, `label`, `description`, `message`, `hint`, `tooltip`,
    `heading`, `text`, `subtitle`, `caption`, `legend` or ends `-label`/`-text`/`-title`/`-message`/
    `-hint`/`-placeholder`.
  - U66 (vue template) a string literal (Babel AST of the expression) in a `{{ }}` or in a bound
    attribute of the U65 set, containing a space or starting with an uppercase letter, that is not
    the first argument of `t(`, not an operand of `===`/`!==`/`==`/`!=`, not an object key.
  - U67 (`.ts` and `<script>`) a string or template literal (Babel TS AST) containing a space or
    starting uppercase, that is the value of a property named `label`, `title`, `message`,
    `description`, `placeholder`, `confirmLabel`, `cancelLabel`, `tooltip`, `hint`, `text`, `detail`,
    `heading`, `emptyText`, `ariaLabel`, `subtitle`, `caption`, `lede`, `body`, `reason`,
    `whatCopied`, or an argument of `announce`, `announceApp`, `copyAnnounced`, `reportAsyncError`,
    `confirm`, or `new Error(` starting uppercase (developer errors use a lowercase `fn:` prefix), or
    assigned to `*.value`/`state.*` and starting uppercase with a space.
  - U68 `useI18n(`, `$t(`, `$tc(`, `i18n.global`, `from 'vue-i18n'`, `<i18n-t`, `<Translation`
    outside `packages/theme/src/i18n/`.
  - U69 composition: `t(...)` as an operand of `+`; a template literal containing `${t(` and other
    letters; `plural(` (use a plural message); `copyAnnounced(<x>, '<word>')` (pass a whole message).
  - U70 `t(` at module scope (Babel: a call to `t` not inside a function body).
  - U71 call-site params: `t('<literal key>', { … })` whose object keys differ from the message's
    placeholders, or a plural message called without `count`.
  - Allowlist (P263 format): `path` (whole file pending migration) or `permanent U<n> path #
    reason`. Lists only shrink; a stale entry fails. Reads `scripts/copy-allowlist/*.txt`.
  - Permanent exemptions allowed only for: font family names (`S/fonts.ts`), protocol tokens and SQL
    keywords (`S/views/console/completion.ts`, HTTP method names, `NULL` cell token), EJSON
    constructor syntax (`S/views/shared/document/ejson.ts`), brand marks, dev traces
    (`S/views/shared/slick/scrollTrace.ts`), text rendered by Monaco/SlickGrid/xterm engines
    themselves. Each line names the file and reason.
- `scripts/copy/tsconfig.json`; root `package.json`: `lint` appends `&& bun scripts/copy/check-copy.ts
  && bun scripts/copy/check-catalog.ts`; `typecheck` adds `typecheck:copy` (tsgo on
  `scripts/copy/tsconfig.json`); `test:unit` adds `scripts/copy`.
- `biome.json` override for `packages/theme/src/i18n/*.json`: `assist.actions.source.useSortedKeys:
  "on"`, `json.formatter.expand: "always"`. Prove: unsorting two keys fails `bun run lint`.
- `scripts/copy-allowlist/pending.txt`: every file failing U64-U71 at F3's tip (all stream and
  foundation files), so F3's commits are hook-green. F4 deletes it.

Commits: `feat(lint): catalog checker C1-C11 with unit tests`, `feat(lint): source text guard
U64-U71, pending allowlist`. Verify: typecheck, lint, `bun test scripts/copy`.

### 3.3 F4 (sequential, main checkout, after F1-F3 land)

Landing of F1-F3: F3 first (rebase on `v2.0`, ff), then F1, then F2 (rebase; run lint, so
`check-catalog` validates F2's content; fix in F2's branch; ff). Remove the three worktrees.

Then F4, in order, each a hook-green commit:

1. **Foundation UI migration** (`refactor(theme,workbench): foundation text through the catalog`):
   theme components, `packages/shared`, the foundation-owned workbench files (§3 header).
   `ConfirmOptions.title` documented as required by convention (stays `?` until close-out so stream
   files still typecheck); `ConfirmDialogView` defaults read `t()`; `QueryState` texts
   `common.state.loading`, `common.state.loadFailed`, `common.action.retry`.
   `behaviour/format.ts`: `formatRelative`, `useRelativeTime` messages, `formatDuration` read
   `format.*`; `plural()` kept but marked deprecated (U69 flags callers; close-out deletes).
   `behaviour/clipboard.ts`: `copyAndAnnounce(text, message)` added; old `copyAnnounced(text, what)`
   kept as a shim composing `Copied {what}` until close-out deletes it.
2. **Go native text** (`refactor: native menus, notifications and dialogs read the catalog`): every
   cataloged §1.2 site calls `i18n.T`; `catalog_test.go` now covers real keys. Verify `go build
   ./...`, `go test ./packages/theme/src/i18n/ ./internal/shell/... ./internal/prompts/...
   ./internal/scriptruns/... ./apps/kira-space/internal/agentnotify/...
   ./apps/kira-space/internal/gitsession/...`, `bun run lint:go`.
3. **Repo-wide mechanical edits** (`refactor: install i18n in every Vue app`): `app.use(i18n)` at
   the 6 `createApp` sites (§1.1); `installCopyTestHook()` inside the `__KIRA_DEBUG_HOOKS__` blocks
   of `S/main.ts` and `K/main.ts` (mobile has no test hooks: static guard plus its wording spec
   cover it). No literal moves here.
4. **Test helper** (`test: catalog coverage helper`): `packages/workbench/src/testing/ui/copyCoverage.ts`:
   `setPseudoLocale(page)` and `expectCatalogText(locator, { allow?: RegExp[] })`, which walks text
   nodes and `aria-label`/`title`/`placeholder` attributes under the locator and fails on any value
   with a letter outside `⟦…⟧`, skipping `pre`, `code`, `input`, `textarea`, `.font-data`,
   `[data-var]`, `.monaco-editor`, `.xterm`, `.slick-cell`, and `allow` matches (fixture data). Reka
   renders tooltip text twice; both copies carry markers.
5. **Seed stream namespaces**: keep the F0 seed keys; no stream content here.
6. **Allowlists** (`chore(lint): per-stream copy allowlists`): delete `pending.txt`; run
   `check-copy.ts`; every foundation-owned file must have zero hits (fix now) or a permanent line;
   write `scripts/copy-allowlist/stream-{a,b,c}.txt` with every failing file split by §4.1.
7. **Docs** (`docs: copy and i18n rules`): `docs/ARCHITECTURE.md` "Copy and i18n (P265)" under UI
   architecture: one catalog file, runtime API, key scheme, glossary (§2.4 style rules plus the
   chosen column of the audit table, one line each), guards U64-U71 and C1-C11, Go reader,
   how to add a string and a locale. Close-out finalises.
8. `docs(v2.2): P265 foundation result` in this plan: commits, typecheck time delta, allowlist
   counts, deviations. Background push `git push origin v2.0`.

Verify at F4 tip: `bun run typecheck`, `bun run lint`, `bun run test:unit`, `go test` set above,
`bun run build:test:studio`, `bun run build:test:space`, `bun run build:space-mobile` (each build
proves the vue-i18n flags and JSON import). No UI suite (test-and-fix runs them once).

## 4. Streams

Three named streams, worktrees off the **F4 tip** (same base): `/home/user/kira-p265-a` (branch
`p265-a`), `/home/user/kira-p265-b` (`p265-b`), `/home/user/kira-p265-c` (`p265-c`). One Sonnet
per stream, chunks in order, one commit per chunk (`refactor(<scope>): <chunk> text through the
catalog`), each hook-green (`bun run lint` incl. both copy checkers, `bun run typecheck`). No UI,
visual or flow suite in a stream. Discovery inside a file (what a string means, its callers, which
spec asserts it) uses `codegraph_explore` first.

Per file the implementer: moves every user-visible literal into its namespace in en.json (key per
§2.6), applies §2.4 (rewording now, not later), reuses `common.*`/module `common` keys where the
text matches (C3 enforces), uses `CatalogText` for sentences around elements, plural messages for
counts, `copyAndAnnounce` with whole messages, confirm `title`/`body`/verb per rule 12 (drops
`cancelLabel`), greps `apps/*/tests` for each old string and updates owned specs (others to
findings), removes the file from its allowlist (or adds a permanent line within the §3.2 categories,
with reason). A file with no hits needs no edit.

### 4.1 Ownership (zero overlap)

| Stream | Source | Catalog namespaces | Specs | Lint and notes |
|---|---|---|---|---|
| A Kira Studio | `apps/kira-studio/frontend/src/**` | `studio` | `apps/kira-studio/tests/**` except C's | `scripts/copy-allowlist/stream-a.txt`, `docs/v2.2/plans/P265-stream-a-findings.md` |
| B Kira Space, mobile, memory | `apps/kira-space/frontend/src/**`, `apps/kira-space/frontend/mobile/**`, `packages/workbench/src/memory/**` | `space`, `mobile`, `memory` | `apps/kira-space/tests/**` except C's | `stream-b.txt`, `P265-stream-b-findings.md` |
| C shared modules | `packages/git-ui/src/**`, `packages/docker-ui/src/**`, `packages/workbench/src/**` except `memory/**` and foundation files | `git`, `docker`, `automations`, `workbench` | Studio `tests/ui/{docker-*,automations-*,list-keyboard-docker,prompts,update-dialog}.spec.ts`, Studio visual `automations-module.spec.ts` + snapshots; Space `tests/ui/{automations-*,repo-graph-*,repo-commit-*,repo-branch-picker,repo-floating-geometry,repo-review-interaction,list-keyboard-git,prompts,update-dialog}.spec.ts`, Space visual `git-module.spec.ts` + snapshots; the new C specs in §4.3 | `stream-c.txt`, `P265-stream-c-findings.md` |

Deviation from the suggested split, with reason: `packages/theme` and `packages/kira-ui` are
foundation, not C. The catalog runtime lives in theme, theme's 10 text files are primitives every
stream consumes (their final wording must exist before streams start), and kira-ui has no text.

en.json: a stream edits only its namespaces' objects. Spec support helpers: Studio
`tests/ui/support/**` A, Space `tests/ui/support/**` and `tests/mobile/support/**` B; a helper C
needs → C's findings file.

**No ordering dependency between streams**: each consumes only foundation keys and APIs; no
source, spec, PNG, allowlist or catalog namespace is shared. Space mounts git-ui through its public
entry only.

### 4.2 Chunks

Lists come from the inventory; the allowlist written in F4 step 6 is authoritative: an
allowlisted file under a chunk's folders that the list misses joins that chunk (stays <=25) or the
sweep chunk. Paths: `S/` `K/` `M/` as above, `p/` `packages/`.

Stream A order: A1 API and project, A2 project, shortcuts, browse, console, A3 console, definition,
documents, grid, A4 grid, gRPC, HTTP, A5 shared views, A6 stream, workbench, settings, A7 sweep.

#### A1 (25)
`S/api/ApiStart.vue`, `S/api/BulkVariablesEditor.vue`, `S/api/CollectionsPanel.vue`, `S/api/CollectionsTree.vue`, `S/api/CopyAsCurlDialog.vue`, `S/api/DynamicValuesDialog.vue`, `S/api/EditRawRequestDialog.vue`, `S/api/EnvironmentSelect.vue`, `S/api/EnvironmentsView.vue`, `S/api/ImportCurlDialog.vue`, `S/api/ImportReportStrip.vue`, `S/api/SaveRequestDialog.vue`, `S/api/VariableHistoryMenu.vue`, `S/api/VariableRow.vue`, `S/api/VariableSetView.vue`, `S/api/VariablesOverviewPanel.vue`, `S/api/menus.ts`, `S/api/reveal.ts`, `S/api/state/collections.ts`, `S/api/state/variableCompletion.ts`, `S/beautify.ts`, `S/editor/MonacoHost.vue`, `S/fonts.ts` (permanent U67: font family names), `S/project/ConnectionDialog.vue`, `S/project/CredentialsUpdateDialog.vue`

#### A2 (25)
`S/project/DataGripImportDialog.vue`, `S/project/ErrorPopover.vue`, `S/project/FiltersDialog.vue`, `S/project/ProjectTree.vue`, `S/project/SchemaDialog.vue`, `S/project/credentialPaste/CredentialPastePanel.vue`, `S/project/credentialPaste/parse.ts`, `S/project/menuItems.ts`, `S/project/menus.ts`, `S/project/state/connectionReveal.ts`, `S/shortcuts/CommandPalette.vue`, `S/shortcuts/state.ts`, `S/state/objectStore.ts`, `S/state/runState.ts`, `S/state/tabKinds.ts`, `S/views/browse/BrowseView.vue`, `S/views/browse/menu.ts`, `S/views/browse/state.ts`, `S/views/console/ConsoleResultGrid.vue`, `S/views/console/ConsoleSavedMenu.vue`, `S/views/console/ConsoleSlickGrid.vue`, `S/views/console/ConsoleView.vue`, `S/views/console/ExplainResultView.vue`, `S/views/console/completion.ts` (permanent U67: SQL keywords), `S/views/console/format.ts`

#### A3 (25)
`S/views/console/lint.ts`, `S/views/console/planIssues.ts`, `S/views/console/planParsers/clickhouse.ts`, `S/views/console/planParsers/mariadb.ts`, `S/views/console/planParsers/mysql.ts`, `S/views/console/planParsers/postgres.ts`, `S/views/console/planParsers/sqlite.ts`, `S/views/console/resultMenu.ts`, `S/views/console/sqlDiagnostics.ts`, `S/views/console/state.ts`, `S/views/definition/ColumnsSection.vue`, `S/views/definition/ConstraintsSection.vue`, `S/views/definition/DefinitionView.vue`, `S/views/definition/IndexesSection.vue`, `S/views/definition/PropertiesSection.vue`, `S/views/definition/ValidationSection.vue`, `S/views/definition/columnsMenu.ts`, `S/views/definition/state.ts`, `S/views/documents/DocumentView.vue`, `S/views/documents/ProjectionMenu.vue`, `S/views/documents/menu.ts`, `S/views/grid/ColumnsMenu.vue`, `S/views/grid/DataToolbar.vue`, `S/views/grid/DataView.vue`, `S/views/grid/FilterToolbar.vue`

#### A4 (25)
`S/views/grid/FkPreviewPopover.vue`, `S/views/grid/PreviewCommandPanel.vue`, `S/views/grid/SlickGridHost.vue` (resolve `t()` once per grid setup, not per cell), `S/views/grid/fakeData/recipes.ts`, `S/views/grid/filterCompletion.ts`, `S/views/grid/fkPreview.ts`, `S/views/grid/menu.ts`, `S/views/grpcrequest/CallHistoryList.vue`, `S/views/grpcrequest/GrpcMetadataTable.vue`, `S/views/grpcrequest/GrpcRequestView.vue`, `S/views/grpcrequest/ResponsePane.vue`, `S/views/grpcrequest/SchemaBrowser.vue`, `S/views/grpcrequest/state.ts`, `S/views/httprequest/BinaryBodyPicker.vue`, `S/views/httprequest/CookiesPane.vue`, `S/views/httprequest/FormDataTable.vue`, `S/views/httprequest/HttpRequestView.vue`, `S/views/httprequest/RawExchangePane.vue`, `S/views/httprequest/RequestBodyPane.vue`, `S/views/httprequest/RequestSettingsPane.vue`, `S/views/httprequest/ResponseDiffDialog.vue`, `S/views/httprequest/ResponseHistoryList.vue`, `S/views/httprequest/ResponsePane.vue`, `S/views/httprequest/TimelinePane.vue`, `S/views/httprequest/state.ts`

#### A5 (25)
`S/views/shared/DateTimePicker.vue`, `S/views/shared/EditBufferActions.vue`, `S/views/shared/FilterHistoryMenu.vue`, `S/views/shared/ResponseFindBar.vue`, `S/views/shared/SavedListMenu.vue`, `S/views/shared/celleditor/CellEditorDock.vue`, `S/views/shared/celleditor/CellEditorView.vue`, `S/views/shared/celleditor/TimestampPane.vue`, `S/views/shared/celleditor/detect.ts`, `S/views/shared/celleditor/formats.ts`, `S/views/shared/celleditor/generate.ts`, `S/views/shared/celleditor/validate.ts`, `S/views/shared/document/DocumentRow.vue`, `S/views/shared/document/DocumentTree.vue`, `S/views/shared/document/ejson.ts` (permanent U67: EJSON syntax), `S/views/shared/document/rawTree.ts`, `S/views/shared/fields/FieldRowsTable.vue`, `S/views/shared/keyvalue/KeyValuePane.vue`, `S/views/shared/keyvalue/menu.ts`, `S/views/shared/mongoFieldSample.ts`, `S/views/shared/page/PagerControls.vue`, `S/views/shared/page/SearchFilterNotice.vue`, `S/views/shared/page/SearchToolbar.vue`, `S/views/shared/page/sizes.ts`, `S/views/shared/typeGlossary.ts`

#### A6 (22)
`S/views/shared/viewOp.ts`, `S/views/stream/StreamComposeMessage.vue`, `S/views/stream/StreamFilterHistoryMenu.vue`, `S/views/stream/StreamSearchToolbar.vue`, `S/views/stream/StreamView.vue` (poll confirm button `Poll`, not `Delete`), `S/views/stream/menu.ts`, `S/workbench/DbMcpApprovalDialog.vue`, `S/workbench/GenerateDataDialog.vue`, `S/workbench/SettingsDialog.vue`, `S/workbench/TitleBar.vue`, `S/workbench/UploadObjectDialog.vue`, `S/workbench/host.ts`, `S/workbench/modes.ts`, `S/workbench/panels/OperationsPanel.vue`, `S/workbench/panels/ProjectPanel.vue`, `S/workbench/panels/StudioStart.vue`, `S/workbench/settings/AdvancedPane.vue`, `S/workbench/settings/ApiPane.vue`, `S/workbench/settings/AppearancePane.vue`, `S/workbench/settings/CachePane.vue`, `S/workbench/settings/DataPane.vue`, `S/workbench/settings/DatabaseMcpPane.vue`

#### A7 (sweep)
Every remaining `stream-a.txt` path (`S/App.vue` and others the inventory missed), then the list
holds only `permanent` lines. `bun scripts/copy/check-catalog.ts --unused` limited by eye to
`studio.*` hits (none). New specs §4.3 A. Findings file complete.

Stream B order: B1 mobile and memory, B2 ADE shell, automation, backlog, board, B3 ADE needs, notes,
panel, B4 ADE plan, review, run, sessions, B5 ADE workflows, repo, B6 repo views, Space workbench,
settings, B7 sweep.

#### B1 (25)
`M/AppShell.vue`, `M/TabBar.vue`, `M/components/PermissionHint.vue`, `M/components/ReplySheet.vue`, `M/screens/BacklogScreen.vue`, `M/screens/NeedsScreen.vue`, `M/screens/PairScreen.vue`, `M/screens/PlanScreen.vue`, `M/screens/PlanTaskCard.vue`, `M/screens/TerminalScreen.vue`, `M/state/useTaskActions.ts`, `M/terminal/KeyBar.vue`, `M/terminal/useRemoteTerminal.ts`, `p/workbench/src/memory/AddMemoryDialog.vue`, `p/workbench/src/memory/MemoryPanel.vue`, `p/workbench/src/memory/MemorySetupHint.vue`, `p/workbench/src/memory/MemoryStart.vue`, `p/workbench/src/memory/import/ImportConfirmDialog.vue`, `p/workbench/src/memory/import/ImportFileRow.vue`, `p/workbench/src/memory/import/ImportJobDetail.vue`, `p/workbench/src/memory/import/ImportMenu.vue`, `p/workbench/src/memory/import/ImportStatus.vue`, `p/workbench/src/memory/import/ImportView.vue`, `p/workbench/src/memory/settings/ClaudeCodeMcpSection.vue`, `p/workbench/src/memory/settings/SemanticModelSection.vue`

#### B2 (24)
`K/ade/AdeView.vue`, `K/ade/v2/AdeAbortRebaseDialog.vue`, `K/ade/v2/AdeAddPopover.vue`, `K/ade/v2/AdeBasePicker.vue`, `K/ade/v2/AdeForcePushDialog.vue`, `K/ade/v2/automation/AdeAutomationChip.vue`, `K/ade/v2/automation/AdeAutomationsBlock.vue`, `K/ade/v2/automation/automationItems.ts`, `K/ade/v2/automation/useRunAutomation.ts`, `K/ade/v2/backlog/AdeBacklogPage.vue`, `K/ade/v2/backlog/AdeBacklogPanel.vue`, `K/ade/v2/backlog/AdeBacklogRow.vue`, `K/ade/v2/board/actions.ts`, `K/ade/v2/board/changeBase.ts`, `K/ade/v2/board/dayMenu.ts`, `K/ade/v2/board/fixMenu.ts`, `K/ade/v2/board/labels.ts`, `K/ade/v2/board/reviewCode.ts`, `K/ade/v2/board/setupStatus.ts`, `K/ade/v2/board/taskMenu.ts`, `K/ade/v2/board/workflowForm.ts`, `K/ade/v2/dialog/AdeClaudeDialog.vue`, `K/ade/v2/dialog/compose.ts`, `K/ade/v2/needs/AdeAllSessionRow.vue`

#### B3 (24)
`K/ade/v2/needs/AdeAllSessions.vue`, `K/ade/v2/needs/AdeNeedsPage.vue`, `K/ade/v2/needs/AdeNeedsRow.vue`, `K/ade/v2/notes/AdeNotesEditor.vue`, `K/ade/v2/notes/notesExtensions.ts`, `K/ade/v2/panel/AdeArchivedPanel.vue`, `K/ade/v2/panel/AdeBranchPanel.vue`, `K/ade/v2/panel/AdeChangesTab.vue`, `K/ade/v2/panel/AdeEstimateField.vue`, `K/ade/v2/panel/AdeLinkRow.vue`, `K/ade/v2/panel/AdePanel.vue`, `K/ade/v2/panel/AdeRunLog.vue`, `K/ade/v2/panel/AdeRunOutcome.vue`, `K/ade/v2/panel/AdeSetupProgress.vue`, `K/ade/v2/panel/AdeStageBlock.vue`, `K/ade/v2/panel/AdeStageMover.vue`, `K/ade/v2/panel/AdeTaskPanel.vue`, `K/ade/v2/panel/AdeTaskTab.vue`, `K/ade/v2/panel/AdeWorkflowBlock.vue`, `K/ade/v2/panel/AdeWorktreeSetup.vue`, `K/ade/v2/panel/headerActions.ts`, `K/ade/v2/plan/AdeAttention.vue`, `K/ade/v2/plan/AdeBranchRow.vue`, `K/ade/v2/plan/AdeDayBand.vue`

#### B4 (24)
`K/ade/v2/plan/AdeDayControls.vue`, `K/ade/v2/plan/AdeHistoryBar.vue`, `K/ade/v2/plan/AdePlanHeader.vue`, `K/ade/v2/plan/AdePlanView.vue`, `K/ade/v2/plan/AdeRepoChip.vue`, `K/ade/v2/plan/AdeTaskCard.vue`, `K/ade/v2/review/AdeReviewAgentPanel.vue`, `K/ade/v2/review/AdeReviewCompose.vue`, `K/ade/v2/review/AdeReviewHeader.vue`, `K/ade/v2/review/AdeReviewSync.vue`, `K/ade/v2/review/AdeReviewWindow.vue`, `K/ade/v2/review/useReviewCode.ts`, `K/ade/v2/run/AdeRunDialog.vue`, `K/ade/v2/sessions/AdeHeadlessPane.vue`, `K/ade/v2/sessions/AdeSessionId.vue`, `K/ade/v2/sessions/AdeSessionsTab.vue`, `K/ade/v2/sessions/AdeStoppedList.vue`, `K/ade/v2/sessions/AdeStoppedRow.vue`, `K/ade/v2/sessions/AdeTakeOverDialog.vue`, `K/ade/v2/sessions/AdeTuiPane.vue`, `K/ade/v2/shell/AdeCaptureBox.vue`, `K/ade/v2/shell/AdeShell.vue`, `K/ade/v2/state/adeTakeOver.ts`, `K/ade/v2/state/adeWorkflowsUi.ts`

#### B5 (24)
`K/ade/v2/wire.ts`, `K/ade/v2/workflows/AdeEndNode.vue`, `K/ade/v2/workflows/AdeStageInspector.vue`, `K/ade/v2/workflows/AdeStepInspector.vue`, `K/ade/v2/workflows/AdeStepNode.vue`, `K/ade/v2/workflows/AdeStepResults.vue`, `K/ade/v2/workflows/AdeWorkflowEditor.vue`, `K/ade/v2/workflows/AdeWorkflowGraph.vue`, `K/ade/v2/workflows/AdeWorkflowSaveBar.vue`, `K/ade/v2/workflows/AdeWorkflowYaml.vue`, `K/ade/v2/workflows/AdeWorkflowsPage.vue`, `K/repo/GitNewTab.vue`, `K/repo/GitPanel.vue`, `K/repo/GitStart.vue`, `K/repo/RepoConfigForm.vue`, `K/repo/RepoEnvRow.vue`, `K/repo/RepoFileTree.vue`, `K/repo/RepoReviewView.vue`, `K/repo/RepoSearchRow.vue`, `K/repo/RepoSearchView.vue`, `K/repo/ReposDialog.vue`, `K/repo/menus.ts`, `K/state/coderepos.ts`, `K/state/settingsDomain.ts`

#### B6 (24)
`K/views/repo/RepoDiffView.vue`, `K/views/repo/RepoFileView.vue`, `K/views/repo/RepoMultiDiffView.vue`, `K/views/repo/ReviewThread.vue`, `K/views/repo/askReviewAgent.ts`, `K/views/repo/blameAnnotation.ts`, `K/views/repo/fileContent.ts`, `K/views/repo/reviewDecorations.ts` (DOM-built text: `t()` at zone build), `K/workbench/ClaudeUsageItem.vue`, `K/workbench/GitCredentialDialog.vue`, `K/workbench/MobilePairingDialog.vue`, `K/workbench/OperationsPanel.vue`, `K/workbench/PairingRequestDialog.vue`, `K/workbench/SettingsDialog.vue`, `K/workbench/TitleBar.vue`, `K/workbench/modes.ts`, `K/workbench/settings/AdvancedPane.vue`, `K/workbench/settings/AppearancePane.vue`, `K/workbench/settings/ClaudeCodePane.vue`, `K/workbench/settings/DateFormatField.vue`, `K/workbench/settings/GitPane.vue`, `K/workbench/settings/MobileAccessPane.vue`, `K/workbench/settings/MobileQr.vue`, `K/App.vue`

#### B7 (sweep)
Remaining `stream-b.txt` paths; list holds only `permanent` lines; new specs §4.3 B; findings file
complete.

Stream C order: C1 git shell and lists, C2 git lists and dialogs, C3 git dialogs, review, state, C4
Docker, C5 Automations, C6 workbench chrome, C7 sweep.

#### C1 (22)
`p/git-ui/src/App.vue`, `p/git-ui/src/components/AppToolbar.vue`, `p/git-ui/src/components/BranchPicker.vue`, `p/git-ui/src/components/CommitGrid.vue`, `p/git-ui/src/components/CommitMeta.vue`, `p/git-ui/src/components/ConflictBanner.vue`, `p/git-ui/src/components/DetailPane.vue`, `p/git-ui/src/components/EmptyRepositoryPanel.vue`, `p/git-ui/src/components/FailureBanner.vue`, `p/git-ui/src/components/FileTree.vue`, `p/git-ui/src/components/GlobalStashList.vue`, `p/git-ui/src/components/LoadMoreButton.vue`, `p/git-ui/src/components/NoRepositoryPanel.vue`, `p/git-ui/src/components/PullStrategyPicker.vue`, `p/git-ui/src/components/RefreshButton.vue`, `p/git-ui/src/components/RowActionsButton.vue`, `p/git-ui/src/components/SearchBox.vue`, `p/git-ui/src/components/SearchResults.vue`, `p/git-ui/src/components/StackList.vue`, `p/git-ui/src/components/StashDetailPane.vue`, `p/git-ui/src/components/StashList.vue`, `p/git-ui/src/components/TagList.vue`

#### C2 (22)
`p/git-ui/src/components/UndoButton.vue`, `p/git-ui/src/components/WorkingDetailPane.vue`, `p/git-ui/src/components/WorktreeList.vue`, `p/git-ui/src/components/dialogs/BranchDialog.vue`, `p/git-ui/src/components/dialogs/CheckoutDialog.vue`, `p/git-ui/src/components/dialogs/CherryPickDialog.vue`, `p/git-ui/src/components/dialogs/ForcePushDialog.vue`, `p/git-ui/src/components/dialogs/PostCheckoutPullDialog.vue`, `p/git-ui/src/components/dialogs/PreflightPrediction.vue`, `p/git-ui/src/components/dialogs/PullDialog.vue`, `p/git-ui/src/components/dialogs/RenameRefDialog.vue`, `p/git-ui/src/components/dialogs/RepoSettingsDialog.vue`, `p/git-ui/src/components/dialogs/ResetDialog.vue`, `p/git-ui/src/components/dialogs/RevertDialog.vue`, `p/git-ui/src/components/dialogs/StackDialog.vue`, `p/git-ui/src/components/dialogs/StashDialog.vue`, `p/git-ui/src/components/dialogs/TagDialog.vue`, `p/git-ui/src/components/dialogs/WorktreeDialog.vue`, `p/git-ui/src/components/gitBlockedCopy.ts`, `p/git-ui/src/components/openAllChangesAnnounced.ts`, `p/git-ui/src/components/openFileAnnounced.ts`, `p/git-ui/src/components/refBadges.ts`

#### C3 (15)
`p/git-ui/src/components/review/BaseSelector.vue`, `p/git-ui/src/components/review/ReviewCommentsPane.vue`, `p/git-ui/src/components/review/ReviewCommitRow.vue`, `p/git-ui/src/components/review/ReviewFilesPane.vue`, `p/git-ui/src/components/review/ReviewView.vue`, `p/git-ui/src/components/rowMenuModel.ts`, `p/git-ui/src/components/searchResultsModel.ts`, `p/git-ui/src/state/clipboardActions.ts`, `p/git-ui/src/state/detailActions.ts` (`copy(text, message)` takes a whole message), `p/git-ui/src/state/failureNotice.ts`, `p/git-ui/src/state/graphView.ts`, `p/git-ui/src/state/liveAnnouncements.ts`, `p/git-ui/src/state/ops.ts`, `p/git-ui/src/state/pr.ts`, `p/git-ui/src/main.ts` (only if a literal is found; the F4 install is already there)

#### C4 (29, split in two commits C4a/C4b of <=25)
C4a: `p/docker-ui/src/components/ContainerDetail.vue`, `p/docker-ui/src/components/ContainerEditView.vue`, `p/docker-ui/src/components/ContainerList.vue`, `p/docker-ui/src/components/ContainerOverview.vue`, `p/docker-ui/src/components/ContainerSizeSection.vue`, `p/docker-ui/src/components/ContainerTable.vue`, `p/docker-ui/src/components/DockerPanel.vue`, `p/docker-ui/src/components/EditField.vue`, `p/docker-ui/src/components/EditInPlaceSection.vue`, `p/docker-ui/src/components/EditPendingSummary.vue`, `p/docker-ui/src/components/EditRecreateSection.vue`, `p/docker-ui/src/components/EditRows.vue`, `p/docker-ui/src/components/EditSize.vue`, `p/docker-ui/src/components/EndpointChip.vue`, `p/docker-ui/src/components/EngineDiskSection.vue`
C4b: `p/docker-ui/src/components/EngineOverview.vue`, `p/docker-ui/src/components/ExecView.vue`, `p/docker-ui/src/components/ImageList.vue`, `p/docker-ui/src/components/InspectView.vue`, `p/docker-ui/src/components/LogsView.vue`, `p/docker-ui/src/components/NetworkList.vue`, `p/docker-ui/src/components/RecreateConfirmDialog.vue`, `p/docker-ui/src/components/ResourceDetail.vue`, `p/docker-ui/src/components/StatsView.vue`, `p/docker-ui/src/components/UnavailableState.vue`, `p/docker-ui/src/components/VolumeList.vue`, `p/docker-ui/src/lib/editDiff.ts`, `p/docker-ui/src/state/dockerExec.ts`, `p/docker-ui/src/wire.ts`

#### C5 (24)
`p/workbench/src/automations/AutomationsNewTab.vue`, `p/workbench/src/automations/AutomationsPanel.vue`, `p/workbench/src/automations/AutomationsStart.vue`, `p/workbench/src/automations/ParamsEditor.vue`, `p/workbench/src/automations/ScriptBodyField.vue`, `p/workbench/src/automations/ScriptDialog.vue`, `p/workbench/src/automations/run/AdeContextFields.vue`, `p/workbench/src/automations/run/ParamsForm.vue`, `p/workbench/src/automations/run/RunPreview.vue` (VarText kept), `p/workbench/src/automations/run/RunScriptDialog.vue`, `p/workbench/src/automations/runs/RunLog.vue`, `p/workbench/src/automations/runs/RunOutcomeBlock.vue`, `p/workbench/src/automations/runs/RunsSection.vue`, `p/workbench/src/automations/runs/ScriptRunView.vue`, `p/workbench/src/automations/runs/runText.ts`, `p/workbench/src/automations/schedule/ScheduleConfirmDialog.vue`, `p/workbench/src/automations/schedule/ScheduleFields.vue`, `p/workbench/src/automations/schedule/scheduleText.ts` (cron wording into plural messages), `p/workbench/src/automations/scriptActions.ts`, `p/workbench/src/automations/scriptVars.ts`, `p/workbench/src/automations/smart/McpServerTools.vue`, `p/workbench/src/automations/smart/McpToolsField.vue`, `p/workbench/src/automations/smart/SmartBadge.vue`, `p/workbench/src/automations/smart/SmartSettingsFields.vue`

#### C6 (21)
`p/workbench/src/automations/smart/ToolsField.vue`, `p/workbench/src/components/OpLogPanel.vue`, `p/workbench/src/components/SearchOptionToggles.vue`, `p/workbench/src/components/SettingsShell.vue`, `p/workbench/src/components/TabStrip.vue`, `p/workbench/src/components/TitleBarWindowActions.vue`, `p/workbench/src/components/TreeTwisty.vue`, `p/workbench/src/components/UpdateAvailableItem.vue`, `p/workbench/src/components/UpdateDialog.vue`, `p/workbench/src/components/WorkbenchShell.vue`, `p/workbench/src/components/opLog.ts`, `p/workbench/src/settings/fields/FontSizeField.vue`, `p/workbench/src/settings/fields/LogLevelField.vue`, `p/workbench/src/settings/fields/NotifyPromptsField.vue`, `p/workbench/src/settings/fields/RowDensityField.vue`, `p/workbench/src/settings/fields/WordWrapField.vue`, `p/workbench/src/state/createTerminalsStore.ts`, `p/workbench/src/tabs/scriptRunTabKind.ts`, `p/workbench/src/tabs/terminalTabKind.ts`, `p/workbench/src/terminal/useTerminalMount.ts`, `p/workbench/src/util/collectionMenu.ts`

#### C7 (sweep)
Remaining `stream-c.txt` paths (`W/prompts/**`, `W/state/createAppUpdateStore.ts` and others the
inventory missed); list holds only `permanent` lines; new specs §4.3 C; findings file complete.

Sizes: A 147 files (25/25/25/25/25/22 + sweep), B 145 (25/24/24/24/24/24 + sweep), C 133
(22/22/15/15+14/24/21 + sweep). Every chunk <=25.

### 4.3 Specs each stream writes (UI only: no backend change, so no flow test)

Literal expected strings, testid locators. Each stream writes all of its specs; "heavy fixtures" is
not a reason to skip.

**A** (`apps/kira-studio/tests/ui/`):
- `copy-wording.spec.ts`: delete connection confirm (title `Delete connection?`, body quotes the
  name, buttons `Cancel`/`Delete`, Cancel focused); clear HTTP response history confirm (title,
  `This can’t be undone.`, button `Clear`); SQS poll confirm button `Poll`; table row context menu
  labels pinned in final order (sentence case, `…` only where a dialog opens); collections empty
  state title and hint; `QueryState` failure (`Couldn’t load` + `Retry`) on a mocked bridge
  rejection; copy name from a menu announces `Copied name`; grid delete label `Delete 1 row` vs
  `Delete 2 rows`; command palette placeholder `Type a command` and title `Command palette`;
  settings pane `Reset to default`.
- `copy-coverage.spec.ts`: `setPseudoLocale`, then `expectCatalogText` on: title bar, mode switcher,
  project panel header and empty state, connection row menu, connection dialog (every tab), settings
  dialog (every pane), data view toolbar, column menu, cell menu, console toolbar, saved queries
  menu, explain result, definition view, documents toolbar, key-value view, stream view, HTTP request
  view (every tab, response empty), gRPC request view, collections panel menu, environments view,
  command palette, operations panel, DB MCP approval dialog, generate data dialog, cell editor dock.
  Fixture names via `allow`.

**B** (`apps/kira-space/tests/ui/`, `apps/kira-space/tests/mobile/`):
- `copy-wording.spec.ts`: remove repository confirm (title `Remove repository?`, body says files
  stay, button `Remove`); backlog delete confirm; force push dialog `Cancel`/`Force push`; abort
  rebase `Cancel`/`Abort`; take over `Take over`; plan board empty state; needs count plural
  (`1 session`, `2 sessions`); memory delete confirm; settings `Reset to default`.
- `copy-coverage.spec.ts`: plan board, task card menu, day menu, backlog page, needs page, task
  panel (every tab), workflows page and inspectors, run dialog, review window, GitPanel and its
  menus, repos dialog, repo file view toolbar, settings dialog (every pane), mobile access pane,
  memory panel, add memory dialog, import view, title bar.
- `tests/mobile/copy-wording.spec.ts`: take over confirm title and buttons, backlog empty state,
  pairing screen title. (Mobile build has no test hooks: no coverage spec; the static guard covers
  `M/`.)

**C**:
- Studio `tests/ui/copy-wording-docker-automations.spec.ts`: container context menu labels pinned;
  container delete confirm (`Delete container?`, `Delete`); empty container list; remove script
  confirm (`Remove script?`, `Remove`); run script dialog primary `Run`; tab strip menu `Close`,
  `Close others`, `Close to the right`, `Close all`.
- Studio `tests/ui/copy-coverage-docker-automations.spec.ts`: Docker panel lists, container detail
  tabs, container menu, edit view, Automations panel, script dialog, run script dialog, schedule
  fields, runs section, tab strip menu, update dialog, prompt host.
- Space `tests/ui/copy-wording-git.spec.ts`: branch row menu labels pinned (`Check out`, `New
  branch…`, `Rename…`, `Delete`); delete branch dialog; empty stash list; graph load failure
  `Couldn’t load the repository: …` + `Retry`.
- Space `tests/ui/copy-coverage-git.spec.ts`: graph toolbar, branch picker, commit detail, row
  menus, every git dialog (branch, checkout, cherry-pick, force push, pull, rename, repository
  settings, reset, revert, stack, stash, tag, worktree), review view.

**Foundation** (already listed): `scripts/copy/catalogRules.spec.ts`, `packages/theme/src/i18n/
types.check.ts`, `catalog_test.go`. No unit test for `t`, `CatalogText`, `pseudoMessages`,
`copyAndAnnounce` (thin wrappers, CLAUDE.md bar).

### 4.4 Catalog merge strategy (single file, three writers)

- Each stream writes only its own top-level namespaces; F0 seeded every namespace, so each is a
  multi-line object from the start.
- Sorted keys (Biome) put every insertion inside its namespace; two namespaces are always separated
  by at least two untouched lines (`  },` and `  "<next>": {`), so git merges the three streams'
  edits without conflict. A trailing-comma change touches only the stream's own last line.
- `biome check --write packages/theme/src/i18n/en.json` before each commit (lint fails otherwise).
- If a rebase ever reports a conflict in en.json: keep both sides' keys, run `biome check --write`,
  re-run lint. Never drop a key. A real conflict outside that pattern means ownership was wrong:
  stop and report.
- Cross-stream identical text (C3) can only appear at landing: the landing step promotes it to
  `common.*` (or the module `common`) in a landing commit and repoints both callers.

### 4.5 Disk and worktrees (12 GB free at plan time)

Each worktree needs its own `node_modules`, Wails bindings and `frontend/dist` (`sh
scripts/prepare-worktree.sh`, then `sh scripts/codegraph-setup.sh`); never symlink `node_modules`.
`/home/user/kira-v22-base` (`v2.2-fixes`) is not P265's; leave it.

1. Foundation: create `kira-p265-f1`, `-f2`, `-f3` (branches `p265-f1..3`) off the F0 tip, one at a
   time, each only with >= 2.0 GB free after the previous one's install (`df -h /home/user`).
   Remove all three after landing (`git worktree remove`, `git worktree prune`, `git branch -d`).
2. Streams: create A, B, C off the F4 tip the same way, >= 2.0 GB free before each. If short, C
   waits for the first stream to land and its worktree to go; C still branches off the F4 tip.
3. Keep >= 1.0 GB free while work runs; a worktree prunes only its own `test-results/` and
   `playwright-report/`.
4. A stopped stream resumes from its last commit in its worktree; never recreate it.

## 5. Risks, scope, guarantees, landing

### 5.1 What changes for the user

Text only. Every §2.4 rewording, for example: confirm dialogs get a question title and verb
buttons (`Cancel` everywhere); `Command Palette` → `Command palette`; `Reconnect & load` →
`Reconnect and load`; `Copy row(s)` → `Copy row`/`Copy rows`; `Could not load` → `Couldn’t load`;
`Color` → `Colour`; `Checkout` → `Check out`; status words capitalised; placeholders lose `…`;
straight quotes become curly. No behaviour, layout, testid, Go IPC or store-schema change. Native
menu labels unchanged.

### 5.2 Risks

- **Spec churn** (~1900 text assertions): streams update owned specs per changed string; the
  test-and-fix agent fixes the rest from findings and failures.
- **Visual baselines**: most PNGs with text change; re-recorded once, each diff inspected (§5.5).
- **Hot-path cost of `t()`**: never per cell or per row; resolved once per setup or render pass.
- **Module-scope `t()`** misses a future locale switch: U70.
- **Message syntax** (`@`, `|`, `{`) in plain text: C1 parses every value; literal `{'@'}`.
- **Values that drive logic** translated by mistake: rule §2.3; a stream that finds a label doubling
  as an id splits them (label key + unchanged id).
- **Typecheck time** with a ~2500-leaf key union: measured in F1 (§3.2).
- **Mobile bundle**: the whole catalog ships to the phone (~100 KB raw, ~30 KB gzip); accepted, lazy
  loading not required.
- **Go package under `packages/theme`**: one small package with `go:embed`; `go vet ./...` and
  golangci-lint include it; Biome and knip ignore `.go`.
- **Rebase conflicts**: none expected (§4.4); never merge PNGs (re-record after rebase).
- **Disk**: §4.5.

### 5.3 Testids stable

None renamed. Specs change only for a §5.1 wording effect.

### 5.4 Out of scope

Backend error messages (P266 item 2); Monaco, SlickGrid and xterm built-in UI text; a second
shipped locale; locale switch UI; RTL; accessibility (P266 excludes it too); looks and behaviour
(P262-P264); `apps/kira-studio/frontend/proto`; `apps/kira-space-vscode` (built artifact only).

### 5.5 Test and fix (one serial Sonnet, after landing)

On the landed `v2.0`, in order:

1. Apply every item in the three findings files (cross-owner spec updates, foundation gaps); delete
   the files once applied.
2. Tightening (typecheck proves every caller): `ConfirmOptions.title` required, `confirm`'s title
   default removed; `ConfirmDialogView` `cancelLabel` prop removed; `plural()` deleted from
   `format.ts`; old `copyAnnounced(text, what)` deleted; `check-catalog --unused` added to `lint`
   (dead keys deleted).
3. Fold allowlist `permanent` lines into `scripts/copy/check-copy.ts` as named exemptions with
   reasons; delete `scripts/copy-allowlist/`.
4. Suites, serial, each failure root-caused and fixed in a commit (none skipped, no
   `--no-verify`): `bun run test:unit`, `bun run test:ui:studio`, `bun run test:ui:space`,
   `bun run test:ui:space-mobile`, `bun run test:visual:studio`, `bun run test:visual:space`,
   `bun run test:flows:studio`, `bun run test:flows:space`, the `go test` set of §3.3 step 2.
   Visual: `test:visual:update:<app>`, open every changed PNG's diff and confirm only text changed
   (record each spec name and the text change), re-run without update, clean. Known load
   sensitivity (P264 known open items) is not a P265 failure; prove with the base when unsure.
5. Results under "Test and fix result": commits, suite counts, baselines re-recorded with reasons.

### 5.6 Landing

1. F0 on `v2.0`; F1-F3 as §3.3 intro; F4 on `v2.0`; "Foundation result"; background push.
2. Streams in worktrees (§4.5).
3. Each stream done (allowlist only `permanent`, specs written, findings file complete, lint and
   typecheck green) → in its worktree `git rebase v2.0`, run lint and typecheck, fix cross-stream C3
   duplicates in a `refactor(i18n): promote shared wording to common` commit, then in the main
   checkout `git merge --ff-only p265-<x>`. Background push after each.
4. Test and fix (§5.5), then close-out (§5.7), push, remove worktrees.

### 5.7 Close-out (sequential, after test and fix)

1. `docs/ARCHITECTURE.md` "Copy and i18n (P265)" final; "Known open items" gains: **Backend error
   messages are not in the catalog (P265).** About 580 `ipcerr` call sites keep English Go
   literals shown through `errorText`; P266 item (2) maps error codes to catalog text. Delete once
   P266 lands that. And: **Monaco, SlickGrid and xterm built-in text is not localised (P265).**
   Delete when a second locale ships and those engines get their locale packs.
2. Plan "Close-out result": exemptions kept (with reasons), key count per namespace, accepted
   wording shifts realised, anything parked (P266 collects parked items).
3. SPEC P265 result section and row `Done`.
4. Final `bun run typecheck`, `bun run lint`, `bun run test:unit` green.

## 6. Verification checklist (orchestrator, after close-out)

`D="apps/kira-studio/frontend/src apps/kira-space/frontend/src apps/kira-space/frontend/mobile packages/workbench/src packages/git-ui/src packages/docker-ui/src packages/kira-ui/src packages/theme/src packages/shared"`.

- One catalog file: `find apps packages -path '*/node_modules' -prune -o \( -name 'en.json' -o -name '*.i18n.json' \) -print` → only `packages/theme/src/i18n/en.json`.
- `bun scripts/copy/check-copy.ts` and `bun scripts/copy/check-catalog.ts --unused` exit 0;
  `bun run lint` runs both; `scripts/copy-allowlist/` absent.
- `jq '[paths(scalars)] | length' packages/theme/src/i18n/en.json` >= 2000; every namespace of §2.2
  present (`jq 'keys'`).
- `grep -rn "from 'vue-i18n'" --include=*.ts --include=*.vue $D` → only `packages/theme/src/i18n/`.
- `grep -rln "from '@theme/i18n'" --include=*.ts --include=*.vue $D | wc -l` >= 350.
- `grep -rn 'createApp(' --include=*.ts $D` sites each followed by `.use(i18n)` (6 sites: Studio,
  Space, mobile `main.ts`, git-ui `main.ts`, `reviewDecorations.ts`, `bootstrapShell.ts`).
- `grep -rnE '\$t\(|useI18n\(' --include=*.vue --include=*.ts $D` → only `packages/theme/src/i18n/`.
- `grep -nE '\(s\)|\.\.\.| & |\bColor\b|cannot|Could not' packages/theme/src/i18n/en.json` → only
  `example` keys.
- `grep -rn 'function plural' packages/workbench/src/behaviour/format.ts` → none;
  `grep -rn 'cancelLabel' $D` → none; `grep -n 'title?:' packages/workbench/src/state/confirmDialog.ts` → none.
- Go: `grep -rnE 'Label: +"' internal/shell apps/*/internal/appshell` → none;
  `grep -rln 'i18n.T(' --include=*.go apps internal | wc -l` >= 8; `go test
  ./packages/theme/src/i18n/` passes.
- Tests present and green: `scripts/copy/catalogRules.spec.ts`, `types.check.ts` in typecheck,
  `catalog_test.go`, the 9 UI spec files of §4.3 (Studio `copy-wording`, `copy-coverage`,
  `copy-wording-docker-automations`, `copy-coverage-docker-automations`; Space `copy-wording`,
  `copy-coverage`, `copy-wording-git`, `copy-coverage-git`; mobile `copy-wording`).
- `git diff --stat 48558ea9b..HEAD -- '*.go'` touches only the §1.2 cataloged files and
  `packages/theme/src/i18n/*.go`.
- Every suite of §5.5 step 4 green; every changed baseline listed in "Test and fix result".

## Foundation result

F0-F3 base: `8274838bd` (F0), `b45b48e26`, `e54d21f3b` (F3), `aa23a6fa8` (F1), `12576f8cd` (F2), `9f8ac0373` (fixes).

F4 commits:

- `fb530f5b2` refactor(theme,workbench): foundation text through the catalog
- `b41610447` refactor: native menus, notifications and dialogs read the catalog
- `46665ea6d` refactor: install i18n in every Vue app
- `88fa3558b` test: catalog coverage helper
- `5441c194a` chore(lint): per-stream copy allowlists
- `feb72a8a3` docs: copy and i18n rules
- this section (step 8)

Step 5 (seed stream namespaces): F0 seeds kept, no commit.

Typecheck wall time, `bun run typecheck` cold (tsbuildinfo cache removed), same machine:

| Tree | Cold |
|---|---|
| F0 tip `8274838bd` | 69 s |
| F1-F3 landed `9f8ac0373` | 62 s |
| F4 tip | 80 s |

F4 tip vs F0: +16 percent (under the 30 percent stop line). Warm run at F4 tip: 29 s. Run-to-run noise is about 10 s.

Allowlists after step 6 (whole-file entries, files owed a migration): stream-a 142, stream-b 144, stream-c 129, total 415. `foundation.txt` holds 2 permanent U67 lines. `pending.txt` deleted. Foundation-owned files have zero other hits.

Verified at the F4 tip: `bun run typecheck`, `bun run lint`, `bun run lint:dead`, `bun run test:unit` (1890 pass), `go build ./...`, `go vet ./...`, full `go test ./...`, `bun run lint:go` (0 issues), `build:test:studio`, `build:test:space`, `build:space-mobile`. No UI suite run. Test bundles carry `__kiraSetLocale`.

Deviations:

- `common.state.*` keys keep role leaves (`common.state.loading.loading`); `common.state.copied` omitted, callers use `common.copy.copied.announce`. Theme strings reuse `common.*` keys (`Spinner`, `SearchField`, `DialogHeader`, `SwatchRadio`, `RunState`, `ScriptProgress`) instead of new `theme.*` keys.
- Added `common.copy.copiedWhat.announce` (`Copied {what}`) for the `copyAnnounced` shim and `useCopy({ what })`.
- `useCopy().copy` takes `{ message }` as well as `{ what }`.
- `ShowMoreButton` renders `workbench.showMore.remaining.label` (`Show more (N remaining)`); the `step` prop stays for callers and no longer shows in the text.
- `TextPromptDialog` confirm button uses `common.action.save.label` (`OK` is banned; every caller names or renames something).
- `ConfirmOptions.title` stays optional; the fallback is `workbench.confirmDialog.title`. The store state default is `''`.
- `MIN_SERVER_VERSION` (shared) became an object of getters, so text resolves at read time and `ConnectionDialog` stays unchanged. `grpcStreamingLabel` now returns `Stream`/`Unary`.
- `packages/shared/tsconfig.json` is new and `packages/workbench/tsconfig.json` gains `@theme/*`, so `bun test` resolves `@theme/i18n`. `packages/api-core/tsconfig.json` gains `@theme/*` and `../workbench/env.d.ts` (shared reaches the i18n index, which re-exports a `.vue` file).
- `useRelativeTime` builds its VueUse options per call (`justNow` is a plain string there).
- Spec wording updated in foundation scope: `tests/unit/sql-lint.spec.ts` (lint messages are catalog sentences now), `tests/ui/connections.spec.ts` (SQLite hint), contract fixtures `prompts-route.json` (both apps) and `dbmcp-route.json` (prompt titles lose the trailing `?`, per the catalog).
- Space `main.ts` had no `__KIRA_DEBUG_HOOKS__` block; F4 added a one-line `if (__KIRA_DEBUG_HOOKS__) installCopyTestHook();` there.
- `app.use(i18n)` not added to `apps/kira-studio/frontend/proto` (dev prototype, no `CatalogText`; `t()` needs no plugin).
- Permanent lines in `scripts/copy-allowlist/foundation.txt`: `packages/shared/protocol/frame.ts` (protocol decode diagnostic, same class as backend errors, P266) and `packages/theme/src/components/ui/button/index.ts` (`title` is a variant name). Close-out folds them into `check-copy.ts`.
- Catalog duplicates (C3) from F0 seeds still covered by `ALLOWED_DUPLICATES`; not tightened (carry to close-out).
- Not pushed (caller instruction).

## Streams result

Streams A (Kira Studio), B (Kira Space, mobile, memory), C (git-ui, docker-ui, workbench) ran as worktrees `p265-a`, `p265-b`, `p265-c` off `51527fd7e`. Landed in order C, B, A with fast-forward merges, then fixed in close-out commits. No UI, visual, e2e suite ran; the specs below are written, not run.

Commits on `p265-c`: `4fdbc079d` C1, `f1fffde2a` C2, `5f9d93fa0` C3, `c73df4c8a` C4a, `fd11e2349` C4b, `96bec73e2` C5, `73ffe590d` C6, `d5bcda4ad` C7 sweep, `0d9afa666` specs.
Commits on `p265-b`: `bdac2440d` B1, `ba93c66b0` B2, `2ce1d8df6` B3, `83ef2c076` B4, `5b661a746` B5, `523742681` B6, B7 sweep and specs (see `git log`).
Commits on `p265-a`: `2c856487e` A1, `68b1962e3` A2, `f643e6969` A3, `50353e362` A4, `416393557` A5, `3f03f76e6` A6 stream and views, `c2262bc07` A6 workbench, `d27b5b816` A7 sweep, `2dc641bc9` specs.

Close-out fixes:

- Cross-stream C3/C4 duplicates (about 100 keys) promoted to `common.*`, callers repointed in the same commit. Wording unified: generic placeholders (`{first}`/`{second}`, `{name}`, `{value}`, `{position}`), `New branch` and `Force push` without ellipsis, `No output yet.`, `Connecting…`, git worktree start point example `origin/main`.
- `nodeKindLabel` view uses `common.view.label`.
- `SettingsShell` takes a required `sectionLabels` prop; ids stay the testid and deep-link key. Studio and Space pass catalog labels (mode label `API`). Both coverage specs dropped their section-name `allow` patterns.
- `ALLOWED_DUPLICATES` is empty. Unused `*.module.title` seed keys deleted.
- Unit specs `ade-v2-dialog.spec.ts` and `ade-v2-board-parity.spec.ts` follow the new wording (`Needs you`, `sent back`).
- Allowlists in `scripts/copy-allowlist/` hold permanent lines only.

### Specs written, not run

- Studio: `copy-wording.spec.ts`, `copy-coverage.spec.ts`, `support/copyScenarios.ts`, `copy-wording-docker-automations.spec.ts`, `copy-coverage-docker-automations.spec.ts`.
- Space: `copy-wording.spec.ts`, `copy-coverage.spec.ts`, `copy-wording-git.spec.ts`, `copy-coverage-git.spec.ts`; mobile `copy-wording.spec.ts` and `support/mockServer.ts` (`replies.board` override).
- Expect tuning on first run: `allow` patterns for fixture data, selectors, mocked git preflight shapes (`preflight.*`, `remote.pushPreflight`, `remote.pullPreflight`, `repoSettings.get`), boot error via `'app.init': null`, a surface that caches `t()` at setup under the pseudo-locale, Studio context-menu label extraction via `.flex-1`, QueryState trigger via Docker `Containers` error.
- `apps/kira-studio/tests/ui/automations-module.spec.ts:406` (Stream C): collection delete confirm is now `“Backend” and everything inside it will be deleted. This can’t be undone.` under title `Delete collection?`.
- `copy-wording-git.spec.ts` pins the commit row menu as `New branch` (no ellipsis).

### Deviations

Stream A:
- Colour names show as raw palette ids. Engine plan-node labels, SQL keywords and code samples stay as-is.
- `bodyBadgeLabel` in api-core is unused.
- `timestamp.ts` `MONTH_ABBR` stays: data formatting. KeyValuePane data-type strings (`s3 object field`, `redis <type>`) stay.
- `beautify.ts` is worker-bound; workers cannot import `t`.
- `Kira Studio` app-name args in `appUpdate.ts` and `main.ts` stay: module top-level `t` is banned by U70.
- `studio.api.curl.dynamicValues.hint` dropped the `{{$…}}` sample.
- Font group `On this Mac` is now `Installed`. Mode label `Api` is now `API`.
- Stream C committed the Docker/automations specs; Stream A wrote none of them.
- Checker: C6 treats the word after ` — `, `: ` and `. ` as a sentence start, so a lowercase word there fails; messages were reworded. `AI`, `SSO`, `PII`, `CDATA`, `DOCTYPE` are not in `PROPER_NOUNS`.

Stream B:
- Memory delete confirm spec covers the discard-import confirm; no other memory delete confirm exists.
- Plan board empty state spec uses the no-repositories view (`space.ade.view.empty.*`).
- Needs plural spec checks the footer `1 interactive session`.
- Left literal on purpose: Claude prompt text in `ade/v2/dialog/compose.ts` and `board/runMessage.ts`; persisted `MANUAL_REASON` in AddMemoryDialog; weekday and month names; server run notes; `formatRelativeDate` and `formatAbsoluteDate` from `@kira/git-core`; raw palette colour names in swatch tooltips and menus; `needsYou` scope shows raw `runsOn` ('each repo'; parity spec compares it lowercase); product name `Kira Space` passed to `createAppUpdateStore`.
- Checker: `PROPER_NOUNS` lacks PATH, MB, AC, Max, Agents; worded around. Plural `{count}` shows no thousands separator in search results.
- Shared fields `LogLevelField`, `FontSizeField` are Stream C.

Stream C:
- Container delete confirm has no flow in the app; the spec pins the recreate confirm (`Recreate container?`, `Recreate now`).
- Branch row menu pins `Rename`, not `Rename…`: `common.action.rename.label` has no ellipsis and renaming from the picker is an inline field.
- No delete branch dialog exists; the spec pins the force delete prompt (`“name” is not fully merged.`, `Force delete`).
- Force push body gets a second message when the remote has no tip, replacing the literal `nothing yet`.
- Search field labels, ref decoration labels and stack counts are capitalised catalog text.
- `Apply here (from {origin})` keeps its wording.
- Setup-time `t()` constants became `computed` so they follow locale switches: operations log status filter, runs filter, script dialog tabs, schedule presets, row density items.

### Leftovers

- Allowlists hold 9 permanent lines: foundation 2 (`protocol/frame.ts`, `button/index.ts`), stream-a 4, stream-b 1, stream-c 2 (check `scripts/copy-allowlist/*.txt`).
- `check-catalog --unused` (C10) reports 13 unused keys, among them `workbench.module.title`, `common.state.saving.loading`, `backend.prompt.*.title`. Not part of `bun run lint`.
- Go tests `grpcflow` (protojson whitespace) and `queryplan` `TestParityFixtures` fail; no Go file changed since `51527fd7e`.

## P265 result

Status: Done. Test-and-fix and close-out commits on top of `924d41691`, nothing pushed.

### Commits

- `8eb9a85dc`, `8d65d55d1`: worker-safe i18n index, `CatalogText` imported directly (SFC re-export broke the Vite worker and the Playwright Node loader).
- `45cc18f1d`, `1f0eb0b98`: untranslated text the new specs found, now in the catalog (body modes, system font, command dialog, default request title, workflow edge and checklist aria labels).
- `0ef9ceea8`, `3add21351`: spec tuning, coverage helper tracks marker depth across sibling text nodes, skips rich-text and flow-engine subtrees, skips derived switch aria-label.
- `49cc8dd0c`: close-out. `ConfirmOptions.title` required; `cancelLabel`, `plural()`, `copyAnnounced` shim removed; C10 on in lint; 4 keys deleted (the other 11 flagged keys are `backend.*` read from Go; C10 now scans `internal/`); allowlist directory folded into `scripts/copy/exemptions.ts` (9 permanent entries, each with reason; `ALLOWED_DUPLICATES` empty).
- `5a0b00d19`: real bug, search toolbars passed slot `#index` to a message with `{position}`, so the number never rendered; plus 14 Studio specs moved to catalog wording.
- `5767c767d`: mobile write specs confirm by `confirm-yes`, not the old label.
- `7c977a051`: visual baselines.
- `b46c24652`: Go plan issue messages match the catalog wording the parity fixtures pin (`queryplan` `TestParityFixtures`).
- `5169db3e3`: `grpcclient` compacts and re-indents protojson output; protojson randomises whitespace per build.

### Suites

- `test:unit`: 1884 pass.
- Studio `ui`+`ui-timing`: 21 failed on first run (20 spec wording expectations, 1 real bug above); 134 re-run after fixes green. `ui-timing`: 1 failed, `perf.spec.ts` scroll frame p95 80 ms against bound under 80 ms, load-sensitive known item, not loosened.
- Space `ui`: 477 pass.
- Mobile (ios, android): 57 pass, 4 failed first run (old confirm label), 12 pass after fix.
- Visual: Studio 13 baselines and Space 10 re-recorded; each diff inspected, text regions only (wording, ellipsis, label width), no layout or colour change. Studio: connection dialog, script dialog, data grid, console, http request view, schema dialog, workbench shell, settings Appearance/Data/Cache/Api/Database MCP/Advanced. Space: workflow graph (2), git repo settings, repositories dialog, row menu (narrower, shorter labels), stash dialog, settings Advanced/Appearance/Git/Memory.
- `go test ./...`, `lint`, `lint:go`, `lint:dead`, `typecheck`: green.

### Deviations

- Git menu "New branch" and "Force push" lost their ellipsis through the C3 duplicate rule. Kept as is, final decision.
- Plan said 13 unused keys; it was 15, mostly `backend.*` used from Go.
- The two Go failures were not P265 regressions: queryplan fixtures were reworded by Stream A while the Go port kept old text; protojson whitespace is random per build.
