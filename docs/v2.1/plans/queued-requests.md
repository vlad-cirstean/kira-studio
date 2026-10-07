# Queued v2.1 requests

Not yet planned. Add to `SPEC.md` as P197-P199 after streams A-C land (touch Stream C's ADE files). Each needs an Opus plan first. P197-P199 are reserved for these. P200 (Docker module) moved to `SPEC.md`, planned in `P200-plan.md`.

- P197: workflow editor, right-click a stage opens a context menu (shadcn-vue ContextMenu) with a "Skip" item.
- P198: Agents module, right-click context menu on a task with useful controls (decide set during planning).
- P199: Kira Space MCP server exposed to agents, enabled per workflow in workflow config. Tools: declare repos a task touches; request a branch with an agent-chosen name. Kira Space records repos and branches per task. Removes manual branch creation.
- P202: worktree prepare scripts run long. Every place that can trigger one (git module worktree create/prepare, ADE task start/branch flows, any other caller of `RunPrepare`/`handleWorktreePrepare`) shows a clear in-progress indicator while it runs, and on failure shows that it failed and why (script output / exit status). Plan must enumerate all trigger sites via CodeGraph first. Touches Space ADE and git module files (Stream C area): plan after C lands.
