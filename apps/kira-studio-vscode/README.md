# Kira Version

Kira Studio's git graph, branch review and remote operations, inside VS Code.

## What it is

Kira Version brings Kira Studio's commit graph and branch-review sidebar into VS Code, alongside
the usual editor and terminal — no context switch to check history, review a branch, or run a
fetch/pull/push.

## How it connects

Kira Studio runs the actual git backend; this extension dials `~/.kira-studio/git.sock`. The
first connection asks for approval in Kira Studio's own window — once per editor installation, not
once per workspace, so opening a second window on a different repository connects without a second
prompt. Kira Studio must already be running for the extension to connect.

**Both sides must be on the same release.** The extension and Kira Studio speak a versioned wire
contract; a version mismatch is reported clearly (a status-bar error and a message with both
versions), rather than a silent failure — update whichever side is behind.

## Basic usage

- **Git Graph** — the activity-bar panel showing the commit graph, with branch/tag decorations,
  a detail pane, and diffs that open in VS Code's own native diff editor.
- **Kira Version** — the second activity-bar view: pick a branch, review its commits or its
  changed files against a base, and mark files reviewed.
- **Range/hunk review marking** — inside a branch review diff, select lines (or use the gutter
  mark's hover) and mark just that selection reviewed or unreviewed from the diff editor's own
  toolbar, right-click menu, or the `Kira Version: Mark Selection Reviewed`/`Unreviewed` palette
  commands. Turn on `"diffEditor.codeLens": true` for an inline "Mark Reviewed"/"Mark Unreviewed"
  action at each change block too — it is off by default in VS Code itself, so this extension
  never enables it for you.
- **`Kira Version:` command palette prefix** — every command this extension contributes, including
  opening a repository and checking connection status.
- **Status-bar item** — shows the connection state at a glance (connecting, waiting for approval,
  connected, or a problem to click through to); click it to focus the graph or see what is wrong.

## Requirements

- macOS
- Kira Studio running
- git ≥ 2.38
