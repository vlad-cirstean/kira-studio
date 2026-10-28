# v0.2.21

Branch `chapter/v0.2.21`. First `P` is 388 (highest in `docs/HISTORY.md` is P387).

Source: user request. Phases run top to bottom.

| Phase | Title | Status |
|---|---|---|
| P388 | ADE task list: calmer look, clear active-task marker, visible separators | Todo |
| P389 | ADE tightening: drop plan top bar, drop task toolbar, drop session bar | Todo |
| P390 | ADE git module last in order | Todo |
| P391 | Both apps: scrollbars hidden until pointer is in the panel | Todo |
| P392 | Bug: three-finger swipe up (Mission Control) moves focus to another space | Todo |
| P393 | Review others' PRs: approve and comment; agent panel button to far right | Todo |
| P394 | Terminals: Cmd+click opens link | Todo |
| P395 | Task repos and branches: add, edit and delete independently | Todo |
| P396 | One project picker and one branch picker across the app | Todo |
| P397 | Code review, 1 round (Opus review, Sonnet fix) | Todo |
| P398 | Close chapter, open PR | Todo |

## Rows

### P388 ADE task list: calmer look, clear active-task marker, visible separators

ADE tasks view is busy and colorful; hard to focus on what is essential. Fix:

- Reduce color and visual noise; keep only what is essential.
- Add a clear visual indicator for the task open in the right panel.
- Make the separation between tasks more visible.

### P389 ADE tightening: drop plan top bar, drop task toolbar, drop session bar

- Remove the plan top bar. Move its refresh-all button next to the project refresh controls.
- Task view: remove the top task toolbar. Move its buttons to the right end of the tab row (task, notes, …).
- Remove the session bar; the tab already shows its info. Keep the two missing items:
  - "x time ago" shown in a tooltip on the tab.
  - Tab right-click menu: copy session id.
- Tab right-click menu also gets restart: closes the session, then reopens it.

### P390 ADE git module last in order

Move the git module to the last position in the ADE module order.

### P391 Both apps: scrollbars hidden until pointer is in the panel

Studio and Space. Scrollbars hidden by default; shown only while the pointer is inside that panel. Like a modern app.

### P392 Bug: three-finger swipe up moves focus to another space

Three-finger swipe up (macOS Mission Control, to see the apps on the space) moves focus to another space. Find the cause (likely window focus/activation handling) and fix.

### P393 Review others' PRs: approve and comment; agent panel button to far right

- Reviewing another person's work must allow approving the PR and leaving comments, same as for own PRs.
- Move the agent panel button to the far right.

### P394 Terminals: Cmd+click opens link

In every terminal, Cmd+click on a link opens it.

### P395 Task repos and branches: add, edit and delete independently

A task can add repos and branches. Add edit and delete for both. Today, a repo added without a branch cannot get a branch added later; fix that.

### P396 One project picker and one branch picker across the app

Several project and branch picker implementations exist, each flawed. Replace them with one shared project picker and one shared branch picker used everywhere. Remove the old implementations.

### P397 Code review, 1 round (Opus review, Sonnet fix)

One round per `CLAUDE.md` "Code review". Base: last commit of v0.2.20 close (`6bd97b9a2`'s chapter content) to chapter HEAD; planner states exact base in the findings file.

### P398 Close chapter, open PR

Per `CLAUDE.md` "Closing a chapter". Tag `v0.2.21`.
