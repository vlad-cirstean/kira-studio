# P205-P207 notes (workstream F part 2)

## Landed
- P205: all repo config in git-module ReposDialog (Repositories tab: import, list, per-repo form, remove; Scan folders tab). ADE Repos tab and page removed. Repo-row menu entry "Configure repository…". New field `worktreeBasePath` (Go wire, `UpdateRepo`, TS wire, form with Choose…). Commits 1a68dd995, 84ed465d6.
- P206: `MODE_ORDER` git, ade, terminal, memory. Commit 1414261e1.
- P207: one frame per pane (`WorkbenchShell` prop `mainFramed`, ADE nav bar framed, pages unframed inside panes), `PanelHeader` on Plan, Task, Archived task, Branch, Backlog, Backlog item, Needs you, Workflows, editor. Raw buttons to shadcn `Button`/`TooltipIconButton`. Pixel classes to tokens. `font-data` kept only on SHAs, branches, paths, commands, YAML, code. Backlog and Needs rows are divider rows. Fixed grids became flex rows with token-width cells. Workflow editor drops `max-w-[900px]` for `max-w-4xl`; All sessions drops `max-w-[1080px]`. Commits 964452fb1, 99b2889f0, 2cdee38ca.

## Deviations
- No Go test for the base path: the plan's "existing UpdateRepo validation test" does not exist; one-condition validation, no new test per CLAUDE.md.
- ADE button size is control-scale `kira-lg` (26px) plus `kira-icon` (22px square) and `kira` (22px) for dense rows, not default/sm/icon-sm: matches Git module and Studio.
- Dialog repo list rows come from the codeRepos records.
- Frameless main panel prop added to `packages/workbench` `WorkbenchShell` (default keeps the old frame).
- Raw `<button>` kept in 3 places, none a plain control look: `AdeTaskCard` clamped title (whole-card select target), `AdeAttention` glyph badge, `AdeSessionStrip` tab chips (shared `tabChipVariants` recipe).

## Counts
- Arbitrary pixel-size classes under `ade/`: 2, both `border-[1.5px]` in `AdeActivityIcon` (glyph ring weight, no token between 1 and 2px). Also allowlisted: review-row stripe `repeating-linear-gradient` in `AdeBranchRow`, `[scrollbar-width:none]` in `AdeSessionStrip`, `em` spacing and `[tab-size:2]` in `AdeNotesEditor`/YAML (prose and code, font-relative).
- Raw `<button` under `ade/`: 3 (above).
- Framed boxes per page: Plan 1 pane plus task panel 1; Backlog 2 panes; Needs 1; Workflows 2; each pane has one `PanelHeader`.

## Proposed ARCHITECTURE.md edits
- Repository configuration lives only in the git-module Repositories dialog; Agents has no Repos tab.
- Module order Git, Agents, Terminal, Memory.
- ADE pane convention: one frame, `PanelHeader`, tokens only, control sizes `kira`/`kira-lg`, `font-data` only for code-like text.

## Failing baselines
None reported by the space UI suite (215 passed). See final run output for Studio and Go results below.

## Screenshots
- Before: /tmp/claude-0/shots/before/
- P205: /tmp/claude-0/shots/p205/ (repos dialog 1440/1100, folders tab, repo-row menu, ADE shell, empty dialog)
- P206: /tmp/claude-0/shots/p206-titlebar.png
- P207 iteration 1: /tmp/claude-0/shots/a1/; final set: /tmp/claude-0/shots/a2/ (plan, task, branch, sessions, backlog, needs, all sessions, workflows form and YAML, add popover, run dialog, empty, git, terminal at 1440 and 1100)
