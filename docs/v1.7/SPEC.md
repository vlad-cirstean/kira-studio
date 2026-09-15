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
  existing token never expires ("a later run reuses it"); M1 adds 7-day rotating expiry to
  `mcpauth` itself, **applied to both servers** — the new DB MCP server's token from day one, and
  retrofitted onto the existing repo-map server's token, by explicit instruction, rather than two
  parallel token mechanisms living side by side in the same package.
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

**Rebased onto v1.6's tip after M1ab landed**, once v1.6 progressed further (through P67d): both
chapters touched `internal/repomap` independently — P67d made the repo-map server general and
multi-repo (a "Repository access" list in Settings, one repo per checkbox) and M1 added 7-day token
rotation retrofitted onto that same server's token. Both survive: the rotation now applies to
P67d's one app-scoped token, not per-repo. Real conflicts in `internal/repomap/server.go`,
`internal/bridge/repomap.go`, `cmd/kira-repo-map/main.go`, `conformance_test.go`, and
`SettingsDialog.vue`, resolved by reading both sides' intent rather than picking one; independently
re-verified (go build/vet/test, typecheck/lint, full `tests/ui/` suite including P67d's own
`settings-code-intelligence.spec.ts`) — all clean. Both chapters also picked migration number 0019
independently; M1's own migration is renumbered **`0020_m1_connection_mcp.sql`** post-rebase.
`docs/v1.7/plans/M1-db-mcp-server-core.md` still says `0019` — the plan doc is never edited after
landing, per `CLAUDE.md`; the shipped number is `0020`. **For M2's planning pass**: P67d's
"per-entity access list in Settings, additive to a global toggle" pattern is worth considering
for the Database MCP section too (an overview list of which connections are exposed, alongside the
richer per-connection read/write/DDL editor `ConnectionDialog` owns) — not required, since M2's
per-connection model is richer than a checkbox, but worth a deliberate yes/no rather than silence.

| Phase | Deliverable | Why here |
|---|---|---|
| **M1 Local DB MCP server: list/metadata/query tools, 7-day rotating token** | Planned (`docs/v1.7/plans/M1-db-mcp-server-core.md`), implementation lands as part of **M1ab**. A new Go MCP server, sibling to `internal/repomap`, reusing its transport pattern (`go-sdk/mcp`, loopback-only streamable HTTP) but its own process/port/tool set: `list_connections` (every configured connection this app knows), `list_databases`/`list_schemas`/`describe_table` (metadata per adapter, routed through the existing `apps/kira-studio/internal/adapters/*` layer — no new metadata path), and `run_query` (executes through the same adapter query path the console UI uses). Auth is a static bearer token with a 7-day expiry that rotates, built directly into `internal/mcpauth` (not a sibling package) so both this server's token and the **existing repo-map server's token are retrofitted onto the same mechanism** — by explicit instruction, the repo-map server's own currently-non-expiring token gains the identical 7-day rotation, not a second scheme. The plan designs the expiry/rotation record shape, the rotation trigger (auto-remint on expiry vs. requiring a manual remint — and whether that differs between the two servers given the repo-map server's headless/no-GUI usage pattern, `CLAUDE.md`'s own section), and what a client sees when a token has lapsed (a distinct, actionable error, not a generic 401), plus the new server's start/stop lifecycle and storage-root question (share `KIRA_HOME` with the repo-map server or use a distinct root) | First: every later phase (permissions, EXPLAIN, Faker, anonymization) extends this server's tool set or its query path — nothing else in this chapter can start before it exists |
| **M1ab A/B measurement: implement M1 with and without the repo-map MCP server** | Implements M1's already-approved plan twice, from the identical starting commit, in two isolated worktrees — one Sonnet subagent using the repo-map MCP server for navigation as `CLAUDE.md` instructs, one deliberately not (Grep/Read only), both implementing to real shipping quality so the comparison is fair. The MCP-using arm's implementation is the real one: it lands as M1's actual deliverable on `v1.7`. The other arm is a throwaway baseline, discarded after comparison. This phase's deliverable beyond the shipped server is the measurement itself — total tokens and tool-call counts for each arm, reported plainly, continuing v1.6 P65's own practice for this chapter | Needs M1's plan landed first; chosen as this chapter's A/B candidate over every other row because it's almost entirely Go with no `.vue` surface — the one phase this tool's confirmed Vue blind spot (`docs/v1.6/mcp-repo-map-issues.md`) doesn't undercut — and needs unusually broad unfamiliar-codebase navigation (`internal/repomap`, `internal/mcpauth`, the connection model, every adapter kind), the exact shape repo-map exists for |
| **M1c Repo-map MCP: fix the struct-field reference/definition gap** | `find_references`/`search_symbols` return nothing for a Go struct field reached only via a selector expression (`f.AutoExplain`, `c.ThrottlePerSec`, `McpEnabled`) — a distinct gap from the already-fixed const/type-alias captures (v1.5 C8, v1.6 P64/P64b) and from P67f's range/index-expression fix, logged non-trivial in `docs/v1.7/mcp-repo-map-issues.md` during M1ab and reproduced again during M2's planning. `CLAUDE.md`'s own rule requires this closed before the next phase's implementation starts, same shape as v1.6's P64/P68b/P69d/P69e gating fixes. This phase's own planning pass locates the tree-sitter query gap (likely `go/tags.scm`'s field-declaration/selector-expression captures) and fixes it | Non-trivial dogfooding finding from M1ab, reproduced during M2's planning; gates M2's implementation, not M2's own plan (already written) — same P63→P64→P65 shape v1.6 used |

**M1c result**: root cause was two-part, verified empirically before the fix — Go/TS/JS field declarations were never indexed as symbols at all (`search_symbols` found nothing) *and* a plain `x.Field`/`obj.prop` read was never captured as a reference (only call-position selectors were, from prior work). Fixed with a new `@reference.field` kind rather than reusing `@reference.read`, since that kind's cross-directory tier-clamp would have left the original bug unfixed. Extended to TypeScript/JS (same defect class, P64b precedent); declined for Java/Python/Rust (2 fixture files each, no real user) and for object/composite-literal keys (syntactically ambiguous with map literals in Go, 25,490:5,493 noise ratio in TS). `extractionVersion` bumped 3→4, forcing a one-time full reindex on next sync (expected, not a bug). Independently re-verified live against the server, not just the implementer's own report: `search_symbols`/`find_references` on `ConnectionFields.AutoExplain` now resolve correctly (exactly 7 references, exact lines). Landed `f453ee37`..`247880c2`.
| **M2 Connection editor: MCP tab, per-operation permissions (read/write/DDL), deny/allow/prompt enforcement** | A new tab in `ConnectionDialog.vue`'s existing tab strip (`DetailTab` gains a fourth value) holding: a free-text description field ("what this DB is for", passed to the AI client as connection metadata — likely surfaced via `list_connections`/`describe_table`'s own response), and three independent permission controls — read, write, DDL — each configurable to one of deny / allow / prompt. "Prompt" means: the query is not run until a human approves it, presented with the actual query text, in an approval UI this phase's own planning pass designs (a dialog, a persistent queue/dock — its own choice, working from what UI surfaces already exist for this kind of interrupt, e.g. the conflict banner precedent noted in v1.6's P67e row). Backend: extend `ConnectionFields` (new migration, following `0004_p18_auto_explain.sql`'s own precedent) with the description and three permission-mode columns; enforcement happens in M1's `run_query` tool handler, classifying the incoming statement (read/write/DDL) before executing it — this phase's own planning pass decides how that classification is done reliably per adapter kind (SQL parse vs. a per-kind heuristic; Mongo/Redis/S3 have no single "statement" shape, so this must generalize past SQL) | Right after M1c closes the gating dogfooding finding: extends M1's one query-execution tool and the connection model directly |

**M2 result**: landed per plan (`docs/v1.7/plans/M2-connection-permissions.md`), 9 commits
(`8112097d`..`ef2ed03b`), migration `0021_m2_connection_permissions.sql`. Statement classification:
an optional `adapters.StatementClassifier` (not a required `Adapter` method), shared `ClassifySQL`
for the five SQL kinds, Mongo/Redis reusing their own existing statement/command inspection, Kafka/
S3/SQS unreachable via `run_query` and left unimplemented. Approval UI: an `ApprovalBroker` modeled
on `internal/gitsock`'s own FIFO broker (a client disconnect stops the wait via `ctx`, no external
expiry ticker), a modal dialog mounted beside `GitPairingDialog`. Gate order in `run_query`: refuse
before connecting if all three modes deny, connect, classify (a classifier error degrades to
`unknown`, never bypasses the gate), verdict, execute — `unknown` resolves to the strictest of the
three modes. Settings gained a read-only per-row glance on the existing "Exposed connections" list
(no second editor); all editing stays in `ConnectionDialog`'s new fourth tab. Independently
re-verified: `go test ./...` clean, `dbmcp/approval_test.go` and `adapters/classify_test.go` clean
under `-race -count=5`, full `tests/ui/` suite 273/273 on real webkit, and the gate order read
directly from `tools.go`'s `runQuery` matches the plan exactly (refuse-before-connect, degrade-not-
bypass on classifier error, strictest-of-three for `unknown`).
| **M3 EXPLAIN path over MCP: parsed responses, auto-force-explain, heavy-query flag** | Exposes this app's existing EXPLAIN infrastructure (`AutoExplain`, `views/console/explain.ts`/`plan.ts`'s `parseExplainPages`) through the new MCP server: an `explain_query` tool returning the same nicely-parsed plan structure the console UI already renders, not a raw driver dump. A per-connection (or per-request) "auto-force-explain" setting runs EXPLAIN before every `run_query` call on the MCP path regardless of the client asking for it, and flags a query back to the human user (not silently to the AI) when the parsed plan crosses a heaviness threshold this phase's own planning pass defines (row-estimate, seq-scan-on-large-table, cost value — whatever `plan.ts`'s existing parse already exposes cheaply, extended only if genuinely needed) | Right after M2: both extend M1's query tool, and a heavy/DDL query's permission gate should already exist before EXPLAIN-gating logic layers on top |

**M3 result**: landed per plan (`docs/v1.7/plans/M3-explain-path.md`), 5 commits (`95ede279`..
`23a1a80d`), migration `0022_m3_connection_mcp_explain.sql`. `internal/queryplan` ports the
existing frontend EXPLAIN parser to Go rather than bridging languages (that bridge is M4's own
deliverable), pinned against a shared fixture set both `internal/queryplan/parse_test.go` and
`tests/unit/explain-plan.spec.ts` read, so drift in either port fails on the same bytes.
`explain_query` refuses anything but SELECT/WITH (reusing `isExplainable` verbatim — a DDL/DML
statement never gets its own EXPLAIN path, closing off a potential write-statement oracle on
ClickHouse, where EXPLAIN can execute its target on some forms) and refuses unsupported adapter
kinds before connecting. Auto-force-explain is a **new** `mcp_auto_explain` column, deliberately
not reusing the existing human-facing `AutoExplain` console flag. The heaviness flag reuses M2's
`ApprovalBroker`/`DbMcpApprovalDialog.vue` directly (`Reason: "heavy"` alongside the existing
`"permission"`, at most one prompt per call when both apply) rather than new UI machinery.
Independently re-verified: `go test ./...` clean (excluding a confirmed pre-existing, unrelated
container-suite staleness — `docs/ARCHITECTURE.md`'s Known open items), both parity-fixture suites
green (15/15 Go, 30/30 TS, same files), full `tests/ui/` suite clean (one grid-pacing timing flake,
unrelated code, passes in isolation), and the `run_query`/`explain_query` gate order read directly
from `tools.go` matches the plan's §5.2/§8.1 exactly.
| **M4 Faker exposed via MCP** | A `generate_fake_data` tool on the MCP server, producing values via the existing `@faker-js/faker` generator set (`views/grid/fakeData/types.ts`'s `GeneratorId` catalog: person.fullName, internet.email, location.city, etc. — reused, not reinvented) callable by an AI client independent of anonymization. Since the MCP server is a Go process and Faker is a JS library used today only via a browser-side dynamic import, this phase's own planning pass designs the actual bridge — most likely a small Bun/Node subprocess the Go tool invokes with a generator id/locale/count/seed and reads JSON back from, checking first whether `packages/api-core/src/http/dynamic/*`'s existing dynamic-HTTP-and-faker mechanism is already shaped to serve this rather than building a second one. Deterministic generation (same seed → same output) is a hard requirement, not optional — M5 depends on it for correlation-preserving anonymization | Before M5: M5's correlation-preserving anonymization needs a deterministic realistic-value generator, and this phase builds the one Go-to-Faker bridge both this tool and M5 share, rather than M5 building its own |
| **M5 Anonymization filters: per-column PII rules, correlation-preserving methods beyond hashing, applied over MCP and in the normal data viewer** | Per-column filter rules (which table.column pairs are PII, and by what method) configurable per connection — this phase's own planning pass decides the concrete UI (likely a table within M2's own MCP tab, or a schema-explorer-driven picker, whichever needs less new UI machinery) and the storage shape (a new table/migration, not a JSON blob nobody can query). At least two methods beyond plain hashing: a deterministic, seeded pseudonymization via M4's Faker bridge (same real value always maps to the same realistic-looking fake one, preserving correlation and referential joins across a foreign key without ever revealing the real value) and format-preserving masking for values where realistic-looking replacement isn't the point (e.g. partial redaction keeping a domain or a numeric range recognizable) — this phase's own planning pass states which method fits which PII class (name/email/free text vs. numeric/date) and why, rather than picking one default for everything. Applied in two places: (1) MCP query results pass through the configured filter before being returned to an AI client, per column; (2) the normal data viewer — `views/grid/DataView.vue`'s grid and the `celleditor/` cell editor — gets a toggle to view the same anonymized transform live over real data, per explicit instruction ("show using the normal data viewer"), never mutating the underlying row, purely a display-layer transform the user can turn on to see what an AI client would see | After M4: needs its deterministic generator already built; this phase adds the filter-rule storage/UI and the two consuming code paths (MCP result transform, grid/cell-editor display transform) |
| **M6 Code review, round 1** | Three parallel Opus subagents, one per dimension — architecture/security, functional correctness, performance/resource efficiency — findings-only, per `CLAUDE.md`'s own process. Scope is wider than a normal round, by explicit instruction: this chapter's own diff (M1ab, M2-M5) as the primary target, **plus a dedicated pass over v1.6's diff** (`origin/main`..v1.6's tip — P60-P70's actual changes), plus anything else either reviewer notices while in adjacent code. One sequential Sonnet subagent then fixes every finding judged real | After M1ab, M2-M5 land: a review needs a finished tree, and the v1.6-focused half needs v1.6 fully landed (already true) |
| **M7 Code review, round 2** | The same three-dimension cycle, run again in full — against the tree M6's fixes leave, plus the same wider v1.6-focused scope, re-read fresh rather than trusting M6's summary — per `CLAUDE.md`'s "repeat the whole loop" rule. A round finding nothing real says so rather than manufacturing a finding | After M6's fixes land |
| **M8 Update main docs** | Brings `README.md`, `docs/ARCHITECTURE.md`, `docs/DEV_ENVIRONMENT.md`, `CLAUDE.md` current for this chapter's new subsystem — a second MCP server, its permissions/anonymization/Faker model, and its Settings-dialog toggle — the same "read the current tree, don't trust prose" bar v1.6's own P70 used | Last of all: needs both review rounds' fixes landed first |

## M1ab result

Both arms implemented to real shipping quality from commit `b46eac88`, verified independently
(re-run, not trusted from either arm's self-report).

**Tokens/tool calls** (arm A = with repo-map MCP, arm B = without, Grep/Read only):

| | Arm A | Arm B |
|---|---|---|
| Tokens | 516,104 | 451,263 |
| Tool calls | 339 | 332 |
| Wall clock | ~49 min | ~43 min |

The MCP-assisted arm used more tokens and more tool calls, not fewer. Repo-map saved specific
whole-file reads (`outline_file` on `page/builder.go` avoided ~10 unneeded `read_symbol` calls;
`read_symbol` sized `dbmcp`'s consumer interfaces without reading `tree.Service`'s 300 lines) but
that didn't net an overall efficiency win on this phase. Recorded plainly since it cuts against the
working assumption that repo-map saves tokens on backend-heavy work — continuing v1.6 P65's own
practice of reporting the number whether or not it favors the tool.

**Quality**: independent review found both arms fully implemented the plan's §7 file list, both
pass `go build/vet/test` and `bun typecheck/lint/build`, both include the `MkdirAll` fix (§2.6), no
stubs or shortcuts in either. Each had one real defect: arm A's `run_query` forced a full
reconnect (live adapter torn down, cache dropped, pre-connect script re-run) on every call, even to
an already-connected connection, and didn't surface a failed connect's own error text; two
Playwright fixtures (`preconnect.spec.ts`, `secrets.spec.ts`) also missed the new `mcpEnabled`
field. Arm B never hydrated `settingsState.dbMcp` from persisted settings, so the Database MCP
panel — including Regenerate — reads as disabled and hidden after every app restart, even when the
server is actually running.

**Outcome**: arm A's three defects fixed in two follow-up passes on `v1.7-m1ab-arm-a` — the reconnect
churn and error-surfacing fix (`8e2542d9`) plus a regression test (`access_test.go`), then a full
sweep of the `mcpEnabled` fixture gap across every `tests/ui/` spec after the first pass's own fix
turned out to miss instances beyond the two specs it targeted (`764f6e61`). Both independently
re-verified against the actual pre-M1 base commit, not trusted from self-report — a claim that one
of the fixture failures was "pre-existing" turned out to be wrong (the base commit passes cleanly
once actually built; it was a real regression). Landed on `v1.7` via merge commit `dfa45459`
(non-fast-forward, since `v1.7` gained two doc-only commits after the worktrees branched); go
build/vet/test, bun typecheck/lint, and the full `tests/ui/` Playwright suite (269/269, real
webkit, correct `KIRA_DEBUG_HOOKS=1` test build) all independently re-run clean post-merge. One
pre-existing, unrelated `internal/repomap` test failure (a `git`-invocation panic, reproduces
identically on arm B and on code the M1 diff never touches — a sandbox git-path issue, not a code
defect) and one pre-existing `internal/gitsock` timing flake (passes 3/3 in isolation) were
confirmed unrelated, not fixed. Arm B (`v1.7-m1ab-arm-b`) discarded after comparison.

## Layout

- **`SPEC.md`** — this file, one row per phase, updated as phases land or split.
- **`plans/`** — one implementation plan per phase, committed before that phase's implementation
  starts, written by an Opus subagent per `CLAUDE.md`'s own process, never edited afterward.
- **`mcp-repo-map-issues.md`** — this chapter's own repo-map MCP dogfooding log, continuing the
  practice v1.5/v1.6 established.
