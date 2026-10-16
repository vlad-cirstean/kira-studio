# P255 result

Workflow graph editor locked: top to bottom, one node size, vertical scroll, no zoom. Design facts live in
`docs/ARCHITECTURE.md` ("Graph editor").

Commits: model + unit spec, canvas + node + edge components, UI spec + visual baselines, docs.

Deviations from the plan:

- Spine alignment: dagre weight alone left a parent centred between its children. `snapSpine` pins each spine
  node on the start column and pushes same-rank nodes and edge waypoints outward (plan D8 fallback).
- Forward edges use one rounded orthogonal builder in `AdeResultEdge.vue` (jog in the rank gap, vertical
  through dagre waypoints) instead of `getSmoothStepPath`; `points` holds only interior waypoints.
- `loop-in` handle sits at Top-left (`left: 20px`), not Left. A Left entry crossed same-rank nodes left of the
  target; entering from the rank gap above never crosses a node.
- Prompt line: `VarText` root has `whitespace-pre-line`; the node overrides it with `[&>span]:whitespace-nowrap`.
- Visual specs set a 1400x1750 viewport so the whole graph shows; both baselines re-recorded, plus
  `workflow-graph-branches` (diamond, forward skip to end, nested loops).
- UI spec checks the loop gutter by the edge path's left edge (the path also spans the source dot).

Known limits: labels of many results on one step can overlap (up to 12); autoscroll while dragging a dot is not built.

## Verification

- `bun test apps/kira-space/tests/unit/ade-v2-workflow-graph.spec.ts`: 19 pass.
- `playwright --project=ui` workflow-layout, workflows, automations: 42 pass.
- `playwright --project=visual` ade-workflow-graph: 2 pass after re-record; PNGs read by hand.
- `bun run lint` clean; `bun run typecheck` clean (hook).
- `bun run lint:dead` clean after rebase onto `28175f20b`.
