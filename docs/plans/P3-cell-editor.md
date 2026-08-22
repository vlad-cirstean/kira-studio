# P3 — Cell editor

> **Deliverable (SPEC §10).** CodeMirror panel, format autodetect, manual override, beautify
> (indented/compact).

**Why this phase matters.** P2 made cells two things they had never been before: *selectable* and
*truncated*. Selection is now O(1) reactive state with a focus cell; truncation (P2 D5) means a
64 KiB page cap now exists precisely so a page of 5 000 rows cannot be 5 GB. Both are load-bearing
and both now have exactly one consumer: the cell editor. This phase is where a selected cell stops
being a 20-character grid string and becomes a real value the user can *see* — a 2 MB JSON
document, a 256 KB `bytea`, an ISO timestamp, a UUID, a hex blob — rendered with the right
highlighting, in the right shape, and (for the truncated case) fetched in full on demand. Everything
in §8.6 lands here *except* the write path: committing an edit stages a pending change (§8.13), and
that is unambiguously P5's "cell editing" — this phase ships the panel read-only and leaves the
seam P5 needs.

The second reason this phase earns its place: it is the first renderer surface that has to **guess,
and be wrong gracefully**. Format autodetection is a scored guess over an arbitrary string, and
§8.6 says so ("always overridable"). Getting that UX right — show the guess, let the user correct
it, remember the correction for the column for the session, never let the guess corrupt the value —
is the actual hard part, and it is pure, testable logic that no database round-trip can hide.

---

## 0. Ground rules for this phase

**Read first.** `docs/SPEC.md` §2.1, §8.5, §8.6, §8.13, §9; `docs/plans/P2-tabular-data-view.md`
§0, §1 (D1–D29), §3 (contracts), Step 9 (`PageView`), Step 17 (the P3 seam). P3 does not restate
P2's decisions; it extends them, and where it changes one it says so with a D number.

**Standing rules carried forward from P1/P2** (unchanged unless a D below says otherwise):

1. Zod-validate at every trust boundary: IPC in main, port frames in the engine, anything read back
   out of SQLite. (`TabularPage` is the one documented exception — P2 §3.1.)
2. The renderer never receives a password.
3. Every DB call goes through `runOp` so it lands in the op log with a working stop button.
4. `AdapterError` codes are a closed set; the server's message is preserved verbatim.
5. No `any`. No non-null assertions on values that cross a process boundary.
6. Every UI surface gets a stable `data-testid`.
7. Never interpolate a database identifier that did not come from cached catalog metadata, and only
   through the adapter's `quoteIdent` (P2 D12).

**P2 facts P3 builds on.** These are the files on disk and the seams P2 promised, both of which P3
takes as its inputs. As of this plan's writing P2 is mid-flight: the *shared contracts and pure
renderer validation are landed*, the *grid, tabs runtime, adapters and cache are not yet*. P3 starts
only after P2's definition of done; the list below is what P3 consumes from it.

| P2 artifact | Status now | What P3 uses it for |
| --- | --- | --- |
| `Selection` type in `src/shared/tabs.ts` | landed (contract) | the focus cell; `activeTab.selection.focus` |
| `TabularPage` / `PageColumn` / `CELL_TRUNCATED` in `src/shared/page.ts` | landed | the page value + the truncated flag |
| `assertTabularPage` in `renderer/workbench/state/page.ts` | landed | the structural validator the port path reuses |
| `PORT_OP` / `PortEvent` / `CacheStats` in `src/shared/port.ts` | landed | `data:cell` joins this vocabulary |
| `PageView` with `text()/raw()/isTruncated()/isNull()` + non-reactive `getPage(tabId)` | P2 Step 9 | the synchronous source of the displayed value |
| `activeTab.selection` runtime field in `renderer/workbench/state/tabs.ts` | P2 Step 8/17 | the reactive binding |
| `ObjectMeta.primaryKey` (P1) surfaced to the tab as describe metadata | P2 Step 8/10 | row identity for full-value retrieval |
| `quoteIdent` on the adapter (P2 D12) | P2 Step 5 | the full-value SELECT |
| `runOp` with `tabId` attribution (P2 D9) | P2 Step 4 | op-log + stop-button for `data:cell` |
| `request()/subscribe()` port plumbing + `emitPortEvent` (P2 D25) | P2 Step 2 | the `data:cell` round trip |
| raw-text parsers + OID→encoding map (P2 D4/Step 6) | P2 Step 6 | the single-column fetch shares the same encoding decisions |

**Out of scope for P3.** Do not build these; several are one small step away and that is exactly why
they need naming:

| Not in P3 | Where it lands |
| --- | --- |
| Making the editor **editable**, staging a pending cell edit on commit, the read-only *guard* | P5 (§8.13) |
| The pending-change set, preview command, commit/rollback | P5 |
| Copy/paste of the cell value, "Set NULL", "Filter by this value" cell-menu items | P6 (§8.10) |
| DDL viewer, structure tab | P4 |
| Document view and its per-document editor (Mongo) | P8 |
| Beautify for SQL/XML (a formatter dependency) | never — v1 beautify is JSON-only (D9) |
| Persisting format overrides across restarts | §8.6 says "for the session" — session only, never |

**Test commands.** Every step names its own check. The three commands are:

- `bun run typecheck` — both projects; must be clean after every step.
- `bun run test:db` — Bun + Testcontainers. The pure `detect`/`format` specs run **without** Docker;
  the adapter `cell` specs need Colima (`DOCKER_HOST=unix://$HOME/.colima/default/docker.sock`,
  `TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE=/var/run/docker.sock`). A skip is not a pass.
- `bun run test:ui` — builds to `out-test/` and runs Playwright against a real Electron.

---

## 1. Decisions

| # | Decision | Rationale |
| --- | --- | --- |
| **D1** | **P3 ships the cell editor read-only.** §8.6's "Editable" bullet and §8.13's pending-change set are P5's "cell editing" deliverable; §10's table puts the panel's *display* features (autodetect, override, beautify) in P3 and *cell editing* in P5. Making it editable now would need the pending-change set — without it "commit" has nowhere to go — and the read-only guard, both unambiguously P5. The editor is a read-only `EditorView`; the component's boundary is designed so P5 flips one prop and adds one commit handler. | The alternative (editable-with-nowhere-to-commit) ships a button that lies, which the codebase has a standing rule against (§5.1's "rather than lying"). The split is also §10's own line, not a compromise. |
| **D2** | **Full-value retrieval is a new adapter method `cell(req, ctx): Promise<CellPayload>`, a new op kind `'cell'`, and a new port op `data:cell`.** It is a *read* (goes through `runOp`, cancelable, op-logged), and it travels over the renderer↔engine port like `data:read`/`data:count` (P2 D1), because its payload — up to 8 MiB of one value — is bulk, not control. | The only alternative is to re-issue `read` with a `where` + `projection`, but (a) P2 D5 truncates every `read` at 64 KiB so the "full" value would come back truncated anyway, and (b) building `"pk" = <literal>` as free-text `where` reintroduces the interpolation P2 D12 just eliminated. A dedicated parameterized fetch is the honest path. |
| **D3** | **Row identity for a cell fetch is the primary key: `pk = { columns, values }` where `values` are the server-text renderings of the PK columns, taken from the loaded page.** Tables with `primaryKey: null` (or empty) have no full-value retrieval — the affordance is hidden with a tooltip reason. | §8.13 already establishes that rows are addressed by primary key and that no-PK tables lose write/edit affordances "with the reason shown". Full-value retrieval has exactly the same addressability requirement, so it inherits exactly the same rule rather than inventing a second row-addressing scheme. |
| **D4** | **P2 amendment: the read SELECT list is always `projection ∪ primaryKey`.** PK columns are always present in the page buffers, even when the user projects them out; "hide column" (§8.5) removes them from *view*, never from the page. If P2 has not landed this, it is implemented here (Step 6a) as a one-line change wherever the SELECT list is assembled, and recorded as a P2 amendment. | D3 requires the renderer to be able to read PK values for *any* selected row. A projection that can exclude the PK makes the cell fetch impossible for exactly the tables the user is most likely to click. Folding the PK into the page is also the cheapest way P5 and P7 get stable row identity for free. The L2 key is unaffected in substance (the PK columns are simply always part of the key's projection component). |
| **D5** | **`CellPayload` is `{ null: true }` or `{ null: false; kind: 'text' \| 'bytes'; … }`, capped at `MAX_FULL_CELL_BYTES = 8 MiB` with a `truncated` flag.** The adapter fetches `LEFT(col, MAX+1)` (Postgres) / `LEFT(col, MAX+1)` (MariaDB) and reports `truncated: true` when the returned length exceeds the cap, so the server and the wire never carry more than 8 MiB + 1 byte even for a 1 GB cell. | A "load full value" action that materializes a 1 GB cell would stall the frame §2.1 protects. `LEFT` pushes the cap into the SQL so the driver never builds the full string; the `+1` is how "there is more" is detected without a `count(*)` of the cell. |
| **D6** | **Format autodetection is renderer-only, pure, and column-type-aware: the column's `dataType` is the strongest signal, content tests disambiguate.** Detection produces a `FormatHint { format, confidence }` and is always overridable (§8.6). It lives in a module that imports nothing from `electron` or Vue, so it is Bun-testable exactly like P2's encoder. | The `dataType` prior resolves the classic traps for free: `jsonb`/`json` → JSON even if the content is `"true"`; `bytea`/`BLOB` → hex; `timestamp*`/`DATETIME` → ISO-8601. Content tests then only ever run against the genuinely ambiguous case — a generic `text`/`varchar` column. Scored + overridable means a wrong guess costs one dropdown click, never corrupted data. |
| **D7** | **The `Format` enum is a closed set of eleven: `json`, `xml`, `sql`, `base64`, `hex`, `epoch`, `iso`, `uuid`, `url`, `csv`, `text`** — §8.6's list, verbatim, with "epoch seconds/millis" folded into one `epoch` format whose label notes the unit. Each format maps to a CodeMirror language (json→`lang-json`, sql→`lang-sql`, xml→`lang-xml`, everything else plain text) and a set of enabled affordances. | Detection drives four concrete things and nothing more: the dropdown label, syntax highlighting (json/sql/xml), beautify availability (json only, D9), and a future P5 commit-type hint. Formats like `uuid`/`epoch`/`url`/`hex` are labels over plain text, not highlighting targets — saying so keeps the scope honest instead of inventing a highlighter per format. |
| **D8** | **Manual override is session-scoped, keyed `connectionId + '\n' + path + '\n' + column`, in-memory only, never persisted.** Choosing a format writes the override; choosing "Auto" deletes it and reverts to detection. | §8.6: "the choice sticks per column for the session." Session-only means a module-level `Map`, no schema, no IPC, no migration. §6's `settings`/`layout` persistence does not apply because the spec explicitly scopes it to the session. |
| **D9** | **Beautify is JSON-only in v1 and non-destructive: `indented` = `JSON.stringify(parsed, null, 2)`, `compact` = `JSON.stringify(parsed)` (single line, no indentation).** For non-JSON formats the beautify control is hidden. No formatter dependency is added. | §8.6 names two modes, and for JSON those two are a no-dependency stringify switch. A SQL or XML formatter is a dependency and a re-flow of user text; §3's stack discipline ("minimal") and the fact that the value is read-only in P3 (D1) mean a display-only JSON toggle is the right v1 scope. The underlying value is untouched — only the *rendered* text changes. |
| **D10** | **CodeMirror packages go in `devDependencies`** (`@codemirror/state`, `@codemirror/view`, `@codemirror/language`, `@codemirror/lang-json`, `@codemirror/lang-sql`, `@codemirror/lang-xml`). | `externalizeDepsPlugin()` externalizes `dependencies` for the Node-side processes (main/engine/preload) — that is why `pg`/`mariadb` must be `dependencies` (P2 D27). The renderer is built by Vite, which *bundles* regardless of category, and CodeMirror is renderer-only, so `devDependencies` is correct and keeps the packaged runtime deps to the drivers. |
| **D11** | **One `EditorView` per panel instance, reconfigured on cell/format change — never recreated.** The panel swaps `EditorState` (doc + language + theme) via `view.setState(...)` on selection/format change. | §2.1 budgets ≤ 50 ms from cell selection to a populated panel. Tearing down and rebuilding an `EditorView` per click pays editor-construction cost on the hot path; a setState swap is a diff against the old doc and is where CodeMirror is fast. |
| **D12** | **The panel binds to `selection.focus` (always a concrete `{row, col}`), so row- and column-mode selections still populate it with the cell under the cursor.** With no tab, no page, or no focus, the panel renders the empty background. | P2's `Selection` has three modes but the cell editor wants *a* cell; `focus` is always one. Special-casing "no single cell selected" would add an empty state that flashes as the user drag-selects a row. |
| **D13** | **NULL and empty string are distinct in the panel, exactly as §8.5 distinguishes them in the grid.** A NULL cell shows a muted, non-editable `[NULL]` placeholder; an empty string shows an empty editor. | The whole point of the panel is *fidelity* to the value. An empty string is a real, different value from NULL; collapsing them in the editor is the one place a user would be silently misled about data. |
| **D14** | **`opKindSchema` gains exactly `'cell'`; the op log shows the full-value SELECT in `command` and `rows: 1`.** `data:cell` does not go through L2 — a single-value fetch is never cached (it is the rare path, keyed to a moment in time, and §7's L2 is for pages). | Full-value fetch is a read the user explicitly asked for; it must be visible in the operations panel and cancelable (a `LEFT()` on a wide row is still a server op). `runOp` gives both for free; the only new surface is the enum entry and the adapter method. |

---

## 2. Target file tree

Only new (`+`) and modified (`~`) files. Everything else stays as it is.

```
package.json                          ~  + 6 CodeMirror packages (devDependencies, D10)
src/
  shared/
    ~ ops.ts                          ~  opKindSchema += 'cell' (D14)
    ~ port.ts                         ~  PORT_OP += cell: 'data:cell'; CellPayload wire types
    + cell.ts                         +  CellRequest (Zod), CellPayload, MAX_FULL_CELL_BYTES (D5)
  engine/
    ~ rpc.ts                          ~  dispatch data:cell
    adapters/
      ~ adapter.ts                    ~  roadmap comment: P3 adds cell() (D2); do not add early
      postgres/
        + cell.ts                     +  cell(): LEFT()-capped, parameterized single-column fetch
        ~ index.ts                    ~  wire cell(); reuse read's parser/encoding knowledge
      mariadb/
        + cell.ts                     +  same for MariaDB
        ~ index.ts                    ~  wire cell()
    ~ page/sql.ts                     ~  (if D4 not yet landed) helper to union projection ∪ PK
  renderer/
    bridge/
      ~ port.ts                       ~  fetchCell(req) wrapper + assertCellPayload
    workbench/
      panels/
        ~ CellEditorPanel.vue         ~  the real panel (header bar + CodeMirror) (D1, D11–D13)
      + celleditor/
        + detect.ts                   +  detectFormat(text, prior) → FormatHint (D6, D7)
        + format.ts                   +  Format enum, format→lang/affordances, beautify (D9)
        + theme.ts                    +  CodeMirror theme mapped to --kira-* tokens
        + state.ts                    +  session override Map + active-cell binding (D8)
  (P2 amendment, if needed)
    ~ renderer/workbench/state/tabs.ts +/or engine page/sql.ts  ~  projection ∪ primaryKey (D4)
tests/
  db/
    + cell.spec.ts                    +  detect/format pure tests (no Docker) + adapter cell (Docker)
  ui/
    + cell-editor.spec.ts             +  Playwright: autodetect, override, beautify, load-full, NULL
```

No storage, IPC, or schema changes. The session override is in-memory (D8); the cell fetch is a
port op (D2), not an IPC channel.

---

## 3. Shared contracts

This is the section everything else hangs off. Get these exactly right before writing any behaviour.

### 3.1 `src/shared/cell.ts` — the cell-fetch wire format

```ts
import { z } from 'zod';

// D5: a "load full value" action caps what it will fetch and what it will ship. `LEFT(col, MAX+1)`
// in SQL is how the adapter detects "there is more" without materializing the whole value.
export const MAX_FULL_CELL_BYTES = 8 * 1024 * 1024;

// Rows are addressed by primary key (D3). `values` are the server-text renderings of the PK
// columns, in `columns` order — taken from the loaded page via PageView.text(), exactly as P2's
// keyset token is built from the same row data. They become bind parameters, never text literals.
export const cellRequestSchema = z.object({
  connectionId: z.string(),
  /** Encoded NodePath of the table/view (§3 of P1's contracts). */
  path: z.string(),
  /** Stamped onto op:start for tab attribution (P2 D9). */
  tabId: z.string(),
  /** Column name, from cached catalog metadata (the same source as the projection list). */
  column: z.string().min(1),
  pk: z.object({
    columns: z.array(z.string()).min(1),
    values: z.array(z.string()),
  }).refine((pk) => pk.columns.length === pk.values.length, 'pk columns/values arity'),
});
export type CellRequest = z.infer<typeof cellRequestSchema>;

export type CellPayload =
  | { null: true }
  | { null: false; kind: 'text'; text: string; truncated: boolean }
  | { null: false; kind: 'bytes'; bytes: Uint8Array; truncated: boolean };
```

`CellPayload` is **not** Zod-parsed in the renderer for the same reason `TabularPage` is not (P2
§3.1): it carries up to 8 MiB of one value, and a Zod parse per fetch is pointless. Validate it
structurally in the renderer with a small `assertCellPayload(v: unknown): CellPayload` (checks the
`null` discriminant, the `kind`, and that `text`/`bytes` match the `kind`), then freeze the wrapper.
Say so in a comment — this is the second deliberate, bounded exception to standing rule 1, and it is
documented as such.

`kind` is decided by the column's encoding (P2 D4): `bytes` columns (bytea/BLOB) → `kind: 'bytes'`,
everything else → `kind: 'text'` with the server's exact string. The renderer already knows the
column's encoding from `PageColumn.encoding`, so the adapter is not free to choose — `cell()` must
return the kind that matches the column's declared encoding.

### 3.2 `src/shared/ops.ts` and `src/shared/port.ts` — protocol additions

```ts
// ops.ts — exactly one new kind (D14).
export const opKindSchema = z.enum([
  'connect', 'disconnect', 'children', 'describe', 'test',
  'read', 'count', 'cell',
]);
```

```ts
// port.ts — data:cell joins the existing bulk-data vocabulary.
export const PORT_OP = {
  ping: 'ping',
  read: 'data:read',
  count: 'data:count',
  cell: 'data:cell',
  cacheStats: 'cache:stats',
  cacheClear: 'cache:clear',
} as const;
```

`data:cell` needs no event (there is no `PortEvent` for it); it is a plain request/response like
`data:read`, and its response payload is one `CellPayload` — the second frame (after `data:read`)
whose payload is not JSON-shaped, carrying a `Uint8Array` for the `bytes` case. Note that in the
`port.ts` comment alongside the existing D3 note.

### 3.3 `Adapter` addition (`src/engine/adapters/adapter.ts`)

Update the normative roadmap comment in place — add one row, leave the P5+ rows untouched:

```ts
//   P3   cell(req, ctx) -> CellPayload   (caps.tabular; single-column, PK-addressed, LEFT-capped)
```

The method itself:

```ts
cell(req: CellRequest, ctx: OpCtx): Promise<CellPayload>;
```

Rules for `cell()`: it runs inside `runOp({ connectionId, kind: 'cell', tabId })`, calls
`ctx.setCommand(text)` **before** executing, `ctx.setRows(1)` after, honours `ctx.signal`, and throws
`AdapterError` with a closed-set code — `E_NOT_FOUND` when the PK matches no row (the row was
deleted or the page is stale), `E_QUERY` when the PK is not actually unique (more than one row
matched — see Step 3), `E_CANCELLED`/`E_CONNECT`/`E_TIMEOUT` as usual, with the server message
verbatim everywhere else. It is present on every adapter with `caps.tabular`; adapters without it
(Redis/Kafka/etc.) never receive the request because the UI only issues it from a tabular grid.

### 3.4 `src/renderer/workbench/celleditor/detect.ts` and `format.ts`

```ts
// format.ts
export type Format =
  | 'json' | 'xml' | 'sql' | 'base64' | 'hex' | 'epoch'
  | 'iso' | 'uuid' | 'url' | 'csv' | 'text';

export interface FormatHint {
  format: Format;
  /** 'high' when the column type or an unambiguous test settled it, 'low' when it is a guess. */
  confidence: 'high' | 'low';
  /** Human-readable reason, shown in the dropdown tooltip ("detected: JSON (jsonb column)"). */
  why: string;
}

/** Display transform (D9). `null` = no beautify for this format. */
export function beautify(text: string, format: Format, mode: 'indented' | 'compact'): string | null;
```

```ts
// detect.ts
export interface DetectPrior {
  /** PageColumn.dataType (server type name) and encoding — the strongest signal (D6). */
  dataType: string;
  encoding: ColumnEncoding;
}

export function detectFormat(value: string | null, prior: DetectPrior): FormatHint;
```

`detectFormat` is pure: same inputs → same hint. The rules, in order (the first rule that fires
wins, so they are listed most-specific-first):

1. **`null`** → `text` with `why: 'NULL'` (the panel never runs this — NULL is handled before
   detection — but the function is total).
2. **bytes encoding** (`bytea`/`BLOB`) → `hex`, `confidence: 'high'`.
3. **Column-type prior** (case-insensitive substring match on `dataType`):
   `json`/`jsonb`/`json[]` → `json`; `xml` → `xml`; `uuid` → `uuid`;
   `timestamp`/`timestamptz`/`date`/`datetime` → `iso`;
   `bytea`/`blob`/`binary`/`varbinary` → `hex`; `inet`/`cidr`/`macaddr` → `text` (no format);
   `bool`/`boolean` → `text`. These are `confidence: 'high'` because the server told us.
4. **JSON**: `JSON.parse` succeeds **and** the result is an object or array (not a scalar) → `json`.
   Scalars that parse (`"true"`, `"123"`, `"null"`) are *not* JSON by this rule — a bare `123` is a
   number, a bare `true` is a bool. This is the single most important heuristic in the module.
5. **UUID**: `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i` → `uuid`, high.
6. **ISO-8601**: `/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/` and `!Number.isNaN(Date.parse(v))` → `iso`.
   (Date-only and time-only strings are deliberately *not* iso — they are too easily false-positive
   on IDs and codes.)
7. **epoch**: `/^-?\d{9,13}$/` and the value parses to a date between 1900 and 2300 → `epoch`,
   `why` notes seconds vs milliseconds from the digit count (10 = seconds, 13 = milliseconds).
8. **hex**: `/^(?:[0-9a-f]{2})+$/i` with length ≥ 8 **and** no A–F-only restriction, `confidence:
   'low'` — because `deadbeef`, `cafe`, `abba` are valid hex *and* plausible text. Low confidence
   is the entire point: the guess is shown, the user can override.
9. **base64**: `/^[A-Za-z0-9+/]*={0,2}$/`, length ≥ 16, length % 4 === 0, and a decode round-trip
   succeeds → `base64`, low.
10. **URL**: parses with `new URL(v)` and scheme is `http`/`https` → `url`, high.
11. **SQL**: starts (case-insensitively) with `select|insert|update|delete|with|explain|show|create`
    followed by a word boundary or whitespace → `sql`, low.
12. **XML**: `/^<\?xml|<[a-zA-Z][^>]*>/` → `xml`, low.
13. **CSV**: contains a newline or comma and ≥ 2 fields with consistent counts → `csv`, low.
14. **fallback** → `text`, high (`why: 'no format matched'`).

`beautify` returns `null` for every format except `json` (D9). For `json` it re-parses and
re-stringifies; if the parse fails (the value was *forced* to `json` by an override on non-JSON
text), it returns `null` rather than corrupting the text, and the panel shows the raw value.

`format.ts` also owns `languageFor(format): Extension | []` — `lang-json`/`lang-sql`/`lang-xml` or
the empty array — and `beautifiable(format): boolean`.

### 3.5 `src/renderer/workbench/celleditor/state.ts`

```ts
// Session-scoped manual overrides (D8). Key is stable across tabs of the same table: the override
// is per column, not per tab, so two tabs on one table share it (both read "for the session").
const overrides = new Map<string, Format>();

export function overrideKey(connectionId: string, path: string, column: string): string;
export function getOverride(key: string): Format | null;
export function setOverride(key: string, format: Format | null): void; // null = back to Auto
```

The panel's effective format is `getOverride(key) ?? detectFormat(value, prior).format`. The override
map is deliberately **not** reactive — the panel recomputes its state from a plain function call when
its inputs (selection, override) change, matching the grid's imperative-read discipline (P2 D22).

---

## 4. Implementation steps

Six steps. Each is independently demonstrable — stop after any one and the app still builds,
typechecks and runs.

---

### Step 1 — Shared contracts and CodeMirror dependencies

**Files:** `src/shared/cell.ts` (new); `src/shared/{ops,port}.ts` (modified);
`src/engine/adapters/adapter.ts` (comment only); `package.json`.

Write §3.1–§3.3 verbatim. Then:

- `ops.ts`: `opKindSchema` += `'cell'`, and fix the stale "grows in P5" comment.
- `port.ts`: `PORT_OP.cell = 'data:cell'`, and extend the D3 note to mention `data:cell` as the
  second non-JSON payload.
- `adapter.ts`: add the P3 row to the roadmap comment; do **not** declare `cell()` on the interface
  yet — the roadmap is normative and the method lands in Step 3, same discipline P1 D3 established.
- `bun add -d @codemirror/state @codemirror/view @codemirror/language @codemirror/lang-json
  @codemirror/lang-sql @codemirror/lang-xml` (D10).

**Acceptance.** `bun run typecheck` clean, `bun run lint` clean. No behavioural change.

---

### Step 2 — Format detection and beautify (pure)

**Files:** `src/renderer/workbench/celleditor/{detect.ts,format.ts}` (new);
`tests/db/cell.spec.ts` (new, the pure describe only).

Implement §3.4 verbatim. Both modules import nothing from `electron`, Vue, or `@shared` — only each
other and the `ColumnEncoding`/`Format` types — so Bun imports them directly, exactly as
`tests/db/read.spec.ts` imports the engine encoder.

The Bun tests assert the detection matrix without Docker:

- `detectFormat` on `{ dataType: 'jsonb', encoding: 'utf8' }` returns `json` even for `"true"`.
- `{"a":1}` in a `text` column → `json`, high.
- `123` and `true` in a `text` column → `text` (the JSON-scalar trap, §3.4 rule 4).
- `550e8400-e29b-41d4-a716-446655440000` → `uuid`.
- `2025-01-02 03:04:05` → `iso`; `2025-01-02` → `text` (date-only is not iso).
- `1704158400` (10 digits) → `epoch`; `1704158400123` (13 digits) → `epoch`; `99999999999999999`
  (out of range) → `text`.
- `deadbeef` → `hex` with `confidence: 'low'`; `hello world` → `text`.
- `SGVsbG8gV29ybGQ=` → `base64`.
- `https://example.com/x` → `url`.
- `select * from t` → `sql`; `SELECT 1` → `sql`.
- `<a>hi</a>` → `xml`.
- `a,b\n1,2` → `csv`.
- `beautify('{"b":1,"a":[1,2]}', 'json', 'indented')` is the 2-space form;
  `'compact'` is single-line; `beautify(x, 'sql', …)` and a forced-JSON parse failure both return
  `null`.

**Acceptance.** `bun run test:db` passes the pure describe (no Docker), `bun run typecheck` clean.

---

### Step 3 — Adapter `cell`: Postgres, then MariaDB

**Files:** `src/engine/adapters/postgres/{cell.ts,index.ts}`,
`src/engine/adapters/mariadb/{cell.ts,index.ts}`; `tests/db/cell.spec.ts` (extended).

**Postgres.** The fetch is one parameterized statement, reusing P2's `quoteIdent` (D12) and the
raw-text parsers from P2 Step 6 so `numeric`/`text` come back as exact server text:

```sql
SELECT left(<quoted col>, <MAX+1>) AS v FROM <qualified table>
WHERE <quoted pk1> = $1 AND <quoted pk2> = $2 … LIMIT 2;
```

- `LIMIT 2` is the uniqueness guard (D3): one row is the answer, two rows means the "primary key"
  is not unique in practice (stale metadata) → `E_QUERY`, zero rows → `E_NOT_FOUND`.
- For `bytes` columns (`bytea`), decode the raw `\x…` text to a `Uint8Array` (reuse P2 Step 6's
  decode; if the server is in `bytea_output = escape` mode, fall back to `kind: 'text'` rather than
  producing garbage, mirroring P2 Step 6's rule).
- Truncation: `left(v, MAX+1)` returning more than `MAX_FULL_CELL_BYTES` bytes/chars sets
  `truncated: true` and the value is cut to the cap. The SQL `left` runs on the server, so a 1 GB
  cell never crosses the wire (D5).
- Runs inside `runOp({ connectionId, kind: 'cell', tabId })`, `ctx.setCommand(text)` before,
  `ctx.setRows(1)` after, `ctx.signal` honoured via the same race-with-`settled` guard P2 uses.

**MariaDB.** Identical shape with backtick `quoteIdent` and `?` placeholders; `LEFT()` on a
binary/BLOB column returns bytes directly (the connector's `typeCast` for those columns already
returns buffers — P2 Step 15), and text columns come back via the raw-string `typeCast`.

Extend `tests/db/cell.spec.ts` with container-backed cases (skip with a Colima reason when Docker is
absent): a `NULL` cell → `{ null: true }`; an exact `numeric` value → byte-identical text; a `bytea`
cell → `kind: 'bytes'` with the right bytes; a 9 MiB text cell → `truncated: true` and a payload ≤
8 MiB + 1; a row that does not exist → `E_NOT_FOUND`; a cancel mid-fetch (via a `pg_sleep`-free
slow query is not needed here — assert `E_CANCELLED` by aborting the signal) leaves the op
`cancelled` in the op stream.

**Acceptance.** `bun run test:db` green against both containers.

---

### Step 4 — The `data:cell` port round trip

**Files:** `src/engine/rpc.ts`, `src/renderer/bridge/port.ts`.

Engine: add `data:cell` to `rpc.ts`'s dispatch, parsing the inbound `CellRequest` with
`cellRequestSchema` **before** use (standing rule 1), dispatching to the adapter, and returning the
`CellPayload`. It goes through the same `runOp` wrapping as `data:read`, and no cache tier is
consulted (D14).

Renderer: in `bridge/port.ts` export

```ts
export function fetchCell(req: CellRequest): Promise<CellPayload>;
```

which `await`s `ready`, calls `request(PORT_OP.cell, req)`, runs `assertCellPayload` on the result,
and `Object.freeze`s the wrapper. Give `data:cell` the same **120 s** timeout as `data:read`
(P2 Step 2(c)) — the real bound is the stop button, not the timeout.

**Acceptance.** `bun run test:ui` — a temporary test-build helper (`window.__kira.fetchCell`, removed
before commit, matching P1/P2's scratch-assertion discipline) returns the full value of a seeded
truncated cell and its `truncated` flag is `false`. `bun run typecheck` clean.

---

### Step 5 — The panel: read-only CodeMirror + autodetect + override + beautify

**Files:** `src/renderer/workbench/panels/CellEditorPanel.vue`,
`src/renderer/workbench/celleditor/{state.ts,theme.ts}`,
`src/renderer/workbench/state/tabs.ts` (only if the P2 selection accessor needs a small helper).

This is the phase's headline. The panel (`grid-area: cell` in `WorkbenchShell.vue`, already wired
with its splitter and `data-testid="cell-editor"`) becomes:

```
┌───────────────────────────────────────────────────────────┐
│ col_name   ·   jsonb        [format ▾ Auto]  [⋮⋮ indent]  │  ← header bar
├───────────────────────────────────────────────────────────┤
│  1  {                                                      │
│  2    "id": 42,                                            │  ← CodeMirror, read-only
│  3    …                                                    │
└───────────────────────────────────────────────────────────┘
```

- **Binding (D12):** reads `activeTab.selection.focus` (reactive) and resolves the value via the
  non-reactive `getPage(tabId)` → `PageView`. The value source is `view.text(row, col)` for text
  encodings and a hex rendering of `view.raw(row, col)` for `bytes`; `view.isNull(row, col)` gates
  the `[NULL]` placeholder (D13); `view.isTruncated(row, col)` arms the **Load full value** button
  in the header. No tab/page/focus → empty background.
- **Header bar:** column name + `dataType` (left), then the **format dropdown** (Auto + the eleven
  formats), the **beautify** toggle (indented/compact, visible only when the effective format is
  `json`, D9), and **Load full value** (visible only when truncated). Every control gets a
  `data-testid`. The dropdown shows the *effective* format: override if set (D8), else the detected
  format with its `why` in the tooltip.
- **CodeMirror (D11):** one `EditorView` created on mount, `view.setState(...)` on selection/format
  change with the doc = displayed text and the language from `languageFor(format)` (§3.4). Read-only
  (`EditorState.readOnly` + `EditorView.editable.of(false)`), line numbers on, `theme.ts` maps the
  base chrome to `--kira-bg`/`--kira-fg`/`--kira-border` and the json/sql/xml highlight tokens to the
  existing syntax-token vars. The 50 ms budget (§2.1) is met because the value is read from the page
  synchronously — there is no network on the selection path.
- **Beautify (D9):** a two-state segmented control (`indented`/`compact`); toggling recomputes the
  displayed text via `beautify(...)` and does not touch the underlying value. If `beautify` returns
  `null` (forced-JSON override on non-JSON text), the control is disabled with a tooltip.

**Acceptance.** `bun run test:ui` against seeded data: click a `jsonb` cell → the panel shows
pretty-printed JSON with highlighting and the dropdown reads "JSON"; click a `text` cell containing
`550e8400-…-446655440000` → "UUID"; pick "Hex" from the dropdown → the dropdown stays "Hex" for
every other row of that column (D8) and reverts to Auto when "Auto" is picked; toggle compact →
the JSON collapses to one line; a `NULL` cell shows `[NULL]`; an empty-string cell shows an empty
editor. Assert no console errors (P1 fixture rule) and no new `consoleErrors`.

---

### Step 6 — Full-value retrieval end-to-end, plus the projection amendment

**Files:** `src/engine/page/sql.ts` and/or `src/renderer/workbench/state/tabs.ts` (D4 amendment, if
P2 has not landed it); `CellEditorPanel.vue` (wire the Load full value button);
`src/engine/adapters/*/index.ts` (nothing new — `cell()` is wired in Step 3).

**6a. D4 amendment (only if P2 did not already guarantee it).** Confirm the read path's SELECT list
is always `projection ∪ primaryKey`. Where P2 assembles the select list (P2 Step 6 for Postgres,
Step 15 for MariaDB), union the PK column names into the projection before quoting; the PK columns
remain hideable from *display* via the existing hide-column path but are always present in the page
buffers and the L2 key's projection component. Add one Bun test that a read with a projection
excluding the PK still returns the PK columns in the page. Record this as a P2 amendment in the
commit message.

**6b. Wire the button.** "Load full value" builds the `CellRequest` from the current cell: `column`
from the selected column name, `pk` from `ObjectMeta.primaryKey` (the tab's describe metadata) read
through `view.text(row, pkCol)` for each PK column, `tabId` from the active tab. It disables the
button, shows a small inline spinner, calls `fetchCell`, and swaps the editor to the full value with
`truncated` reflected in a footer note ("value exceeds 8 MiB, showing first 8 MiB"). An
`E_NOT_FOUND` shows "row no longer exists (stale page)" in the footer and leaves the prefix on
screen. Tables with `primaryKey: null` never show the button; hovering the (absent) button's spot is
moot — instead the header shows a muted "no primary key — full value unavailable" note (D3).

**Acceptance.** `bun run test:ui`: open the seeded 1 MB text row, click its truncated cell → the
prefix renders with the Load full value button; click it → the full value appears and the button
disappears; a table with no PK shows the muted note and no button; `bun run test:db` for the
projection-union test.

---

## 5. Risk register

| # | Risk | Likelihood | Impact | Mitigation / trigger |
| --- | --- | --- | --- | --- |
| R1 | Format detection misfires on realistic data (hex-vs-word, JSON-scalar, date-only) | High | Wrong label shown; if it *corrupts* the value, data loss | The three known traps are explicit rules (§3.4 rules 4/7/8) with Bun tests. Detection is display-only and always overridable (D8), so the worst case is a wrong label, never a wrong value. Tune the ordering only against the §9.1 fixture plus the new detection fixture rows, never ad hoc. |
| R2 | A 1 GB cell makes the full-value fetch or render stall a frame | Low | §2.1 violation | `LEFT(col, MAX+1)` caps the fetch server-side (D5); CodeMirror's viewport virtualizes the *render*, so an 8 MiB doc does not build 8 MiB of DOM. If the §9.1 fixture's largest cell still grates, reduce `MAX_FULL_CELL_BYTES` — it is one constant. |
| R3 | `Projection ∪ PK` (D4) interacts badly with P2's L2 key or column-hide | Medium | Cache misses or a PK column the user cannot hide | The PK is added to the *fetch*, not to the *display*; hide-column stays a view concern. The L2 key's projection component simply always contains the PK, which is stable per table. If P2's read path has no single "assemble the select list" choke point, the amendment touches two files, not the cache. |
| R4 | The `data:cell` `Uint8Array` does not survive the port the way `data:read`'s do | Low | Bytes cells break | It is the same structured-clone path P2 D3 already validated for `data:read`; Step 4's scratch helper proves it against this Electron build before the UI depends on it. |
| R5 | Stale `describe` metadata (renamed column, dropped PK) makes `cell()` target a missing column | Medium | `E_QUERY`/`E_NOT_FOUND` surfaced to the user | The error is caught and shown in the footer (Step 6b), never thrown into the void; the "row no longer exists" message tells the user to refresh. A refresh drops the L1 entry (P2 D26) and corrects it. |
| R6 | CodeMirror bundle size or first-paint cost drags tab-switch/cell-select under the 50 ms budget | Low | §2.1 violation | D11 (one editor, setState swap) is the defence; measure in Step 5's acceptance, and if needed lazy-import the language packages so the first json cell pays the cost, not the panel mount. |

---

## 6. Open questions (decide during, record in the commit)

1. **Where does the detection fixture data live?** The existing `0001_seed.sql` has JSON/unicode but
   may lack the adversarial cases (a hex-looking word, a 13-digit epoch, a JSON scalar, a date-only
   string). Decide whether to extend the Postgres seed or add a dedicated `cell`-fixture table; if
   the seed is frozen (P1 note 14), a small `cell_editor_seed.sql` is the cheaper, non-breaking path.
2. **Should the format override surface as an empty state on other tabs immediately?** D8 keys by
   `(connectionId, path, column)`, so a second tab on the same table sees the override live. If that
   surprises during review, the fallback is keying by `(tabId, column)` — §8.6's "per column for the
   session" is read as per-column-per-session, so cross-tab is the intended reading; confirm it.
3. **Beautify default.** Whether a freshly-opened JSON cell opens `indented` or `compact` is a
   matter of taste; default to `indented` (the §8.6 "Beautify" word implies prettification) and make
   it a per-session sticky toggle, not a settings entry, unless it grates.

---

## 7. Definition of done

- Clicking any grid cell populates the cell editor within the §2.1 budget (synchronously from the
  page), with NULL and empty string rendered distinctly.
- Format autodetection covers the eleven §8.6 formats with column-type priors, is always overridable,
  and the override sticks per column for the session (in-memory, never persisted).
- Beautify offers indented/compact for JSON and is hidden for non-JSON formats.
- A truncated cell shows its 64 KiB prefix and a Load full value action that fetches the full value
  (capped at 8 MiB, `truncated` flagged beyond) through a parameterized, PK-addressed, cancelable
  `data:cell` op that lands in the operations panel with its SQL and stop button.
- No-PK tables show the reason full-value retrieval is unavailable; stale rows show a legible error.
- Both adapters (`postgres`, `mariadb`) implement `cell()` and neither appears by name anywhere in
  `src/renderer` or `src/main`.
- `bun run typecheck`, `bun run lint`, `bun run test:db` and `bun run test:ui` are all clean, and the
  Playwright `consoleErrors` array is empty in every spec.
