# P4 — DDL tabs

> **Deliverable (SPEC §10).** Read-only DDL view, editable-ready model. *Small, independent.*

**Why this phase matters.** Two firsts land here that later phases will lean on without realising they
are leaning on them.

The first is that this is the first *read-only text* surface in the main area. P3 put CodeMirror in
a bottom panel fed by a grid cell; P4 puts it in a full tab fed by the server's own definition of an
object. That means P4 is where the tab model stops being single-purpose: `TabRecord.kind` becomes a
real discriminated union (`data | ddl`), the main view becomes a genuine kind-switch, and the toolbar
track learns that not every tab is a data grid. Getting that shape right here — one extra arm,
cheaply — is what lets P5.5's console, P8's document view and P9's key-value view each slot in
without re-litigating how tabs work.

The second is the "**editable-ready model**" promise. §1 says DDL is read-only *but modelled for
editing*, and §10 names that model as half the deliverable. That is a forward-compatibility
contract: the DDL must not arrive as a bare string glued into a textarea. It arrives as a typed
`SourceText` with object identity (`path`, `objectKind`, `name`) and statement boundaries, so a
future edit phase can target one statement and diff it against the original without re-deriving
structure. The cost of that promise is one Zod schema and one pure, dialect-aware statement splitter;
both are exercised here and paid for now.

The one place this phase is *not* small is Postgres table DDL, and that is honest to the domain:
Postgres has no `SHOW CREATE TABLE`. Views and functions are exact one-liners
(`pg_get_viewdef` / `pg_get_functiondef`); tables, matviews and sequences have to be **reconstructed**
from the catalog, which is the same best-effort DataGrip/DBeaver make. MariaDB, by contrast, is
`SHOW CREATE` all the way down. That asymmetry is a feature of this phase — it is the first proof
that two adapters can produce the *same* `SourceText` shape through genuinely different machinery.

---

## 0. Ground rules for this phase

**Read first.** `docs/SPEC.md` §1, §5, §5.1, §7, §8.4, §8.10, §9; `docs/plans/P1-connections-and-tree.md`
§0, §1 (D1–D22), §3a (`ObjectMeta`), §4b (adapter roadmap); `docs/plans/P2-tabular-data-view.md`
§0, §3.4 (tabs), Step 8 (tabs runtime), Step 9 (`MainView` switch); `docs/plans/P3-cell-editor.md`
§0, §1 (D10 CodeMirror deps, D11 one-editor discipline). P4 does not restate these; it extends them,
and where it changes one it says so with a D number.

**Standing rules carried forward from P1/P2/P3** (unchanged unless a D below says otherwise):

1. Zod-validate at every trust boundary: IPC in main, port/control frames in the engine, anything
   read back out of SQLite.
2. The renderer never receives a password.
3. Every DB call goes through `runOp` so it lands in the op log with a working stop button.
4. `AdapterError` codes are a closed set; the server's message is preserved verbatim.
5. No `any`. No non-null assertions on values that cross a process boundary.
6. Every UI surface gets a stable `data-testid`.
7. Never interpolate a database identifier that did not come from cached catalog metadata, and only
   through the adapter's `quoteIdent` (P2 D12).

**P2/P3 facts P4 builds on** (verified against the tree as of this plan's writing; P2/P3 are
mid-flight, so these are the *planned* seams — flag any that have not landed when you get there):

| Artifact | Where | What P4 uses it for |
| --- | --- | --- |
| `ObjectMeta` / `nodeKindSchema` (`routine` present) | `shared/tree.ts` | `objectKind` on `SourceText`; DDL-bearing node kinds |
| `MetaKind` merge-payload cache (`children`/`describe` in one row) | `main/storage/metadata-cache.ts` | DDL is a third slot in the same row (D2) |
| `TreeService` cache-aside (`children`/`describe`/`invalidate`) | `main/tree-service.ts` | `ddl()` is a fourth method, same shape |
| `ENGINE_OP` + Zod payload schemas + `control.ts` dispatch | `shared/engine-ops.ts`, `engine/control.ts` | `adapter:ddl` joins them |
| `IPC` const + `KiraApi` + preload wiring | `shared/ipc.ts`, `preload/index.ts` | `kira:tree:ddl` |
| `TabRecord`/`DataTabState`/`tabRecordSchema` | `shared/tabs.ts` | the discriminated union (D1) |
| tabs runtime (`state/tabs.ts`, `MainView` switch, `Toolbar.vue`) | `renderer/workbench/…` | the `ddl` arm |
| CodeMirror deps + theme (P3 D10, `celleditor/theme.ts`) | `package.json`, `renderer/workbench/celleditor/` | the read-only editor, reused verbatim |
| `quoteIdent` (P2 D12) | adapters | reconstructed DDL identifiers |

**Out of scope for P4.** Do not build these:

| Not in P4 | Where it lands |
| --- | --- |
| **Editing** DDL, diffing, applying a changed statement | §1 defers DDL editing; the model is *ready*, the editor is not |
| Structure tab / per-column detail alongside the DDL | not a §8.10 item; out of v1 |
| DDL for `database`/`schema`/`connection` nodes | §8.10 lists "Open DDL" under table/view only — object-level DDL only |
| `EXPLAIN` / `explain` method on the adapter | never a v1 roadmap row; do not add |
| Copy DDL to clipboard as a *file* / export | P6 (copy/paste matrix) — P4's Copy DDL copies text only |
| Query console, `saved_queries` console entries | P5.5 |
| Document / key-value / stream tabs | P8 / P9 / P10 |

**Test commands.** `bun run typecheck`; `bun run test:db` (pure splitter runs without Docker; the
adapter `ddl` specs need Colima); `bun run test:ui`. A skip is not a pass.

---

## 1. Decisions

| # | Decision | Rationale |
| --- | --- | --- |
| **D1** | **The DDL tab kind is `ddl`, not `object`.** `tabRecordSchema` becomes a discriminated union on `kind` with `dataTabStateSchema` and a new minimal `ddlTabStateSchema`; the P2 comment "P4 adds 'object'" is corrected in the same edit. | §8.4 lists `ddl` as a tab kind verbatim (`data`, `ddl`, `document`, `keyvalue`, `stream`, `console`); 'object' was a placeholder in the P2 plan that never survived the spec. One union now means P5.5/P8/P9/P10 each add an arm, not a migration. |
| **D2** | **DDL is L1 metadata: it routes renderer → main → engine over IPC, cache-aside in `metadata_cache` as a third `ddl?` slot in the existing `(connection_id, path)` row. No TTL, no L2/L3, no port op.** | §7's L1 list is explicit — "databases, schemas, tables, columns, PK/FK, indexes, **DDL**". L1 lives in SQLite in main (P1 D10) and DDL inherits its whole invalidation story for free: reconnect drops the connection's cache (P1 D11), manual *Refresh* drops the path, deleting the connection cascades. Routing it any other way would fork the cache for no gain. |
| **D3** | **`SourceText` is a Zod-validated structured model, not a bare string.** `{ kind: 'ddl', path, objectKind, name, qualifiedName, text, statements[], elapsedMs, fromCache }`. `text` is the full DDL verbatim; `statements` is the edit-ready structure. | This is the concrete form of "modelled for editing" (§1, §10). The Zod parse is the ordinary standing-rule-1 path — DDL is tens of KB of *text*, not megabytes of typed arrays, so unlike `TabularPage`/`CellPayload` it is validated at the boundary like every other metadata payload. |
| **D4** | **Statement boundaries come from a shared, pure, dialect-aware splitter `splitSqlStatements(text, dialect)` — quote, comment and dollar-quote aware.** The adapter calls it (it knows its dialect), so the cached `SourceText` already carries `statements`; the renderer only consumes. | "Editable-ready" is empty if the edit phase must first re-learn how to find statements. One pure function, tested against the semicolon-in-string / semicolon-in-dollar-body / semicolon-in-comment traps, is the entire edit-enabling primitive — and putting it in `shared/` makes it Bun-testable exactly like P2's encoder and P3's detector. |
| **D5** | **Postgres DDL is *exact* for views and functions (`pg_get_viewdef`, `pg_get_functiondef`) and *reconstructed* for tables, matviews and sequences from the catalog. MariaDB DDL is *exact* for everything (`SHOW CREATE …`).** The adapter reports the primary command via `ctx.setCommand`. | Postgres simply has no `SHOW CREATE TABLE`; reconstruction from `pg_attribute`/`pg_constraint`/`pg_index`/`pg_get_*` is what the reference tools do and is the only honest option. The split is recorded so the "exact vs reconstructed" asymmetry is a documented property, not a surprise found in the op log. MariaDB's `SHOW CREATE` is byte-exact, which is precisely why it is the cheap second witness here. |
| **D6** | **"Open DDL" is a context-menu item on `table`/`view`/`matview`/`function`/`sequence` (Postgres) and `table`/`view`/`routine` (MariaDB), gated by `caps.ddl`; it opens or focuses a `ddl` tab for that path.** | §8.10 lists "Open DDL" on the object row; `caps.ddl` is the per-adapter gate that keeps it off Mongo in P8. Focus-vs-new mirrors P2 D16's tab identity rule — the same object's DDL should not open twice unless the user asks. |
| **D7** | **`ddlTabState` is `{ scrollTop, selectedStatement }` and nothing else; the DDL text is never persisted in the tab.** A restored DDL tab renders the P2 "Reconnect & load" placeholder and re-fetches. | The DDL text already has a home — L1, on disk — so persisting a second copy in `tabs.state_json` is a coherence bug waiting to happen. Tab state stays minimal, exactly as selection and search state stay out of `DataTabState` (P2 §3.4). |
| **D8** | **`DdlView.vue` owns its chrome: a read-only CodeMirror (SQL highlighting, line numbers, P3's theme) plus a thin toolbar — object name + kind, Refresh, Copy DDL, and a statement outline that jumps the cursor.** `Toolbar.vue` renders nothing for non-`data` tabs. | The document/key-value/stream views of P8–P10 will each own their toolbar too (they are different beasts, not data-grid variants). Making the DDL view self-contained — and making the shared `Toolbar` kind-aware rather than DDL-aware — is the forward-compatible shape. |
| **D9** | **`opKindSchema` gains `'ddl'`; `ENGINE_OP.ddl = 'adapter:ddl'`.** The op logs `rows: 1` (one object) and the command per D5. | DDL is a server read the user asked for; it must be visible and cancelable in the ops panel like every other read. `runOp` gives that for free; the only new surface is the enum entry and the dispatch arm. |
| **D10** | **`MetaKind` gains `'ddl'`; `TreeService.ddl()` mirrors `children`/`describe` exactly.** A `refresh: true` skips the cache and overwrites; an invalid payload is dropped and treated as a miss. | The existing read-modify-write in `metadata-cache.ts` already merges slots under one row, so DDL is a one-enum-entry addition with zero new storage behaviour to reason about. |

---

## 2. Target file tree

Only new (`+`) and modified (`~`) files. Everything else stays as it is.

```
src/
  shared/
    ~ ops.ts                          ~  opKindSchema += 'ddl' (D9)
    ~ engine-ops.ts                   ~  ENGINE_OP.ddl = 'adapter:ddl'; ddlPayloadSchema
    ~ ipc.ts                          ~  treeDdl channel + TreeDdlPayload/TreeDdlResult + KiraApi.treeDdl
    ~ tabs.ts                         ~  kind union 'data' | 'ddl' + ddlTabStateSchema (D1)
    + ddl.ts                          +  SourceText/SourceStatement schemas + splitSqlStatements (D3, D4)
  main/
    ~ ipc.ts                          ~  register IPC.treeDdl → tree.ddl(...)
    ~ tree-service.ts                 ~  ddl() cache-aside method (D10)
    ~ storage/metadata-cache.ts       ~  MetaKind += 'ddl'
  engine/
    ~ control.ts                      ~  dispatch ENGINE_OP.ddl → adapter.ddl inside runOp (D9)
    adapters/
      ~ adapter.ts                    ~  declare ddl(); P4 row in the roadmap is now implemented
      postgres/
        + ddl.ts                      +  pg_get_viewdef/functiondef + catalog reconstruction (D5)
        ~ index.ts                    ~  wire ddl(); splitSqlStatements(text, 'postgres')
      mariadb/
        + ddl.ts                      +  SHOW CREATE TABLE/VIEW/PROCEDURE/FUNCTION (D5)
        ~ index.ts                    ~  wire ddl(); splitSqlStatements(text, 'mariadb')
  preload/
    ~ index.ts                        ~  treeDdl
  renderer/
    bridge/
      ~ control.ts                    ~  treeDdl wrapper
    workbench/
      panels/
        ~ MainView.vue                ~  ddl tab branch (D1)
        ~ Toolbar.vue                 ~  render nothing for non-data tabs (D8)
      + DdlView.vue                   +  read-only CodeMirror DDL view + toolbar + outline (D8)
      state/
        ~ tabs.ts                     ~  openDdl(connectionId, path) action + ddl tab runtime status
    project/
      ~ menus.ts                      ~  "Open DDL" item on DDL-bearing node kinds (D6)
tests/
  db/
    + ddl.spec.ts                     ~  splitter (pure) + adapter ddl against containers
  ui/
    + ddl-view.spec.ts                ~  open DDL, render, copy, outline jump, refresh, reconnect
```

No package.json change: CodeMirror and `lang-sql` landed in P3. No schema/migration change: `tabs.kind`
is `TEXT` and the union is parsed on read; existing `data` rows are unaffected.

---

## 3. Shared contracts

This is the section everything else hangs off. Get these exactly right before writing any behaviour.

### 3.1 `src/shared/ddl.ts` — the DDL wire format and the splitter

```ts
import { z } from 'zod';
import { nodeKindSchema } from './tree';

export type SqlDialect = 'postgres' | 'mariadb';

// The edit-ready model: one top-level statement with its position in `text`. The future edit phase
// targets a statement by index and diffs its text against `SourceText.text`.
export const sourceStatementSchema = z.object({
  /** 0-based line of the statement's first line in `text`. */
  startLine: z.number().int().min(0),
  /** 0-based line of the statement's last line in `text`. */
  endLine: z.number().int().min(0),
  /** First up-to-two significant tokens, e.g. "CREATE TABLE", "CREATE INDEX idx", "ALTER TABLE". */
  label: z.string(),
});
export type SourceStatement = z.infer<typeof sourceStatementSchema>;

// DDL-bearing kinds only: table, view, matview, function, sequence, routine. A column/schema/…
// path never produces a SourceText (D6).
export const ddlObjectKindSchema = nodeKindSchema.refine(
  (k) => ['table', 'view', 'matview', 'function', 'sequence', 'routine'].includes(k),
  'not a DDL-bearing object kind',
);

export const sourceTextSchema = z.object({
  kind: z.literal('ddl'),
  path: z.string(),                 // encoded NodePath of the object
  objectKind: ddlObjectKindSchema,
  name: z.string(),
  qualifiedName: z.string(),
  /** Full DDL, verbatim. Reconstructed for Postgres tables/matviews/sequences, exact otherwise (D5). */
  text: z.string(),
  statements: z.array(sourceStatementSchema),
  elapsedMs: z.number(),
  fromCache: z.boolean(),
});
export type SourceText = z.infer<typeof sourceTextSchema>;
```

`SourceText` is Zod-validated in `main` on the way out of the cache and on the way back from the
engine (D3) — the ordinary boundary path, unlike `TabularPage`/`CellPayload`.

```ts
// Pure, dialect-aware, Bun-testable. Returns top-level statements in order; a `;` inside a quoted
// string, a block/line comment, or (postgres) a dollar-quoted body is NOT a boundary. Consecutive
// separators (`;;`) and a trailing separator produce no empty statements.
export function splitSqlStatements(text: string, dialect: SqlDialect): SourceStatement[];
```

Splitter rules, in prose so the implementation cannot drift:

- Scan left to right tracking line number and a lexical state: `'single'`, `"double"`, `--line`,
  `/*block` (nestable), and for `postgres` only, `$dollar` (recognise both `$$` and `$tag$…$tag$`,
  `tag` = `[A-Za-z_][A-Za-z0-9_]*`; `$1` is *not* a dollar-quote opener).
- A `;` at depth 0 (all states idle) closes a statement. The statement text is the accumulated span
  trimmed of leading/trailing whitespace; `startLine`/`endLine` are the first/last line it occupies.
- `label` is the first two whitespace-separated significant tokens (stop at `(`), joined with a space.
- MariaDB never enters the `$dollar` state (its `$` has no quoting meaning), but it does support
  backtick identifiers — treat `` ` `` like a double-quote in both dialects.

The Bun tests (no Docker) assert: a `;` inside `'a;b'` and inside `"a;b"` does not split; a function
body with `$$ BEGIN … ';' … END $$` is one statement for postgres and *multiple* for mariadb (the
dialect flag is load-bearing); `--` and `/* */` comments swallow `;`; `;;` and a trailing `;`
produce no empty statements; `startLine`/`endLine` are correct across a multi-line statement.

### 3.2 `src/shared/tabs.ts` — the kind union (D1)

Replace the single-object schema with a discriminated union; the `data` arm is byte-identical to
today so no persisted row changes shape:

```ts
export const ddlTabStateSchema = z.object({
  scrollTop: z.number().default(0),
  /** Index into SourceText.statements, for the outline highlight. null ⇒ no selection. */
  selectedStatement: z.number().int().nullable().default(null),
});
export type DdlTabState = z.infer<typeof ddlTabStateSchema>;

const tabBaseSchema = z.object({
  id: z.string(),
  connectionId: z.string(),
  path: z.string(),
  order: z.number().int(),
  active: z.boolean(),
});

export const tabRecordSchema = z.discriminatedUnion('kind', [
  tabBaseSchema.extend({ kind: z.literal('data'), state: dataTabStateSchema }),
  tabBaseSchema.extend({ kind: z.literal('ddl'), state: ddlTabStateSchema }),
]);
export type TabRecord = z.infer<typeof tabRecordSchema>;
```

Fix the "P4 adds 'object'" comment. `main/storage/tabs.ts`'s `getAllTabs` already drops rows that
fail to parse, so a stale or hand-edited row degrades to "not restored" rather than bricking launch.

### 3.3 `src/shared/engine-ops.ts` and `src/shared/ipc.ts` — the channel

```ts
// engine-ops.ts — control-channel op, mirroring children/describe.
export const ENGINE_OP = {
  // …existing…
  ddl: 'adapter:ddl',
} as const;

export const ddlPayloadSchema = z.object({ connectionId: z.string(), path: z.string() });
export type DdlPayload = z.infer<typeof ddlPayloadSchema>;
```

```ts
// ipc.ts — renderer → main, L1 cache-aside in main.
IPC.treeDdl = 'kira:tree:ddl';

export interface TreeDdlPayload { connectionId: string; path: string; refresh?: boolean }
export interface TreeDdlResult { ddl: SourceText; source: 'cache' | 'server' }
// KiraApi: treeDdl(payload: TreeDdlPayload): Promise<TreeDdlResult>
```

### 3.4 `Adapter` addition (`src/engine/adapters/adapter.ts`)

The roadmap comment already names P4's row. Declare the method for real:

```ts
/** DDL for one object. Reconstructed (pg tables) or exact (views/functions, MariaDB) per D5. */
ddl(path: NodePath, ctx: OpCtx): Promise<SourceText>;
```

Rules: runs inside `runOp({ connectionId, kind: 'ddl' })`, calls `ctx.setCommand` before executing
(D5 — `SHOW CREATE …` for MariaDB, the primary reconstruction query or `pg_get_*` call for
Postgres), `ctx.setRows(1)` after, honours `ctx.signal`, and throws `E_UNSUPPORTED` when
`caps.ddl === false` (a defensive guard for future adapters; both P4 adapters have `caps.ddl:
true`). Identifiers are quoted with the adapter's `quoteIdent` (P2 D12), never interpolated from
free text — every name comes from `path.segments` (cached catalog metadata).

---

## 4. Implementation steps

Five steps. Each is independently demonstrable — stop after any one and the app still builds,
typechecks and runs.

---

### Step 1 — Shared contracts and the splitter

**Files:** `src/shared/ddl.ts` (new); `src/shared/{ops,engine-ops,ipc,tabs}.ts` (modified);
`tests/db/ddl.spec.ts` (new, pure describe only).

Write §3 verbatim. `ops.ts` += `'ddl'` (and fix the enum's trailing comment); `engine-ops.ts` +=
`ENGINE_OP.ddl` + `ddlPayloadSchema`; `ipc.ts` += `treeDdl` + payload/result types + `KiraApi.treeDdl`;
`tabs.ts` becomes the D1 union. Add the pure `splitSqlStatements` describe from §3.1.

**Acceptance.** `bun run typecheck` clean; `bun run test:db` passes the splitter describe (no
Docker). No behavioural change.

---

### Step 2 — Adapter `ddl`: Postgres, then MariaDB

**Files:** `src/engine/adapters/postgres/{ddl.ts,index.ts}`,
`src/engine/adapters/mariadb/{ddl.ts,index.ts}`; `tests/db/ddl.spec.ts` (extended).

**Postgres** (`ddl.ts`), keyed on the object kind from the decoded path:

- **view** — `SELECT pg_get_viewdef(oid, true) FROM pg_class c JOIN pg_namespace n … WHERE relname = $1 AND nspname = $2` (or resolve via `to_regclass`), wrapped as `CREATE OR REPLACE VIEW <quoted> AS\n<def>`. **Exact.**
- **matview** — same `pg_get_viewdef`, wrapped as `CREATE MATERIALIZED VIEW <quoted> AS\n<def>`. **Exact** for the query body.
- **function** — `SELECT pg_get_functiondef(oid)` resolved by name + argument signature (use
  `pg_proc.oid::regprocedure`; the arg-less `name` lookup is ambiguous and must error rather than
  guess). **Exact.**
- **sequence** — reconstruct `CREATE SEQUENCE` from `pg_sequence` + the sequence's column type:
  `AS <type>`, `INCREMENT BY`, `MINVALUE`/`MAXVALUE`, `START WITH`, `CACHE`, `CYCLE`/`NO CYCLE`.
- **table** — reconstruct `CREATE TABLE` from the catalog: columns from `pg_attribute` (attnum > 0,
  not dropped) with `format_type(atttypid, atttypmod)`, `NOT NULL`, defaults via
  `pg_get_expr(adbin, adrelid)`, identity/generated columns; constraints via `pg_get_constraintdef`
  for PK/FK/UNIQUE/CHECK; indexes via `pg_get_indexdef(indexrelid)`; comments via
  `obj_description`/`col_description`. Reconstructed, not byte-identical to `pg_dump`, but complete
  and `CREATE`-able.

Every identifier is quoted via `quoteIdent`; every name is a bind parameter. `ctx.setCommand`
reports the primary query (`pg_get_viewdef`/`pg_get_functiondef` for those kinds, the `pg_attribute`
columns query for tables). Assemble the pieces, run `splitSqlStatements(text, 'postgres')`, and
return the `SourceText`.

**MariaDB** (`ddl.ts`): `SHOW CREATE TABLE \`db\`.\`t\``, `SHOW CREATE VIEW`, `SHOW CREATE
PROCEDURE`, `SHOW CREATE FUNCTION` — one statement per kind, parameter-bound database/name, the
second column of the result set (`Create Table`/`Create View`/…) is `text`. **Exact**, including the
client's own `;`/`DELIMITER`-free canonical form. `splitSqlStatements(text, 'mariadb')`.

**Acceptance.** `bun run test:db` against both containers: the Postgres view/function DDL round-trips
(`pg_get_viewdef`/`pg_get_functiondef` output present); a Postgres table's DDL contains `CREATE
TABLE`, its PK, every FK and every index, and re-`CREATE`s without error against a scratch schema;
the MariaDB table DDL is byte-identical to `SHOW CREATE TABLE`; every returned `SourceText` has
`statements` whose first entry is the `CREATE`, with correct `startLine`/`endLine`.

---

### Step 3 — Engine and main wiring (the L1 path)

**Files:** `src/engine/control.ts`, `src/main/storage/metadata-cache.ts`,
`src/main/tree-service.ts`, `src/main/ipc.ts`, `src/preload/index.ts`,
`src/renderer/bridge/control.ts`.

- `metadata-cache.ts`: `MetaKind = 'children' | 'describe' | 'ddl'`. Nothing else changes — the
  merged-payload read-modify-write already treats `kind` as a key into the row's JSON object.
- `control.ts`: a `ddl()` dispatch arm that `requireAdapter`s, drops the path's L2/L3 on refresh
  (matching `children`/`describe`), and runs `adapter.ddl(decodePath(...), ctx)` inside `runOp`
  with `kind: 'ddl'`, setting `rows: 1`.
- `tree-service.ts`: `ddl(connectionId, path, refresh)` mirroring `describe` — `getCached(…, 'ddl')`,
  `sourceTextSchema.safeParse`, drop-on-miss, `requireConnected`, `engineHost.call(ENGINE_OP.ddl, …)`,
  `putCached(…, 'ddl', …)`. Export it on the `TreeService` interface.
- `ipc.ts` (main): `handle(IPC.treeDdl, …)`; `preload/index.ts` + `bridge/control.ts`:
  `treeDdl(payload)`.

**Acceptance.** `bun run typecheck`; `bun run test:ui` — a scratch assertion (removed before commit)
that a second `treeDdl` for the same path returns `source: 'cache'`, a `refresh: true` call returns
`source: 'server'`, and the ops panel logs a `ddl` op whose `command` is non-empty.

---

### Step 4 — The `ddl` tab: state, entry point, and the kind switch

**Files:** `src/renderer/workbench/state/tabs.ts`, `src/renderer/project/menus.ts`,
`src/renderer/workbench/panels/{MainView,Toolbar}.vue`.

- `state/tabs.ts`: add `openDdl(connectionId, path)` — focus an existing `ddl` tab for that path,
  else create one (D6), and a `loadDdl(tabId)` action that calls `control.treeDdl` and holds the
  result in the tab's runtime (`status: 'idle'|'loading'|'ready'|'error'|'restored'`, a non-reactive
  `ddl: SourceText | null`, `error`), exactly as the data path holds `pageView`. Persist the minimal
  `ddlTabState` through the existing debounced `tabsReplace`.
- `menus.ts`: add **Open DDL** (codicon `code`) to the `table|view|matview` branch and the
  `sequence|function` branch, plus `routine` (MariaDB) — gated on the connection's adapter `caps.ddl`
  (read from the cached `ObjectMeta`-independent connection summary; the adapter caps are available
  via the existing connection state) and `isConnected`.
- `MainView.vue`: the kind switch gains `case 'ddl'` → `DdlView` (with `restored` → the existing
  `ReconnectPrompt`, `error` → the error state with the server's message, `loading` → spinner).
- `Toolbar.vue`: render the data toolbar only when the active tab's `kind === 'data'`; otherwise
  render an empty track (D8).

**Acceptance.** `bun run test:ui`: right-click a table → Open DDL → a tinted `ddl` tab appears with
the object's name; Open DDL on the same table again focuses the existing tab (no second tab); Open
DDL on a function shows its `CREATE OR REPLACE FUNCTION`; relaunch → the tab is restored as a
"Reconnect & load" placeholder that logs zero ops until pressed (assert via the op log).

---

### Step 5 — `DdlView.vue`

**Files:** `src/renderer/workbench/DdlView.vue` (new).

A read-only CodeMirror editor (reusing P3's `celleditor/theme.ts` and the one-`EditorView`
discipline), `lang-sql` highlighting, line numbers on, filling the tab body. The toolbar, left to
right: `object name` + a `kind` badge · **Refresh** · **Copy DDL** · **outline ▾** (the
`SourceText.statements`, each `label @ line`, selecting one scrolls the cursor to `startLine` and
sets `selectedStatement`). The toolbar is tinted with the connection colour like the tab strip.

- Refresh re-issues `treeDdl` with `refresh: true` (D10) and replaces the doc in place — the editor
  is reconfigured, not remounted.
- Copy DDL writes `SourceText.text` to the clipboard (P4 scope is text-only, D-table above).
- The outline is populated from `statements` and is a plain dropdown, not a tree — statement
  *nesting* is a later-edit-phase concern, not a v1 read-view concern.
- Empty/error/loading/restored states are the shared ones from `MainView.vue`'s switch.

**Acceptance.** `bun run test:ui`: the DDL renders with SQL highlighting and line numbers; Copy DDL
puts the exact server text on the clipboard; picking the second outline entry moves the cursor to
that statement's `startLine`; Refresh logs a second `ddl` op with `fromCache: false` in the toolbar
readout; a disconnected connection's restored DDL tab shows "Reconnect & load" and nothing else.

---

## 5. Risk register

| # | Risk | Likelihood | Impact | Mitigation / trigger |
| --- | --- | --- | --- | --- |
| R1 | Postgres table-DDL reconstruction diverges from `pg_dump` in a way that misleads the user (missing an index, wrong default quoting) | High | A DB tool showing subtly-wrong DDL is the worst kind of bug | Scope the guarantee honestly: reconstruction is *complete and CREATE-able*, not byte-identical (D5). Assert in Step 2 that the reconstructed table re-`CREATE`s without error and contains the PK/FK/index set from `describe` — cross-check against `ObjectMeta`, which is already tested. If a case cannot be reconstructed faithfully, fall back to `E_UNSUPPORTED` with the reason rather than emitting wrong DDL. |
| R2 | The statement splitter miscounts on a real function body (nested dollar-quotes, `$$` inside strings) | Medium | Outline jumps to the wrong line; future edit phase inherits the bug | The splitter is pure and Bun-tested (Step 1) against the semicolon-in-string/body/comment traps plus a dollar-quoted `BEGIN … END`. If a seed fixture exposes a new trap, it becomes a test case, not a one-off patch. |
| R3 | `pg_get_functiondef` ambiguity (overloaded function name) returns the wrong `oid` | Medium | Wrong DDL shown | Resolve by `regprocedure` (name + argument types) and *error* on ambiguity rather than `LIMIT 1`-ing a guess (Step 2). Overloaded-function DDL is a documented edge; a legible `E_NOT_FOUND` is better than silently-wrong text. |
| R4 | The `ddl?` slot in `metadata_cache` grows past the 4 MB guard for a huge table | Low | DDL not cached → re-fetched each open | The existing guard already skips caching and returns the value; the only cost is a slower re-open. No new code; note it in the commit. |
| R5 | The tab union breaks session restore of pre-P4 rows | Low | Restored tabs vanish | `getAllTabs` drops unparseable rows and the `data` arm is byte-identical, so old rows parse unchanged. Step 4's relaunch assertion covers exactly this. |
| R6 | `caps.ddl` read in the renderer is not plumbed, so "Open DDL" is either always-on or always-off | Low | Menu item wrong for MariaDB vs Postgres | Both P4 adapters have `caps.ddl: true`, so the gate matters only for P8+. Read it from the connection's adapter caps already surfaced by P1; if that is not exposed to the renderer, derive it from `kind` for now and add a `caps` surface in P8 when a `false` value first exists. |

---

## 6. Open questions (decide during, record in the commit)

1. **Where does the renderer read `caps.ddl`?** P1 surfaced connection *state*, not `Caps`, to the
   renderer. Since both P4 adapters are `true`, the simplest correct gate is "connection `kind` is
   postgres or mariadb" — but that is exactly the kind of kind-sniffing §5 says to avoid. Check
   whether `Caps` already reaches the renderer (e.g. via the connection state push); if not, either
   extend that push with a `caps` summary or accept the kind check with a comment naming P8 as the
   phase that replaces it.
2. **Should "Open DDL" appear for a disconnected connection?** §8.10 puts it on the object row with
   no state qualifier, and L1 means the DDL is often already cached. Decide: show it disabled while
   disconnected, or show it enabled and serve the cache (falling back to the error state on a miss).
   Leaning enabled-from-cache, matching how the tree itself renders from cache while disconnected.
3. **Outline default.** Whether the outline opens collapsed (just "N statements ▾") or lists all
   entries by default. Lean: always list — the object-level DDL of a table rarely exceeds a dozen
   statements, and hiding them behind a click saves nothing.

---

## 7. Definition of done

- "Open DDL" on `table`/`view`/`matview`/`function`/`sequence` (Postgres) and
  `table`/`view`/`routine` (MariaDB) opens or focuses a `ddl` tab, tinted with the connection colour,
  whose content is the server's DDL rendered read-only with SQL highlighting and line numbers.
- Postgres views/functions are exact (`pg_get_viewdef`/`pg_get_functiondef`); Postgres
  tables/matviews/sequences and all MariaDB objects are `SHOW CREATE` or reconstruction, and the
  reconstructed tables re-`CREATE` without error.
- The DDL is an L1-cached `SourceText` (structured, Zod-validated, statement-split) — cached in
  `metadata_cache`, invalidated by reconnect/refresh, served from cache while disconnected.
- A DDL tab restores as a "Reconnect & load" placeholder, persists only `{ scrollTop,
  selectedStatement }`, and logs zero ops until pressed.
- The `ddl` op lands in the operations panel with its command and a working stop button.
- `bun run typecheck`, `bun run lint`, `bun run test:db` and `bun run test:ui` are all clean, and the
  Playwright `consoleErrors` array is empty in every spec.
