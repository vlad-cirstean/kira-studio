# C4 — CLAUDE.md: document the repo-map MCP server

> **What this phase is.** `docs/v1.5/SPEC.md`'s C4 row: one new section in `CLAUDE.md` naming C3's
> repo-map MCP server, stating that using it is expected practice for work inside this repository,
> and giving the headless setup a session actually runs. Doc-only — no Go, no Vue, no schema. Every
> command, flag, port and file name below was read off the C3 tree on disk (commit 2c470e15), not
> off C3's plan prose.

## 1. Ground truth, verified against the tree

| Claim | Source on disk |
|---|---|
| `bun run mcp:repo-map` / `bun run mcp:repo-map:build` | root `package.json` `scripts` |
| Wrapper builds, then execs, forwarding argv and signals | `scripts/mcp-repo-map.ts` |
| Binary cwd is repo root under `bun run` | `scripts/mcp-repo-map.ts` (`cwd: ROOT`) |
| `--repo <path>` and `--version` are the only flags; no `--port` | `apps/kira-studio/cmd/kira-repo-map/main.go` |
| Default port 8765, ephemeral fallback, loopback only, path `/mcp` | `internal/repomap/server.go` (`DefaultPort`), `internal/repomap/http.go` |
| Headless startup prints `claude mcp add --transport http kira-repo-map <url> --header "Authorization: Bearer <token>"` — **no `--scope user`** | `cmd/kira-repo-map/main.go` |
| Embedded instance's command **does** carry `--scope user` | `internal/mcpinstall/install.go` `Command`/`Install` |
| Token minted once per repository, hash+salt at rest, `mcp-repo-map-<slug>-token.json` under `KIRA_HOME`; a later run loads it and prints a note instead of a command | `internal/mcpauth/token.go` (`Path`), `cmd/kira-repo-map/main.go` |
| Six tools: `find_definition`, `find_references`, `find_implementations`, `search_symbols`, `search_files`, `outline_file` | `internal/repomap/server.go` |
| `KIRA_REPO_MAP_LOG`, cold-build cost, `claude mcp remove` cleanup already documented | `docs/DEV_ENVIRONMENT.md` §"repo-map MCP server" |
| Two-instance model, end-user Settings tab | `docs/ARCHITECTURE.md` (`internal/repomap` (C3) block) |

Two consequences for the wording:

- **The section shows the headless command only.** It has no `--scope user`, because that is what the
  headless binary prints. Do not copy the embedded instance's form into it.
- **The section does not repeat `claude mcp remove …`, `KIRA_REPO_MAP_LOG`, or the ~34 MB cgo
  figure.** `CLAUDE.md`'s own intro says environment/tooling facts live in `docs/DEV_ENVIRONMENT.md`
  and are not duplicated. Three commands are the minimum needed to act on the instruction; everything
  past that is a pointer.

**Real bug found while planning, fixed as part of this phase (S1a below):** the headless command
above omits `--scope user` while the embedded/Settings-tab command includes it
(`internal/mcpinstall/install.go`), and `docs/DEV_ENVIRONMENT.md`'s own cleanup line
(`claude mcp remove kira-repo-map -s user`) assumes user scope regardless of which instance
registered it. Pick one scope for the headless command too (`user` — a repo-map registration is a
per-machine developer convenience, not project-specific, matching the embedded instance's own
choice) and make `cmd/kira-repo-map/main.go` print it with `--scope user`, so both instances register
the same way and `DEV_ENVIRONMENT.md`'s cleanup command is accurate for either. This is a one-line,
config-shaped fix — trivial per `docs/v1.5/mcp-repo-map-issues.md`'s own bar — not a design change.

## 2. Placement

Append as a new `## Repo-map MCP server` section at the **end** of `CLAUDE.md`, after the final
bullet (`.github/workflows/` can't be pushed from this session), separated by one blank line.

Why there, not elsewhere:

- The file's body is one bullet list under `**Opus plans, a Sonnet subagent implements…**`. Every
  bullet is one standing rule in one or two sentences. This content needs three commands and a
  numbered sequence — too big for that list, and inserting it would split a list whose last three
  bullets are deliberately meta (keep-lean, Known open items, workflow constraint).
- The file already carries exactly one `##` heading (`Communication style`). A second one at the end
  adds navigability without restructuring anything above it.
- It reads after the phase loop, which is the order a session needs: how this team works, then the
  tool it works with.

Nothing above it moves. No heading is added over the existing bullet list.

## 3. Exact section text

Paste verbatim, including the blank line before it. Wrapped at 98 columns, matching the file.

```markdown

## Repo-map MCP server

Code navigation over this repository's own tree-sitter graph (C3, `internal/repomap`), served as MCP
tools: `find_definition`, `find_references`, `find_implementations`, `search_symbols`,
`search_files`, `outline_file`. Ask it instead of opening whole files to find a symbol — the tokens
that saves are the point.

**Use it when working in this repository.** Standing expectation, not a demo: register it at session
start and navigate with it.

Headless setup, for a session with no GUI:

1. `bun run mcp:repo-map:build` — once per clone, since the first build is slow (cgo).
2. `bun run mcp:repo-map` — rebuilds (cached, sub-second), then serves in the foreground; background
   it if a later command in the same invocation must reach it. It serves this worktree's root.
   `bun run mcp:repo-map --repo <path>` serves another checkout instead.
3. Run the registration command it prints on startup:
   `claude mcp add --transport http --scope user kira-repo-map http://127.0.0.1:8765/mcp --header
   "Authorization: Bearer <token>"`. Copy it, never retype it — the token is per repository, and the
   port falls back off 8765 when something else holds it.

Each repository's token is stored hashed under `KIRA_HOME`, so a later run reuses it and prints a
note instead of a command; an already-registered client keeps working. To mint a fresh one, delete
that repository's `mcp-repo-map-*-token.json` and restart the server.

**Log what dogfooding finds** in `docs/v1.5/mcp-repo-map-issues.md`. Trivial (config, registration,
wiring): fix inline, log one line. Non-trivial (wrong result, missing tool, crash): log a full entry
and fix nothing in that phase — the next phase waits for a dedicated fix pass to close it.

Development use only. The shipped end-user surface — the Settings dialog's Code intelligence tab —
is product, not process; `docs/ARCHITECTURE.md` describes it and how the server works,
`docs/DEV_ENVIRONMENT.md` covers log level, cleanup and this container's own quirks.
```

Each SPEC requirement, and the sentence carrying it:

1. Names the server and its purpose — paragraph 1, with the six real tool names.
2. Expected practice — the bolded second paragraph. C5 onward depends on this sentence.
3. Enable/configure headless — the three numbered steps plus the token paragraph.
4. Dogfooding log — the bolded paragraph, rule only, not the log file's own process prose.
5. This-repo's-development-use-only — the closing paragraph, which also names where product behaviour
   is documented instead.

Note the registration command above already carries `--scope user`, per §1's fix — it differs from
what `cmd/kira-repo-map/main.go` prints *before* S1a lands, and matches it after.

## 4. Prune

**Nothing to prune. No stale line found.** Checked, rather than asserted:

- `docs/pending-changes/`/`docs/pending-workflows/` do not exist in the tree, but
  `docs/DEV_ENVIRONMENT.md` still documents both as create-on-demand — the pointer is live, not stale.
- `packages/db-fixtures/*.spec.ts` really are gone (only `fixtures/` and `support/` remain), so the
  adapter-conformance bullet's "sole successor to the deleted…" wording is still accurate.
- `apps/kira-studio/internal/adapters/*/*_test.go` exist; the P25/P26 two-suite bullet still
  describes the current shape.
- The phasing pointer already reads `docs/v1.5/`, current for this chapter.
- Nothing in `CLAUDE.md` mentions MCP, code intelligence or C3 today, so the new section supersedes
  no existing text.

Do not invent a prune to satisfy the keep-lean rule. The rule's own point — don't just append — is
met by the section deferring log level, cleanup and product behaviour to the two files that already
own them.

## 5. Steps

**S1a — Fix the `--scope user` asymmetry.** In `apps/kira-studio/cmd/kira-repo-map/main.go`, change
the printed registration command to include `--scope user` (matching `internal/mcpinstall/install.go`
`Command`'s own flag order/shape). Verify `docs/DEV_ENVIRONMENT.md`'s existing
`claude mcp remove kira-repo-map -s user` cleanup line is now accurate for both instances (it already
assumed user scope — this fix makes that assumption correct instead of accidentally right for one
instance and wrong for the other). One commit:
`fix(repomap): headless registration command matches embedded instance's --scope user`.

**S1b — Edit CLAUDE.md.** Append §3's text (already carrying the corrected command from S1a). One
commit: `docs: document the repo-map MCP server as expected practice in CLAUDE.md`.

No other file changes: `docs/ARCHITECTURE.md`, `docs/v1.5/mcp-repo-map-issues.md` and
`docs/v1.5/SPEC.md` all already say what they need to and are not retro-edited.

## 6. Verification

- Re-run the headless server (`bun run mcp:repo-map`) after S1a and confirm the printed command now
  reads `--scope user` — don't just trust the diff.
- Re-read the appended CLAUDE.md section against §1's table — every command, flag, port and file name
  matches the tree, not this plan's prose.
- Line width ≤ 98 columns; no emoji, no arrows beyond the em-dashes the file already uses, no
  invented abbreviation.
- `go build ./...`, `go vet ./...` for S1a's one-line change.
- `bun run lint` for the repo's own guard (it checks CSS tokens, not markdown — expected to pass
  untouched).

No test earns its keep here: S1a is a one-line printed-string change with no branching logic, and S1b
adds no code.

## 7. Out of scope

- Any other change to the server, the Settings tab, or `internal/mcpinstall` beyond S1a's one line.
- Documenting the embedded instance's own registration command in `CLAUDE.md` (product surface —
  `docs/ARCHITECTURE.md` covers it).
- Logging a first dogfooding entry — that starts at C5, per the log's own process section.
- Restructuring `CLAUDE.md`'s existing bullet list.
