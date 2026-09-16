# Working agreement

## Communication style

Applies everywhere in this repo and every session working on it — chat replies, code comments,
commit messages, issue/PR/MR text, and every markdown doc in the repo (this file included). Sole
exception: `README.md` at repo root stays normal prose, since it's the outward-facing entry point
for people outside this convention.

Write terse. Substance only, no filler. Cut articles (a/an/the), hedge words (just/really/
basically/actually/simply), and pleasantries (sure/certainly/of course/happy to). Fragments are
fine. Prefer the short word over the long phrase (`fix` not `implement a solution for`). Standard,
widely-known acronyms are fine (DB, API, HTTP); never invent new shortenings (cfg, impl, req, res,
fn) — a tokenizer splits an invented abbreviation same as the full word, so it saves nothing and
just costs the reader a decode. Same logic kills arrow connectors (`→`): no shorter than the word
they replace. Never pad a sentence to *sound* terse either — compression only shrinks, it never
grows.

Never touch: negation words (not/never/no/only/except), numbers, units, code blocks, error strings,
API/CLI names, exact technical terms. Dropping or softening any of those flips meaning for a token
or two saved — never worth it.

Blend in plain-language clarity discipline: one idea per sentence, ~20 words max, active voice,
present tense where true, imperative for instructions ("Run X", not "X should be run"), one term
per concept (no synonym rotation), a pronoun only when its referent is unambiguous. Where caveman
terseness and this clarity discipline pull against each other, clarity wins.

No tool-call narration or preamble. No decorative tables or emoji. Don't dump raw logs or output
unless asked — quote just the one decisive line.

Drop all of the above and write normal prose for: security warnings, confirming an irreversible
action, a multi-step sequence where a dropped article or fragment could genuinely be misread, or
any other spot where the compression itself creates ambiguity. Resume terse style right after.

And the actual governing rule above all of these: if the terse phrasing isn't shorter than the
plain phrasing, use the plain phrasing. This is about saving real tokens, not performing a style.

This file is process only: how this team works. Facts about the app itself — driver choices,
protocol constraints, capability quirks, known open limitations — live in `docs/ARCHITECTURE.md`.
How to build, run and test things in whatever sandbox a session happens to be in — credential
constraints, container quirks, per-subsystem setup — lives in `docs/DEV_ENVIRONMENT.md`. Neither is
duplicated here; this file only points at them.

**Opus plans, a Sonnet subagent implements — this session only orchestrates.**

- The **main session runs on Sonnet and orchestrates only** — it doesn't implement, edit code, or
  fix findings directly. Its job: spawn the right subagents in order, carry context between them,
  and track progress. The actual writing always happens in a subagent.
- Each phase (the current chapter's `SPEC.md` phasing table — `docs/v1.8/` today) needs an
  Opus-authored plan committed under that chapter's `plans/` before implementation starts — spawn
  an **Opus subagent** (`Agent` tool, `model: "opus"`) whose only job is writing that plan. No plan
  there means no implementing straight from the spec; get the plan written and committed first.
- **Once the plan lands, spawn a Sonnet subagent** (`model: "sonnet"`) to implement it. Default to
  **one sequential subagent for the whole phase** — a fresh subagent starts cold, so its prompt
  must carry the plan and whatever prior-phase context it needs; never assume it remembers
  anything. **Parallel subagents only when the plan's work is genuinely independent** (unrelated
  adapters, non-overlapping fixes) — never split one continuous, order-dependent piece of work
  across subagents to run it concurrently.
- **Implement the whole plan first, then test once and fix what's found** — don't gate every
  intermediate commit on the full test suite. Fast checks (typecheck, lint, build) are cheap and
  fine per-commit; an expensive suite (end-to-end/UI, a real-hardware check) runs once near phase
  end, with fixes landing as follow-up commits. Commits still land incrementally as work completes,
  for legible history — only *when* the expensive verification happens changes, not whether the
  result must be correct or commits stay granular.
- **The loop per phase:** check for a plan, spawn an Opus subagent to write one if missing, spawn
  a Sonnet subagent (or several, only if genuinely parallelizable) to implement the whole phase, and
  wait for it before moving on. One phase at a time, in order — never parallelize or batch phases.
- **Multiple passes/iterations/rounds means repeat the whole loop that many times**, not run it once
  and treat extras as optional. Each pass plans against the *current* tree (on top of everything the
  previous pass landed, never the pre-phase state) and gets its own file under the current
  chapter's `plans/` (a phase's plan plus `-iter2`/`-iter3` suffixes), so what each round found
  stays legible. A planning pass re-reads the current source rather than trusting the previous
  pass's summary prose, and states plainly when a pass finds nothing real rather than manufacturing
  a finding.
- **"Code review"** (once a phase or batch is otherwise complete, on request) means three **Opus
  subagents in parallel**, one per dimension: (1) architecture/structure/maintainability/security,
  (2) functional correctness and business logic, (3) performance and resource efficiency. Each only
  reports findings, never fixes. Then one sequential Sonnet subagent fixes every finding (parallel
  only for a batch genuinely isolated from each other). Repeat the whole three-agent cycle for as
  many rounds as asked — a round finding nothing real should say so, not manufacture a finding. No
  findings document survives a round once fixed — each finding gets fixed and committed one at a
  time, so the commit log is the durable record. Carry forward only a genuinely still-open item (see
  "Known open items"), never a running narrative of what each round found.
- No per-phase PRs. One feature branch per chapter.
- **Every chapter uses `P` phase numbers, one running sequence across the whole repo, not
  per-chapter.** v1.1/v1.2/v1.4/v1.6/v1.8 continue one counter (v1.6 topped out at `P70`; v1.8
  starts at `P71`). Before opening a new chapter, scan every prior chapter's `SPEC.md` for the
  highest `P` number used across all of them, not just the chapter immediately before it, and
  continue from there — regardless of whether that chapter was shaped as independent misc phases or
  one cohesive subsystem. v1.5's `C` lettering and v1.7's `M` lettering predate this rule and stay
  as shipped, never renumbered after landing; every chapter from here on, cohesive-subsystem chapters
  included, uses `P`.
- **Best practices throughout, no shortcuts** — no stubbed error handling, no `TODO: fix later`, no
  skipped validation to make something demo. Scope left out of a phase stays out entirely, never
  half-implemented.
- **Reach for an existing, well-maintained library before hand-rolling non-trivial infrastructure**
  — a parser, a virtualizer, a positioning engine, retry/backoff, and similar. This repo already
  relies on Monaco, zod, sql-formatter and SlickGrid rather than reimplementing them. A
  hand-rolled version earns its keep only against a real requirement no library meets (e.g.
  spelling-preserving timestamp re-encoding, or the parse tree P60b's SQL tokenizer replaced after
  the library carrying it was removed app-wide) — name that requirement when declining a library,
  not just that existing code already works.
- **Only fully open-source libraries** — no community edition of a dual-licensed product, no
  non-commercial-only tier, no functionality gated behind a paid/Enterprise tier. Check the license
  at the package level *and* for the specific feature used, not just the headline badge (AG Grid
  Community's own license is fine; the context menu/range selection/clipboard features this app
  needed are Enterprise-only, so declined). Applies to every new dependency.
- **Measure when there's a real, concrete question at stake, not as a default ritual.** A
  real-hardware trace, CDP tracing, or a byte-for-byte bundle comparison earns its keep when a
  claimed fix, regression, or cost genuinely can't be checked another way. Don't extend that rigor
  to routine changes or every declined option — a short honest estimate or a plain read of the
  code's/library's stated behavior is enough there. Skip a measurement that wouldn't change the
  decision.
- **Comments: very concise, only where truly necessary.** Add one only when the code can't say it
  — a non-obvious *why*, a constraint, a workaround. Never restate what the code shows.
- **Unit tests exist only for advanced, complex or deeply nested logic — this app has very little.**
  Default to *no dedicated unit test*. A test earns its keep only guarding something genuinely hard
  to get right: a parser/splitter with several interacting rules, cursor/pagination boundary
  arithmetic, cache eviction/invalidation with interacting rules, crypto beyond
  encrypt-then-decrypt, concurrency (ordering, backpressure, cancellation, races), or a decision
  structure too large to hold in your head. Everything else gets nothing: CRUD round-trips (even
  integration-shaped), one/two-condition validation, required-field/enum guards, thin pass-through
  wrappers, constructors/builders, format round-trips with no edge case,
  single-bad-input-to-single-error paths, anything that mostly restates a short function body. A
  single `if` guarding one obvious case isn't complexity. When torn between two similar tests,
  delete. Applies going forward, not as a retroactive cleanup.
- **The adapter conformance suites are exempt from that bar, not an application of it.**
  `apps/kira-studio/internal/adapters/*/*_test.go` are the sole successor to the deleted
  `packages/db-fixtures/*.spec.ts` files — nothing else exercises a Go adapter capability by
  capability (`tests/e2e-real/` only spot-checks a scenario or two per kind). Keep per-capability
  coverage there even where it reads like a CRUD round-trip; prune only genuine duplication.
- **Real-container adapter tests split into two suites, by design (P25).** A *general* suite runs
  frequently in the normal dev/CI loop — basic per-adapter connectivity sanity, not the full
  permutation matrix. A *complete* suite runs only on-demand and in CI — the full auth/config
  permutation matrix per adapter (root vs. least-privilege user, with/without password, with/without
  the database-equivalent field) plus error-handling verification, deliberately comprehensive since
  it's opt-in, not part of every local run. Extend the complete suite's own harness for new
  functional coverage (load/write/delete/filter/DDL, per adapter) rather than building a parallel
  mechanism — it's designed for that (P25's own `Scenario`/`Requires` seam, populated by P26).
- **Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)** —
  `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, with a `!` or `BREAKING CHANGE:` footer
  for breaking changes.
- **Keep this file lean — prune as you go, don't just append.** An app fact belongs in
  `docs/ARCHITECTURE.md`; an environment/tooling fact belongs in `docs/DEV_ENVIRONMENT.md`; a phase
  or review round's discovery belongs in that phase's plan doc under the current chapter's `plans/`
  (never a permanent "findings" section here — the plan doc and commit log are the durable record,
  not this file). Before adding a bullet, ask whether it's a standing rule for how this team works,
  not a one-off result or a fact about the app/environment. When you touch this file, remove what's
  gone stale too — a pointer to a deleted file/subsystem, a question a later phase already resolved.
- **`docs/ARCHITECTURE.md` keeps its own "Known open items" section** for a real, currently-true
  limitation (not a TODO or a wishlist) — keep an entry only while genuinely open, delete it the
  moment it's resolved, not marked done in place.
- **`.github/workflows/` can't be pushed from this session** (an OAuth scope limit, not a policy
  choice) — see `docs/DEV_ENVIRONMENT.md`'s own section for the constraint and the
  `docs/pending-changes/`/`docs/pending-workflows/` workaround before touching a workflow file.

## Repo-map MCP server

Code navigation over this repository's own tree-sitter graph (C3, `internal/repomap`), served as MCP
tools: `find_definition`, `find_references`, `find_implementations`, `search_symbols`,
`search_files`, `outline_file`, `read_symbol`, `list_repos`. Ask it instead of opening whole files to
find a symbol or read one declaration — the tokens that saves are the point. Multi-repo attach is
now the normal case (P67d), so every navigation tool other than `list_repos` itself takes an
optional `repo` argument naming which attached repository to query — omit it when only one is
attached; call `list_repos` first to see the names when unsure.

**Use it when working in this repository.** Standing expectation, not a demo: start it and navigate
with it.

Headless setup, for a session with no GUI:

1. `bun run mcp:repo-map:build` — once per clone, since the first build is slow (cgo).
2. `bun run mcp:repo-map` — rebuilds (cached, sub-second), then serves in the foreground; background
   it, since the next steps need the same shell. It serves this worktree's root.
   `bun run mcp:repo-map --repo <path>` serves another checkout instead. **If the startup banner
   says "Using this repository's existing token" instead of printing a `claude mcp add` command**,
   a prior session (in this container, within the last 7 days) already minted one — this session
   has no way to know that plaintext and cannot call the server at all as-is. This is now the
   common case in a multi-session container, not an edge case: delete that repository's
   `mcp-repo-map-*-token.json` under `KIRA_HOME` and restart to mint a fresh one before continuing
   to step 3/4, rather than debugging what looks like a 401.
3. `claude mcp add --transport http --scope user kira-repo-map http://127.0.0.1:8765/mcp --header
   "Authorization: Bearer <token>"` — the command it prints on startup; use the host and port from
   that printed banner, not this literal — 8765 is only the first choice, and a second concurrent
   instance lands on an OS-assigned ephemeral port. **In an agent-harness
   session (this one, and every subagent spawned in it) this registers but never actually surfaces
   the eight tools** — the tool manifest here is fixed when the session starts, not read from MCP
   config at runtime, confirmed by checking a genuinely fresh sibling session: it saw zero MCP
   servers configured, not just this one missing. Run the command anyway (`claude mcp list` then
   reports "✓ Connected", useful as a smoke check the server itself is healthy) but don't expect
   `ToolSearch` or a native `mcp__kira-repo-map__*` tool call to work.
4. **Call it over plain HTTP/JSON-RPC instead** — the actual working path in this harness. Same
   banner-port caveat as step 3 — `8765` below is illustrative, not a constant:
   ```
   curl -s http://127.0.0.1:8765/mcp -H "Authorization: Bearer <token>" \
     -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
          "params":{"name":"search_symbols","arguments":{"query":"<name>","limit":10}}}'
   ```
   Response arrives as one `event: message` / `data: {...}` line (SSE framing over a single
   response, not a stream) — the payload is standard JSON-RPC, `result.content[0].text` is the
   answer. `tools/list` (no `params` needed beyond `{}`) returns every tool's real name and
   JSON Schema — read a tool's actual `inputSchema` before calling it rather than guessing a
   parameter name (`search_symbols` takes `query`, not `symbol`, for instance). The same eight
   tools as the native surface: `find_definition`, `find_references`, `find_implementations`,
   `search_symbols`, `search_files`, `outline_file`, `read_symbol`, `list_repos`. The token savings
   this server exists for come from the response being a targeted answer instead of a whole file,
   which curl doesn't change — only the transport is manual, not the value.

Each repository's token is stored hashed under `KIRA_HOME` and expires after 7 days (M1): a later
run within that window reuses it and prints a note instead of a command; an already-registered
client keeps working. Once it lapses, restart mints a fresh one automatically — no manual deletion
needed — but the printed `claude mcp add` command must be re-run, since the old registration no
longer authenticates. To force a fresh token before it lapses, delete that repository's
`mcp-repo-map-*-token.json` and restart.

**Log what dogfooding finds** in the current chapter's own `mcp-repo-map-issues.md` (`docs/v1.8/`
today). Trivial (config, registration, wiring): fix inline, log one line. Non-trivial (wrong result,
missing tool, crash): log a full entry and fix nothing in that phase — the next phase waits for a
dedicated fix pass to close it.

Development use only. The shipped end-user surface — the Settings dialog's Code intelligence tab —
is product, not process; `docs/ARCHITECTURE.md` describes it and how the server works,
`docs/DEV_ENVIRONMENT.md` covers log level, cleanup and this container's own quirks. The app's other
MCP server (database access, v1.7) is product too, not this section's tool — nothing here asks a
session to run or dogfood it.
