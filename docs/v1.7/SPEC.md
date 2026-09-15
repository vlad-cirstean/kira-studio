# Kira Studio — v1.7

v1.6 returned to v1.1/v1.2/v1.4's shape: six independent, unrelated phases across existing modules.
This chapter is the opposite shape, like v1.5's own code-intelligence chapter: one new subsystem,
built in dependency order, so it takes a fresh letter — **`M`** (MCP) — rather than continuing v1.6's
`P` numbering, for the same reason v1.5's own opening paragraph gives for taking `C` instead of `P`.

**The subsystem.** A second local MCP server, alongside the existing repo-map server
(`apps/kira-studio/internal/repomap`, CLAUDE.md's own section): list a connection's databases/
schemas, return metadata, and run queries against it — for an AI client, not a human. Everything
else in this chapter exists to make that safe and useful: a permissions model per connection (read/
write/DDL, each independently deny/allow/prompt-approval), an EXPLAIN path with parsed responses and
a heavy-query flag, PII anonymization filters that survive correlation without exposing real values
(usable over MCP and in the normal data viewer, not MCP-only), and Faker exposed as an MCP tool for
synthetic test data. Two code-review rounds close the chapter, scoped wider than usual — see M6/M7.

**Confirmed today, checked directly, not assumed:**

- The repo-map server's shape is the direct precedent: `github.com/modelcontextprotocol/go-sdk/mcp`
  for tool registration and the streamable-HTTP transport (`internal/repomap/server.go`'s
  `buildMCPServer`, `http.go`'s `bindHTTP`), a loopback-only bind with an ephemeral-port fallback,
  and `internal/mcpauth` for the bearer token (`Mint`/`Load`/`Save`/`LoadOrMint`, hash+salt only,
  plaintext never written to disk, keyed by a repo-id slug under `KIRA_HOME`). This chapter's server
  is a new, separate instance of the same pattern, not a mode of the existing one — the two serve
  unrelated graphs (code structure vs. live query execution) with very different trust postures (the
  repo-map server is read-only by construction; this one can write and run DDL by design). The
  existing token never expires ("a later run reuses it"); M1 adds a 7-day rotation `mcpauth` does not
  have today.
- A connection is `apps/kira-studio/internal/storage/model/connection.go`'s `ConnectionFields`
  (already carries `AutoExplain bool`, `ThrottlePerSec float64` — an EXPLAIN gate already exists,
  correcting an assumption this chapter's own first draft made), edited in
  `apps/kira-studio/frontend/src/project/ConnectionDialog.vue`, which already has a tab strip
  (`DetailTab = 'General' | 'Advanced' | 'Pre-connect'`, `.p-tab-strip`) — a new tab plugs in the
  same way an existing one does.
- Every console query already flows through one chokepoint,
  `apps/kira-studio/frontend/src/views/console/state.ts`'s `run()` (L377+), which already gates
  auto-explain (L390-425) via `views/console/explain.ts`/`plan.ts`. That's the natural insertion
  point for permission checks and EXPLAIN-before-query on the MCP path — not a parallel mechanism.
- `@faker-js/faker` is already a dependency (`10.6.0`, root `package.json` and
  `packages/api-core/package.json`), used today only from the frontend
  (`views/grid/fakeData/{fakerEntry,generate,recipes,types}.ts`, dynamic-imported to keep its ~150KB
  locale chunk out of the boot bundle) and from `packages/api-core/src/http/dynamic/*`. No Go faker
  library exists. The MCP server (`internal/repomap`'s sibling, this chapter's own) is a Go process —
  M4's own planning pass decides how a Go-hosted tool reaches this JS library (a Bun/Node subprocess
  bridge is the leading candidate, `packages/api-core`'s dynamic-HTTP mechanism may already be a
  reusable shape) rather than hand-rolling a second generator or adding a new dependency.
- The cell editor (`apps/kira-studio/frontend/src/views/shared/celleditor/`, `CellEditorView.vue` +
  `CellEditorDock.vue`, alongside `formats.ts`/`detect.ts`/`binary.ts`/`validate.ts`/`generate.ts`)
  and the main grid (`views/grid/DataView.vue`/`SlickGridHost.vue`) are the two surfaces M5's
  grid-side anonymization preview extends — not a new viewer.
- The Settings dialog (`workbench/SettingsDialog.vue`, `sections` array, `Code intelligence` at
  L865+ as the direct precedent for "Advanced" section wiring) is where a chapter-wide MCP-server
  enable/disable toggle plugs in, mirroring the repo-map server's own toggle.

**Sequencing.** M1 first: every later phase needs the server and its tool-registration surface to
exist. M1's plan and its implementation are split, v1.6 P63/P65-style: **M1 is plan-only**, M1's
actual implementation lands as **M1ab**, an A/B measurement — implements M1's already-approved plan
twice, from the same starting commit, in isolated worktrees, once using the repo-map MCP server for
navigation and once deliberately without (Grep/Read only), both to real shipping quality. M1 is the
candidate for this treatment (not any other row) because it's almost entirely Go — the one phase in
this chapter with no meaningful `.vue` surface — and it requires exactly the unfamiliar-codebase
navigation repo-map exists for: understanding `internal/repomap`'s own patterns, `internal/mcpauth`'s
token code, the connection model, and every adapter kind's query path, across a half-dozen packages
none of this chapter's phases have touched yet. `.vue` SFCs are a confirmed dead zone for repo-map's
own tools (`docs/v1.6/mcp-repo-map-issues.md`'s P60a/P63/P67e entries all return zero results against
one), so a phase with real Vue surface would not isolate the tool's own effect the way M1ab's
backend-only scope does. The MCP-using arm lands as M1's real deliverable on `v1.7`; the other arm is
a discarded baseline. M1ab's own deliverable, beyond the shipped server, is the measurement itself —
total tokens and tool-call counts per arm, reported plainly, continuing v1.6 P65's own practice
rather than repeating its asserted-but-unmeasured-until-then gap. M2 (permissions tab + enforcement)
and M3 (EXPLAIN path) both extend M1's query tool and the connection model directly, so both come
right after M1ab lands; M2 before M3 since a heavy/DDL query's permission check should already exist
before EXPLAIN-gating logic is added on top of it. M4 (Faker over MCP) comes before M5: M5's
anonymization needs a way to produce a realistic, correlation-preserving replacement value, and Faker
is the natural generator for that — M4 builds the Go-to-Faker bridge as a tool in its own right, M5
reuses it as one of its anonymization methods rather than building a second bridge. M6/M7 (the two
code-review rounds) are last by construction, per `CLAUDE.md`'s standing process. M8 (main-docs
update) is last of all, needing the review rounds' fixes landed first, mirroring v1.6's own closing
row (P70).

**Review scope is wider than usual, by explicit instruction.** M6/M7 review this chapter's own diff
as normal, but also re-review v1.6's diff (`origin/main`..v1.6's tip, i.e. what P60-P70 actually
changed) specifically, plus anything else either reviewer notices while in that code — not narrowed
to only what M1-M5 touch.

| Phase | Deliverable | Why here |
|---|---|---|
| **M1 Local DB MCP server: list/metadata/query tools, 7-day rotating token** | Planned (`docs/v1.7/plans/M1-db-mcp-server-core.md`), implementation lands as part of **M1ab**. A new Go MCP server, sibling to `internal/repomap`, reusing its transport pattern (`go-sdk/mcp`, loopback-only streamable HTTP) but its own process/port/tool set: `list_connections` (every configured connection this app knows), `list_databases`/`list_schemas`/`describe_table` (metadata per adapter, routed through the existing `apps/kira-studio/internal/adapters/*` layer — no new metadata path), and `run_query` (executes through the same adapter query path the console UI uses). Auth is a static bearer token, but unlike `mcpauth`'s non-expiring token, this phase's own token carries a 7-day expiry and rotates — the plan designs where the expiry/rotation state lives (extend `mcpauth`, or a sibling package) and what a client sees when a token has lapsed (a distinct, actionable error, not a generic 401), plus the start/stop lifecycle and storage-root question (share `KIRA_HOME` with the repo-map server or use a distinct root) | First: every later phase (permissions, EXPLAIN, Faker, anonymization) extends this server's tool set or its query path — nothing else in this chapter can start before it exists |
| **M1ab A/B measurement: implement M1 with and without the repo-map MCP server** | Implements M1's already-approved plan twice, from the identical starting commit, in two isolated worktrees — one Sonnet subagent using the repo-map MCP server for navigation as `CLAUDE.md` instructs, one deliberately not (Grep/Read only), both implementing to real shipping quality so the comparison is fair. The MCP-using arm's implementation is the real one: it lands as M1's actual deliverable on `v1.7`. The other arm is a throwaway baseline, discarded after comparison. This phase's deliverable beyond the shipped server is the measurement itself — total tokens and tool-call counts for each arm, reported plainly, continuing v1.6 P65's own practice for this chapter | Needs M1's plan landed first; chosen as this chapter's A/B candidate over every other row because it's almost entirely Go with no `.vue` surface — the one phase this tool's confirmed Vue blind spot (`docs/v1.6/mcp-repo-map-issues.md`) doesn't undercut — and needs unusually broad unfamiliar-codebase navigation (`internal/repomap`, `internal/mcpauth`, the connection model, every adapter kind), the exact shape repo-map exists for |
| **M2 Connection editor: MCP tab, per-operation permissions (read/write/DDL), deny/allow/prompt enforcement** | A new tab in `ConnectionDialog.vue`'s existing tab strip (`DetailTab` gains a fourth value) holding: a free-text description field ("what this DB is for", passed to the AI client as connection metadata — likely surfaced via `list_connections`/`describe_table`'s own response), and three independent permission controls — read, write, DDL — each configurable to one of deny / allow / prompt. "Prompt" means: the query is not run until a human approves it, presented with the actual query text, in an approval UI this phase's own planning pass designs (a dialog, a persistent queue/dock — its own choice, working from what UI surfaces already exist for this kind of interrupt, e.g. the conflict banner precedent noted in v1.6's P67e row). Backend: extend `ConnectionFields` (new migration, following `0004_p18_auto_explain.sql`'s own precedent) with the description and three permission-mode columns; enforcement happens in M1's `run_query` tool handler, classifying the incoming statement (read/write/DDL) before executing it — this phase's own planning pass decides how that classification is done reliably per adapter kind (SQL parse vs. a per-kind heuristic; Mongo/Redis/S3 have no single "statement" shape, so this must generalize past SQL) | Right after M1ab lands: extends its one query-execution tool and the connection model directly |
| **M3 EXPLAIN path over MCP: parsed responses, auto-force-explain, heavy-query flag** | Exposes this app's existing EXPLAIN infrastructure (`AutoExplain`, `views/console/explain.ts`/`plan.ts`'s `parseExplainPages`) through the new MCP server: an `explain_query` tool returning the same nicely-parsed plan structure the console UI already renders, not a raw driver dump. A per-connection (or per-request) "auto-force-explain" setting runs EXPLAIN before every `run_query` call on the MCP path regardless of the client asking for it, and flags a query back to the human user (not silently to the AI) when the parsed plan crosses a heaviness threshold this phase's own planning pass defines (row-estimate, seq-scan-on-large-table, cost value — whatever `plan.ts`'s existing parse already exposes cheaply, extended only if genuinely needed) | Right after M2: both extend M1's query tool, and a heavy/DDL query's permission gate should already exist before EXPLAIN-gating logic layers on top |
| **M4 Faker exposed via MCP** | A `generate_fake_data` tool on the MCP server, producing values via the existing `@faker-js/faker` generator set (`views/grid/fakeData/types.ts`'s `GeneratorId` catalog: person.fullName, internet.email, location.city, etc. — reused, not reinvented) callable by an AI client independent of anonymization. Since the MCP server is a Go process and Faker is a JS library used today only via a browser-side dynamic import, this phase's own planning pass designs the actual bridge — most likely a small Bun/Node subprocess the Go tool invokes with a generator id/locale/count/seed and reads JSON back from, checking first whether `packages/api-core/src/http/dynamic/*`'s existing dynamic-HTTP-and-faker mechanism is already shaped to serve this rather than building a second one. Deterministic generation (same seed → same output) is a hard requirement, not optional — M5 depends on it for correlation-preserving anonymization | Before M5: M5's correlation-preserving anonymization needs a deterministic realistic-value generator, and this phase builds the one Go-to-Faker bridge both this tool and M5 share, rather than M5 building its own |
| **M5 Anonymization filters: per-column PII rules, correlation-preserving methods beyond hashing, applied over MCP and in the normal data viewer** | Per-column filter rules (which table.column pairs are PII, and by what method) configurable per connection — this phase's own planning pass decides the concrete UI (likely a table within M2's own MCP tab, or a schema-explorer-driven picker, whichever needs less new UI machinery) and the storage shape (a new table/migration, not a JSON blob nobody can query). At least two methods beyond plain hashing: a deterministic, seeded pseudonymization via M4's Faker bridge (same real value always maps to the same realistic-looking fake one, preserving correlation and referential joins across a foreign key without ever revealing the real value) and format-preserving masking for values where realistic-looking replacement isn't the point (e.g. partial redaction keeping a domain or a numeric range recognizable) — this phase's own planning pass states which method fits which PII class (name/email/free text vs. numeric/date) and why, rather than picking one default for everything. Applied in two places: (1) MCP query results pass through the configured filter before being returned to an AI client, per column; (2) the normal data viewer — `views/grid/DataView.vue`'s grid and the `celleditor/` cell editor — gets a toggle to view the same anonymized transform live over real data, per explicit instruction ("show using the normal data viewer"), never mutating the underlying row, purely a display-layer transform the user can turn on to see what an AI client would see | After M4: needs its deterministic generator already built; this phase adds the filter-rule storage/UI and the two consuming code paths (MCP result transform, grid/cell-editor display transform) |
| **M6 Code review, round 1** | Three parallel Opus subagents, one per dimension — architecture/security, functional correctness, performance/resource efficiency — findings-only, per `CLAUDE.md`'s own process. Scope is wider than a normal round, by explicit instruction: this chapter's own diff (M1ab, M2-M5) as the primary target, **plus a dedicated pass over v1.6's diff** (`origin/main`..v1.6's tip — P60-P70's actual changes), plus anything else either reviewer notices while in adjacent code. One sequential Sonnet subagent then fixes every finding judged real | After M1ab, M2-M5 land: a review needs a finished tree, and the v1.6-focused half needs v1.6 fully landed (already true) |
| **M7 Code review, round 2** | The same three-dimension cycle, run again in full — against the tree M6's fixes leave, plus the same wider v1.6-focused scope, re-read fresh rather than trusting M6's summary — per `CLAUDE.md`'s "repeat the whole loop" rule. A round finding nothing real says so rather than manufacturing a finding | After M6's fixes land |
| **M8 Update main docs** | Brings `README.md`, `docs/ARCHITECTURE.md`, `docs/DEV_ENVIRONMENT.md`, `CLAUDE.md` current for this chapter's new subsystem — a second MCP server, its permissions/anonymization/Faker model, and its Settings-dialog toggle — the same "read the current tree, don't trust prose" bar v1.6's own P70 used | Last of all: needs both review rounds' fixes landed first |

## Layout

- **`SPEC.md`** — this file, one row per phase, updated as phases land or split.
- **`plans/`** — one implementation plan per phase, committed before that phase's implementation
  starts, written by an Opus subagent per `CLAUDE.md`'s own process, never edited afterward.
- **`mcp-repo-map-issues.md`** — this chapter's own repo-map MCP dogfooding log, continuing the
  practice v1.5/v1.6 established.
