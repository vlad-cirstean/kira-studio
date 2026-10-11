# P263 Stream B findings

Issues in files Stream B does not own. Close-out decides.

- Card `inset` fills `bg-field`. An Input, Select or Checkbox inside it vanishes (same fill). Stream B used `Card variant="section" class="gap-1 p-2"` for AdeStepResults. Consider documenting in `Card`: inset holds text only, section holds controls.
- Status-bar items outside Stream B (AppMetricsItem, UpdateAvailableItem, RunsStatusItem) may differ from the `Button variant="toolbar" size="kira" class="h-control-sm gap-1 px-1.5"` treatment Stream B used in ClaudeUsageItem and StatusBar. Align at close-out.
- Mobile 16px inputs (ReplySheet, TerminalScreen compose) keep `text-base` against iOS focus zoom. Permanent U38 lines. A kira-scale token at 16px would remove the exemption.
- Plan-board geometry files (AdeActionCell, AdeBranchRow, AdeTaskCard) carry permanent U37/U38 lines. A board row-height token would remove them.
- Baselines re-recorded by Stream B: ade-workflow-graph (2 PNG), settings (appearance, memory). Intended diffs: Switch to Checkbox for result `ok`, Badge chips, Card padding. `git-module.spec.ts` snapshots untouched.
