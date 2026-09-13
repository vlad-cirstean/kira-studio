# Repo-map MCP: dogfooding log

## Process

C4 documents the repo-map MCP server (C3) as expected practice for development in this repository.
Starting with **C5**, every implementation subagent for this chapter uses it for real — not as a
demo, as its actual navigation tool for that phase's own work — and reports what happened.

Two outcomes, handled differently:

- **Trivial** (a config/registration/wiring problem, fixed in the same session it was found): fix
  it inline, log one line here (what broke, one-line fix) for the record, keep going. No process
  gate.
- **Non-trivial** (a wrong or incomplete result, a missing tool, a crash, anything where the fix is
  itself real work): log a full entry below, and **do not fix it inside that phase**. The next
  phase does not start until every open non-trivial entry from the phase before it is fixed and
  closed — a dedicated fix pass runs between the two, same shape as a bugfix (no fresh Opus plan
  needed unless a fix turns out to be genuinely architectural, in which case it gets one).

Entries are closed in place (status flips to Fixed, commit noted) rather than deleted — this file is
the chapter's own record of what dogfooding actually found, not a scratch TODO list.

## Log

- **Trivial (C5)**: registering `kira-repo-map` mid-session (`claude mcp add`) never surfaces its six
  tools as native tool calls in this harness — a subagent's tool registry is fixed at spawn, so a
  server added after spawn needs a session restart to appear via `ToolSearch`. Not a server bug: the
  server itself answers correctly (verified via direct `POST /mcp` JSON-RPC). Worked around by calling
  it over HTTP directly (`tools/call` JSON-RPC) for this phase's navigation instead of native tool
  wrappers — same server, same answers, just invoked through `curl` instead of a `mcp__kira-repo-map__*`
  tool. No fix needed in the server/registration itself.
- **Trivial (C6)**: `find_definition`/`find_implementations` take a `file` argument, not `path` —
  the schema is discoverable via `tools/list`'s own `inputSchema`, so this is a one-line usage
  mistake (guessed `path` first, matching `outline_file`'s field name, without reading the schema),
  not a server defect. Fixed by reading `tools/list` before the first real call.
- **Non-trivial (C6), used for dogfooding but not a repo-map defect — logged for the record**: a
  position inside a `.vue` file's `<template>` block (a directive expression like
  `v-if="state === 'loading'"`, or an attribute binding like `:label="errorMessage || '...'"`)
  resolves to zero targets via both `find_definition` (over HTTP) and this phase's own
  `codeworkspace.Definitions` — confirmed by a direct in-process call against this repository's own
  real index (not just the MCP server), at several hand-verified byte columns landing squarely
  inside the identifier. This matches `docs/ARCHITECTURE.md`'s own documented C1/C2 limitation
  verbatim ("a position inside a `template` block has no reference row to hit at all... `DefinitionOf`
  falls back to **the caller's own** word-under-cursor name") — the fallback is caller-side by
  design, and neither `internal/repomap`'s tools nor this phase's `nav.go` implement it (the
  approved C6 plan's own §6 never asked for it). Not a repo-map bug and not fixed here: filed as a
  known scope gap in this phase's own final report rather than as a repo-map issue, since the
  server's answer (a real "no hit", not a wrong one) is honest given what `codeindex` stores for a
  `.vue` template today. A `.vue` file's `<script setup>` block resolves correctly either way
  (verified: same-file/`sameDirectory` calls resolve `exact`, a name matched only by search resolves
  `repoWide` — identical behaviour to a `.ts` file, since both go through the same `codegraph`
  engine once past the template/script boundary).

<!--
Entry template:

### N. <short title>

- **Found in**: C<phase>
- **Status**: Open | Fixed (`<commit sha>`)
- **Query/tool call**: what was asked of the MCP server
- **Expected**: what a correct answer looks like
- **Actual**: what came back
- **Fix**: (once fixed) what changed and why
-->
