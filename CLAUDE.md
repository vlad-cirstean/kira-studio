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
- **A genuinely independent split runs as named streams** (Stream A, Stream B, …), each its own git
  worktree off the same base commit — the pre-commit hook lints/typechecks the whole tree, so a
  shared checkout would fail implementers' commits on each other's half-done edits. The plan states
  the split explicitly: a per-stream file-ownership table with zero overlap, plus confirmation of no
  ordering dependency between streams. No such confirmation means no split — default back to one
  sequential implementer (P110's iter2 plan rejected a split: real overlap in a shared script, plus
  a rename dependency chain between two would-be streams). Cap concurrent streams at 2 unless the
  user says otherwise. Landing: once every stream is implemented and independently verified, rebase
  each onto the chapter branch in any order (a real conflict means the ownership boundary was wrong),
  remove the worktrees, push. A worktree survives a container restart — resume a stopped stream from
  its last commit, never restart from scratch.
- **Implement the whole plan first, then test once and fix what's found** — don't gate every
  intermediate commit on the full test suite. Fast checks (typecheck, lint, build) are cheap and
  fine per-commit; an expensive suite (end-to-end/UI, a real-hardware check) runs once near phase
  end, with fixes landing as follow-up commits. Commits still land incrementally as work completes,
  for legible history — only *when* the expensive verification happens changes, not whether the
  result must be correct or commits stay granular.
- **The loop per phase:** check for a plan, spawn an Opus subagent to write one if missing, spawn
  a Sonnet subagent (or several, only if genuinely parallelizable) to implement the whole phase, and
  wait for it before moving on. One phase at a time, in order — never parallelize or batch phases.
  **A phase isn't done until it's both planned and implemented.** Don't start the next phase's
  plan — don't even spawn its Opus subagent — until the current phase's Sonnet implementer has
  finished and its work is committed. This applies across phases only: the "parallel subagents
  only when genuinely independent" allowance above is scoped to splitting one phase's own
  implementation work, never to running two different phases (or their planning and
  implementation) at the same time.
- **The orchestrating session verifies before accepting — a plan or an implementation isn't done
  because a subagent says so.** Before marking a phase's plan, or its implementation, complete,
  check the result against the full original ask: the `SPEC.md` row's own wording, the user's own
  request, and every standing rule this file states (library adoption, primitive replacement,
  scope boundaries) — not just that hooks/tests pass. Verify with a real check (a grep for actual
  usage, a build, a count against the plan's own numbers), not by re-reading the subagent's result
  section and trusting its prose — a claim like "X now uses library Y" gets confirmed by finding a
  real caller of Y, not by X being present in the repo. Anything short of the full ask — a
  narrowed scope nobody agreed to, a requirement quietly dropped, a library "adopted" only as
  unused scaffolding — goes back to a subagent to fix, same phase, same number. Never accept a
  partial result and move on, and never silently re-scope the ask down to match what was
  delivered; only the user narrows their own request.
- **Everything must be resumable from disk alone — a subagent or the orchestrating session can
  halt at any point, mid-phase, with no warning.** A crash, a rate limit, a kill, a context cutoff:
  none of these are edge cases to plan around later, they are the normal operating condition every
  step must already survive. So state the next step depends on never lives only in a subagent's own
  conversation — a review's findings, an audit's list, anything a later subagent or the
  orchestrating session will need — it gets written to a file as its own step, on its own commit if
  the repo's tracking it, before or as part of any handoff, never held back for a single later
  subagent to fold into a closing summary. Concretely: a review subagent writes its findings to a
  file under the current chapter's `plans/` before a fixer ever starts (never just a conversational
  handback the fixer is trusted to remember); a fixer commits each finding's fix as its own commit
  as it lands, not batched for one commit at the end. If a run is interrupted, what actually landed
  (commits, findings files, plans) must be enough to see exactly where it stopped and pick back up
  — never a state where recovering means re-deriving work an interrupted subagent already did but
  never wrote down.
- **A failing test, lint finding, typecheck error, or any other code-quality/hook check gets fixed
  on the spot, pre-existing or not.** "Pre-existing" justifies skipping root-cause investigation of
  whether *this phase* caused it, never skipping the fix itself. Confirm it predates the phase (e.g.
  `git diff --stat` against the phase's start commit touches none of the failing file), then fix it
  in that same implementation pass and commit it — don't just note it as pre-existing/unrelated and
  move on. Only exception: fixing it needs work genuinely outside the phase's own scope (a different
  subsystem, a real design decision) — then it becomes its own named follow-up phase in `SPEC.md`,
  not a line in a result section.
- **`--no-verify` never means done.** A pre-commit hook failure (test, lint, typecheck, or any other
  check the repo runs) gets root-caused and fixed, full stop — `--no-verify` is not a way to finish
  and move on with the hook still failing. It only ever buys time to commit mid-investigation; the
  hook must pass, clean, in a normal (non-bypassed) commit before the phase — or any task — counts
  as done. Never report something complete while a hook, on any commit that will ship, is still red.
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
- **Splitting a phase keeps its number — it doesn't consume a new one, when an agent is the one
  deciding to split it.** A subagent (an Opus planning pass finding the scope is really two
  pieces, or anyone else in the loop) that decides a `SPEC.md` row needs splitting renames it
  `P<n> Part 1: …` and adds `P<n> Part 2: …` (`Part 3`, etc.) right after it — never `P<n>` plus a
  freshly incremented `P<n+1>`. Each part still gets its own plan under `plans/`, its own
  implementation pass, and its own result section — the split only changes the numbering, not the
  loop each part goes through. This is the agent default, not an absolute: the user can still ask
  for a split into new, separate `P` numbers directly (P98/P99 in v1.9 is exactly that, done at the
  user's own request before this rule existed) — that call is the user's to make, not a subagent's
  or the orchestrating session's own to infer.
- **Table position and `P` number stay in lockstep, no exceptions.** A phase that must run earlier
  than already-numbered ones (a dependency discovered later, a phase whose files a later one would
  otherwise touch twice) takes the earlier slot's number and every phase from there on shifts up by
  one. A phase that must run later than its original slot (a dependency on a later phase's own work
  landing first, discovered after numbering) is renumbered to its new position instead — the highest
  number, if it moves to the end. Never a number that contradicts table position, in either
  direction; there is no reordering that skips the renumber (v1.9's P101 was briefly treated as an
  exception, then reversed and renumbered to P105 once this contradiction was noticed — that
  precedent stands for "renumber," not "leave a gap"). Update every cross-reference to a renumbered
  phase in the same pass (other rows' prose, not just titles) so nothing in `SPEC.md` still points at
  the old number.
- **Implementation proceeds in the table's top-to-bottom order, full stop, unless the user
  explicitly says otherwise for that phase.** The row order is the execution order — not a
  suggestion to weigh against convenience, in-flight subagent scope, or judgment about what seems
  more urgent. Don't reorder execution to skip ahead or double back without the user asking.
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
- **Lean on the frontend libraries P98 wired in — shadcn-vue, Tailwind CSS, VueUse, Pinia, TanStack
  Query — rather than hand-rolling an equivalent.** Every phase's planning pass adapts its design to
  them, whether or not the spec row asking for the work says so: a new UI surface styles with
  Tailwind utility classes, not a scoped `<style>` block; a component primitive (button, dialog,
  dropdown, menu, popover) comes from shadcn-vue; a browser/DOM composable (debounce, resize and
  intersection observers, event-listener wiring, local-storage sync, clipboard) comes from VueUse;
  shared client state lives in a Pinia store; server state — anything fetched over the bridge with
  loading, error and cache handling around it — goes through TanStack Query. Decline one only
  against a real requirement it cannot meet, and name that requirement, same standard as the
  library rule above.
- **Every Vue component is `<script setup lang="ts">`.** Composition API only — no Options API, no
  `defineComponent`, no second plain `<script>` block.
- **One Pinia store, one concern.** A store owns a single subsystem's state; never a grab-bag
  app-wide store. Split one that grows a second concern rather than widening it.
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

## CodeGraph

Code navigation in this repo goes through [CodeGraph](https://github.com/colbymchenry/codegraph),
not repo-map: symbol index, call graphs, blast radius, registered as an MCP server via the
committed `.mcp.json` — use the MCP tools, not the `codegraph` CLI.

**Mandatory for discovery, not for applying a known fix — and verified, not assumed.** Real usage
splits cleanly along that line: an audit agent (P107 iter2's own Fable audit) called
`codegraph_explore` 37 times, all before it ever called `Read` — finding duplication candidates and
tracing call graphs needs it. An implementer given an exact file:line and a named fix from a
findings doc called it zero times — `Edit` requires its own prior `Read` on that exact file
regardless of what CodeGraph already showed, so a resolved fix has no discovery left to do.

So: **mandatory** whenever a subagent is finding or understanding something it doesn't already know
— an Opus plan being written, a duplication/bug audit, tracing what calls what or a change's blast
radius before a structural decision. Read the injected context before opening whole files; call
`codegraph_explore` before Read/Grep for any symbol/call-graph/blast-radius question in that work.
**Not required** for a subagent executing an already-named fix (an exact file:line and a concrete
change from a committed plan or findings doc) — there's nothing left to discover, and forcing a call
there is busywork, not signal.

CLAUDE.md being on disk in a subagent's worktree doesn't make it follow this — every subagent
prompt doing discovery work (Opus planner, audit agent) must restate the requirement explicitly.
Before accepting a plan or an audit's findings (this file's own verification rule), the
orchestrating session confirms real `codegraph_explore`/`codegraph_node` tool calls happened in
that subagent's own run — grep its tool-call log, don't take "I used CodeGraph" on prose alone.
Loading the tool via `ToolSearch` without ever calling it doesn't count. A discovery subagent that
skipped it despite loading it goes back to redo the lookup, same as any other short-of-the-ask
result.

**The tools aren't in the default tool list.** Call `ToolSearch` for `"codegraph"` first — it
loads `codegraph_explore`, `codegraph_node` and the rest by name, then they're callable like any
other tool. Don't fall back to the CLI just because they're not visible yet; search for them.

- **Automatic** — a `UserPromptSubmit` hook (`codegraph prompt-hook`) fires on every message and
  injects matching symbols as `<codegraph_context>`, no tool call needed. Read it before
  searching files.
- **Explicit** — `codegraph_explore` answers most code questions in one call: the relevant
  symbols' source plus the call paths between them, including dynamic-dispatch hops grep can't
  follow. `codegraph_node` reads one symbol's source plus its caller/callee trail.

`.claude/hooks/session-start.sh` installs the `codegraph` binary and builds/syncs the index every
session — that's build tooling, not how code gets navigated; navigation is the MCP tools above.

The shipped repo-map feature (Settings dialog's Code intelligence tab, `internal/repomap`) was
removed in v1.9 P97 — CodeGraph above is now the only code-index in this repo, no name collision
to keep straight.
