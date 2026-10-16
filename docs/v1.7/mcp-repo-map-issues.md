# Repo-map MCP: dogfooding log (v1.7)

## Process

Continuing v1.5/v1.6's own practice (`docs/v1.6/mcp-repo-map-issues.md`): every implementation
subagent for this chapter uses the repo-map MCP server for real navigation work, and reports what
happened.

Two outcomes, handled differently:

- **Trivial** (a config/registration/wiring problem, fixed in the same session it was found): fix
  it inline, log one line here (what broke, one-line fix) for the record, keep going. No process
  gate.
- **Non-trivial** (a wrong or incomplete result, a missing tool, a crash, anything where the fix is
  itself real work): log a full entry below, and **do not fix it inside that phase**. The next
  phase does not start until every open non-trivial entry from the phase before it is fixed and
  closed — a dedicated fix pass runs between the two, same shape as a bugfix.

Entries are closed in place (status flips to Fixed, commit noted) rather than deleted.

## Log

- **M1 (planning)**: used throughout for navigation — `search_symbols` for `Execute` found all 25
  call sites across adapters/adapterhost/frontend in one call (established the query-path routing
  section of the plan); `outline_file` covered `internal/connections/service.go`'s 42 declarations
  without reading its 692 lines; `read_symbol` read `mcpauth.LoadOrMint`'s declaration exactly;
  `find_references` found all three `mcpauth.Path` call sites; `search_files` located
  `state/connections.ts` by path fragment. Real work throughout, replacing several whole-file reads.

- **M1 (planning)**: `find_references` with both `file` and `symbol` set (`mcpauth/token.go`,
  `Path`) returned 10 hits, 6 of them unrelated `fd.Path()` calls in `internal/grpcclient` — the
  `file` hint narrows which symbol is *resolved*, not which results come back. Trivial and by
  design: the server's own tool description already says results are name-resolved, not
  type-resolved. No fix needed; noted so a future session doesn't trust a reference count filtered
  by `file` to be type-scoped.

### Non-trivial

- **M1 (planning) — the repo-map server refuses to start when `$KIRA_HOME` does not yet exist.**

  - **Found in**: M1 (planning)
  - **Status**: Fixes inside M1ab (M1's own implementation), not a dedicated pass — see below
  - **Query/tool call**: `bun run mcp:repo-map` (first run in this container, `$KIRA_HOME` absent)
  - **Expected**: server creates its storage directory and starts
  - **Actual**: exits 1: `kira-repo-map: repomap: resolve token: mcpauth: write
    /root/.kira-studio/mcp-repo-map-fc694cca06c3-token.json: … no such file or directory`. Cause:
    `mcpauth.Save` (`token.go:94`) calls `os.WriteFile` with no `os.MkdirAll` first. Worked around
    with `mkdir -p` for the rest of the planning session; not fixed there, per this log's own rule.
  - **Fix**: folded into M1's plan (`docs/v1.7/plans/M1-db-mcp-server-core.md` §2.6) rather than
    scheduled as a separate dedicated pass — M1 already owns `internal/mcpauth` for the 7-day
    rotation work and touches `Save` directly, so a standalone fix phase for a one-line
    `MkdirAll` would edit the same function a second time for no reason. Closed once M1ab lands the
    plan; if M1ab's committed diff does not include the `MkdirAll`, reopen this entry.

  Confirmed present in the landed diff (both A/B arms, verified independently) — `Save` calls
  `os.MkdirAll(filepath.Dir(path), 0o700)` before `os.WriteFile` in both. **Closed.**

- **M1ab (arm A, MCP-assisted implementation) — `find_references`/`search_symbols` miss a Go
  struct field reached only via selector expression.**

  - **Found in**: M1ab, arm A (repo-map-assisted implementation pass)
  - **Status**: Fixed (`f453ee37`, M1c). Independently re-verified live: `search_symbols
    {"query":"AutoExplain"}` → `ConnectionFields.AutoExplain` at `connection.go:24:2`;
    `find_references` on it → exactly 7 sites, exact lines, matching the plan's required-results
    table. **Closed.**
  - **Query/tool call**: `find_references` on `model.ConnectionFields.AutoExplain` and
    `.ThrottlePerSec`; `search_symbols` for the same field names.
  - **Expected**: real call sites via `f.AutoExplain`/`c.ThrottlePerSec` selector expressions in
    `repos/connections.go` and `connections/service.go` (both fields have numerous live call
    sites).
  - **Actual**: `find_references` reports no references found; `search_symbols` returns nothing
    for the field itself (only unrelated same-named local variables elsewhere). A plain `x.Field`
    selector read isn't captured by either the definition or reference query for struct fields at
    all — distinct from the already-logged P67f range/index-expression gap (v1.6 log).
  - **Fix**: none attempted (per this log's own rule — non-trivial, not fixed in the phase that
    found it). Workaround used: `Grep` for all "does anything else reference this field"
    checks. Needs its own pass in `internal/repomap`'s Go declaration/reference resolution before
    a future phase can rely on `find_references` for struct-field navigation.

  Reproduced during M2 planning on a second field (`ConnectionFields.McpEnabled`, eight live uses,
  `find_references`/`search_symbols` both return nothing) — same defect class, not a new entry.
  Gates M2's implementation per this log's own rule; scheduled as **M1c**, a dedicated fix pass
  between M1ab and M2 (`docs/v1.7/SPEC.md`).

- **M2 (planning)**: `find_implementations` rejects a `limit` argument outright while
  `search_symbols`/`find_references`/`search_files` all accept one — trivial, an inconsistent
  argument surface across the eight tools, not fixed here. No workaround needed (result sets were
  small enough not to need limiting).

- **M2 (planning)**: initial sync on this repository ran past 60s in this session; every call
  issued in that window returned an `isError` "still building" result. Trivial — retried after sync
  finished, no fix needed (index-build time is P64c's own concern, not a new defect).

- **M3 (planning) — M1c closure confirmed on a field it wasn't fixed against**: `find_references`
  on `McpDdlMode` (an M2-introduced field, didn't exist when M1c landed) returns 13 exact
  references — the same query shape that returned nothing pre-M1c. Not a new finding, additional
  closure evidence for the M1c entry above.

- **M3 (planning)**: `outline_file` takes `file`, not `path` (`path` fails with "unexpected
  additional properties"); `find_implementations` still rejects a `limit` argument three sibling
  tools accept (first logged during M2's planning, unchanged). Both trivial, both recurring —
  the eight tools' argument names/support aren't consistent with each other. No fix attempted; worth
  its own small pass eventually (naming/arg-surface consistency, not a correctness bug), not urgent
  enough to gate a phase.

- **M3 (planning) — not a repo-map defect, a real per-session cost**: restarting the server inside
  the 7-day token window prints "Using this repository's existing token" with no registration
  command — a fresh session holds no plaintext and cannot call the server at all without deleting
  and re-minting (which invalidates the previously registered client). Happened again this pass.
  Noted so a future session budgets for this rather than debugging what looks like a 401.

- **M3 (planning) — extends the existing `pkill` note**: killing by PID from `pgrep -af` output is
  correct, but that output includes the invoking shell's own command line (the search pattern
  matches it) — read the output and extract the right PID, never pipe `pgrep -af`'s output straight
  into `kill`.

- **M4 (planning)**: `find_references{"symbol":"GeneratorId"}` returns 5 hits, all `.ts` — the type
  is also consumed from three `.vue` script-block sites (`GenerateDataDialog.vue`, the dialog that
  owns the generator picker, the most relevant consumer for a phase about the generator catalogue).
  Same class as v1.6's P60a/P63/P67e Vue blind-spot entries, but the first instance of it biting on
  a *type consumed from* a `.vue` file rather than a definition/reference inside one. No fix
  attempted (Vue is out of repo-map's confirmed scope); noted since it's a slightly different shape
  of the known gap.

- **M4 (planning) — M1c reconfirmed on more unrelated material**: `search_symbols` correctly returns
  `field NameHeuristic.generatorId` and `field Recipe.generatorId` with exact lines, in TypeScript.
  Third confirmation of the M1c fix holding, not a new finding.

- **M4 (planning) — token-restart friction (M3's #4) recurred a third consecutive pass.** Fixed
  inline this time: `CLAUDE.md`'s headless-setup step 2 now names this explicitly as "the common
  case in a multi-session container" and tells a session to delete-and-restart immediately rather
  than debug a 401. Trivial, closed.

- **M4 (planning)**: `pgrep -af` self-match reconfirmed exactly as this log's existing entry
  describes — two rows, the real server process and the invoking shell. No new information; killed
  correctly by PID.

- **M5 (planning) — M1c reconfirmed on live, real usage, not just a synthetic query**: `find_references`
  on `McpAutoExplain` correctly found its one real read site (`dbmcp/tools.go:195`), cross-checked
  against `Grep` to confirm no other occurrence was missed. Fourth confirmation the fix holds.

- **M5 (planning) — `find_implementations` still rejects a `limit` argument**, third consecutive
  phase to hit this (first logged M2, reconfirmed M3/M4/M5). Trivial, one wasted round trip each
  time. Worth its own small consistency pass across the eight tools' argument surfaces at some
  point — not urgent enough to gate a phase, but recurring often enough to flag plainly here.

- **M5 (planning) — `.vue` may no longer be a dead zone for repo-map, contradicting a claim
  M1ab's own phase selection relied on.**

  - **Found in**: M5 (planning)
  - **Status**: Open, but **does not gate M5's implementation** — this log's own gating rule exists
    for a wrong result, a missing tool, or a crash; this is the opposite (a capability working
    better than documented), so there is nothing broken to fix before building on top of it. Needs
    direct confirmation at a convenient point (M6/M7's review scope is a natural fit), not a
    dedicated pass first.
  - **Query/tool call**: `search_symbols`, `read_symbol`, `outline_file` against `.vue` SFCs
    (`cellFormatter` and its surrounding grid display code) during M5's own navigation.
  - **Expected, per the standing assumption**: zero results against a `.vue` file, per v1.6's
    P60a/P63/P67e entries and per `docs/v1.7/SPEC.md`'s own Sequencing paragraph, which names this
    exact "confirmed dead zone" as the reason M1 (not any other phase) was chosen as the M1ab A/B
    candidate — a real result would have undercut that choice's isolation logic.
  - **Actual**: all three tools returned real, useful results against `.vue` SFCs — `read_symbol`
    returned `cellFormatter`'s full body with its comment block; the whole grid-display seam for
    M5's own planning was traced through repo-map instead of reading ~3,300 lines by hand.
  - **Fix**: none attempted — this may not be a defect to fix at all, but a capability that
    genuinely improved (candidate causes named, not confirmed: P67f's read-reference work, or
    M1c's `extractionVersion` 3→4 full reindex). Needs a direct, deliberate re-test against the
    same P60a/P63/P67e cases that established the original "dead zone" finding, to confirm whether
    it's now closed chapter-wide or was specific to this one file/query shape. Until then, treat
    `.vue` support as "worth trying," not "known to fail" — but don't retroactively treat M1ab's own
    candidate-selection reasoning as wrong; it was accurate against the evidence available at the
    time.

<!--
Entry template:

### N. <short title>

- **Found in**: M<phase>
- **Status**: Open | Fixed (`<commit sha>`)
- **Query/tool call**: what was asked of the MCP server
- **Expected**: what a correct answer looks like
- **Actual**: what came back
- **Fix**: (once fixed) what changed and why
-->
