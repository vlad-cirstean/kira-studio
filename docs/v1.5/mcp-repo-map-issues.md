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
