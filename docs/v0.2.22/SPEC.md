# v0.2.22

Branch `chapter/v0.2.22`. First `P` is 396 (highest in v0.2.21 is P395). Rows carried over from v0.2.21 by user request.

Source: user request. Phases run top to bottom.

| Phase | Title | Status |
|---|---|---|
| P396 | Bug: three-finger swipe up moves focus to another space | Todo |
| P397 | Task repos and branches: add, edit and delete independently | Todo |
| P398 | One project picker and one branch picker across the app | Todo |

## Rows

### P396 Bug: three-finger swipe up moves focus to another space

Three-finger swipe up (macOS Mission Control, to see the apps on the space) moves focus to another space. Find the cause (likely window focus/activation handling) and fix.

### P397 Task repos and branches: add, edit and delete independently

A task can add repos and branches. Add edit and delete for both. Today, a repo added without a branch cannot get a branch added later; fix that.

### P398 One project picker and one branch picker across the app

Several project and branch picker implementations exist, each flawed. Replace them with one shared project picker and one shared branch picker used everywhere. Remove the old implementations.

