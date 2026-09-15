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

(none yet — this chapter has not started implementation)

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
