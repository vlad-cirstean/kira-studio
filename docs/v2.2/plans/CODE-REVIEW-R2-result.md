# Code review round 2 result

Base `bb2f5852c`, findings commit `2580815ec`. 6 findings, all fixed. None declined.

## Commits

- Group A (#1, #2): `c5e714ce5` fix(space): rebase agent runs git through a validated tool; `9d7e2f623` docs.
- Group B (#3): `0c1d2f13a`.
- Group C (#4): `43c8f760d`.
- Group D (#5): `42c73a0bb`.
- Group E (#6): `2990c9d9c`.

## Design notes

- A: rebase run has no Bash, `Isolated` (no settings files, `--strict-mcp-config`), `--tools`
  limited to Read/Edit/Write/Grep/Glob. Git runs through the `git` tool on the `kira-ade` MCP server.
  `claudeheadless.CheckGitArgs` allows exact shapes only; abbreviations fail because unlisted options
  are refused, not denied by prefix. `worktree` must be a stack worktree (`GitGrant`); stack
  worktrees are `--add-dir`s, so child branches restack. Test: `gittool_test.go` (allow and
  refuse tables). Flow: stacked rebase drives the tool for both worktrees and asserts the launch args.
- B: `useVirtualRows` gets `pinned`; the review list pins `focusedRow` via `rangeExtractor`. UI spec
  scrolls the focused row out, checks it stays focused, ArrowDown works, aria set size and position.
- C: `handleChunkLayout` no longer invalidates or renders; the `plan` watcher owns repaint. A relayout
  always publishes a new plan object, so the watcher always fires. The claimed order (watcher first)
  was also wrong: the listener runs first, the watcher after.
- D: `ApplyFolderHidden` reads the stored flag inside one UPDATE over the imported ids; scan never
  writes `ade_folders`. No test: the race is not deterministic from the bridge.
- E: `WorkflowYaml.hash`, `SaveWorkflowYamlArgs.baseHash`, `SaveYaml` checks under `wmu`. The hash
  comes from the YAML read itself, not `entry.hash`, so text and hash cannot drift apart. UI: Reload and
  Overwrite as in the graph editor. Flow: `TestBranching` YAML conflict; UI: `ade-v2-workflows.spec.ts`.
  No contract fixture changed (`workflow-yaml.json` is hand-written; gained `hash`).

## Verification

- `go test` pass: `internal/claudeheadless`, `apps/kira-space/internal/{ade,adeflow,bridge,storage/...}`,
  `flows/adeflow` (full), `internal/scriptruns`.
- `bun run test:unit`: 1793 pass.
- Playwright `ui` (Space): `repo-review-interaction`, `repo-graph*` (40), `ade-v2-workflows` (26) pass.
- Every commit passed hooks (biome, typecheck) without `--no-verify`.

## Open

- Not run: real `claude` suite (`bun run test:claude:space`) for the new tool grant, and the
  `e2e-real` tier. The git tool is covered by the fake agent only.
- D: unhiding one imported repo mid-scan, right after the folder flips, can still be re-hidden. The
  window is the scan; no timestamp exists to tell it from the scan's own import. Left as is.
