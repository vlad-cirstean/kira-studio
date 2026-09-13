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

_No entries yet — starts at C5._

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
