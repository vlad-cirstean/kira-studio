# P255 plan: linear workflow graph editor

Base: `v2.0` at `23924abcb`. Discovery: CodeGraph (`codegraph_explore`), then source reads of the files
below; index lacks most `ade/v2/workflows/*.vue`, so those were read directly.

Order note: user ordered P255 to run now, in parallel with P252, ahead of P253/P254 despite table
position. Renumbers nothing.

## 0. Ask

Workflow graph editor (P247) is small, crowded, hard to follow. User decisions:
1. Layout locked: no node dragging; dagre owns layout, re-run on every edit.
2. Flow in one direction only.
3. Every node same size; no zoom in or out needed.
4. Scroll in one direction only.
5. Simple to understand and reason about.
Keep every editing capability. Task detail must keep representing workflow branches and automation
correctly.

## 1. Current tree (verified)

- `ade/v2/board/workflowGraph.ts`: pure model. `layoutWorkflow` lays stages left to right
  (`x += w + STAGE_GAP`), and inside an agent stage runs dagre top to bottom. Two flow axes at once: the
  main source of crowding. Sizes differ: step `248x112`, leaf stage `248x72`, end `112x32`, group frames
  sized per stage. Loop edges skip dagre ranking. Edges carry no route points.
- `ade/v2/workflows/AdeWorkflowGraph.vue`: Vue Flow canvas in a `ResizablePanelGroup` beside the
  inspector. `nodesDraggable=false` already. Free pan and zoom (`minZoom 0.2`, `maxZoom 1.5`, d3 wheel
  zoom on), `fitView` on init and resize, toolbar zoom in, zoom out, fit view (`ade-wf-graph-tools`).
- `AdeStepNode.vue`: target handle Top, one source handle per result at Bottom; 2-line prompt.
- `AdeStageGroupNode.vue`: handles Left (`in`) and Right (`out`), matching the left-to-right stage axis.
- `AdeEndNode.vue`: small pill, handle Top.
- `AdeResultEdge.vue`: bezier for forward edges; loop edges bow 210px to the right, dashed, label at
  bezier midpoint. A rank-skipping forward edge draws straight through the steps between.
- Unchanged by this phase: `state/adeWorkflowDraft.ts` (edit ops only, no positions), inspectors
  (`AdeStepInspector`, `AdeStageInspector`, `AdeStepResults`), YAML mode, stage strip (`VueDraggable`).
- Task detail: `panel/AdeWorkflowBlock.vue` renders `panel/AdeStageBlock.vue` over `board/stageBlocks.ts` and
  `board/progress.ts`. A list, not the Vue Flow graph. `layoutWorkflow` has one caller
  (`AdeWorkflowGraph.vue`); `workflowGraph.ts` edit ops are used by the draft store only. So task detail
  shares no code with this change and stays correct by construction. P250 S1 is editing `stageBlocks.ts`
  now; P255 must not touch it.

## 2. Decisions (planner defaults; user may override)

- D1 Direction: top to bottom everywhere. Stages stack vertically; steps inside an agent stage rank top
  to bottom. Why not left to right: step nodes already hold text in rows, the existing step axis is TB,
  forward routes always point later (`normalizeOrder`), and a vertical document scrolls naturally next
  to the right-hand inspector.
- D2 Scroll: vertical only, native. The canvas is an `overflow-y-auto overflow-x-hidden` scroller; Vue
  Flow fills an inner div sized to the laid-out graph height. Native scrollbar, wheel, trackpad and
  keyboard scrolling work with no custom pan code. Chosen over Vue Flow `panOnScroll` +
  `translateExtent` clamping: that hides the scrollbar and needs its own clamp arithmetic.
- D3 No zoom: `zoomOnScroll`, `zoomOnPinch`, `zoomOnDoubleClick`, `panOnDrag`, `panOnScroll` all
  `false`; `preventScrolling=false` so wheel events reach the native scroller; `autoPanOnConnect=false`,
  `autoPanOnNodeDrag=false`. Remove the zoom in, zoom out and fit buttons (`ade-wf-graph-tools`). No
  minimap, no Controls.
- D4 Fit width: viewport zoom `z = min(1, paneWidth / graphWidth)`, set by the code only
  (`setViewport`), recomputed on layout change and pane resize (`useElementSize`, VueUse). Graph is
  centred horizontally. Normal workflows render at `z = 1`; only an unusually wide branch fan shrinks.
- D5 One node size: step, user stage, script stage and end node all `NODE_W x NODE_H` = `256 x 104`.
  Strict reading of "every node same size", end node included; it stays visually light (dashed border,
  muted text). Content fits by truncation: name (1 line), runs-on plus badges (1 line), prompt (1 line,
  `truncate`), result row. Full text lives in the existing inspector (no new panel). Result dots carry a
  tooltip (`AdeTip`) with id, ok flag and route.
- D6 Result row: dots spread evenly on the bottom edge; labels shown when `results.length <= 4`, dots
  only above that (max 12 per parser).
- D7 Fixed handle sides: every node `in` at Top centre; result handles at Bottom; stage frames `in` Top
  and `out` Bottom on the spine column; step nodes gain a `loop-in` target handle at Left for loop
  edges. Connection validation unchanged (a drop on `loop-in` routes like a drop on `in`).
- D8 Spine: the main success path is straight. Spine = from the start step, follow the first `ok`
  forward result (non-loop) each step. Spine edges get dagre `weight: 8, minlen: 1`; other forward
  edges `weight: 1`. All stages align their spine on one global column x; leaf stages sit on it; stage
  to stage edges run straight down it. If dagre weight alone leaves a spine node off the column (unit
  test catches it), add a snap pass that sets spine x to the column and pushes same-rank nodes outward
  by `NODE_W + NODE_SEP`.
- D9 Branches: forward non-spine edges fan to the side as dagre places them. Rank-adjacent edges use
  `getSmoothStepPath` (rounded orthogonal). Rank-skipping edges use dagre's own edge `points` (routed
  around dummy nodes) as a rounded polyline, so no edge crosses a node. Labels (result ids) sit just
  below the source handle, not at the midpoint, so they never pile up on the spine.
- D10 Loops: never a long crossing edge. Each loop (target at or before source, `max > 0`) is a dashed
  orthogonal edge in a left gutter: down from the result dot, left to its lane, up, right into the
  target's `loop-in` handle, arrow. Lanes by interval colouring over `[targetRow, sourceRow]` so nested
  or overlapping loops get distinct lanes; self loops are `[i, i]`. Label `<results> ↩ ≤<max>` at the
  lane's lower corner. Gutter width = `lanes * LOOP_LANE` inside the stage frame.
- D11 Spacing: `RANK_SEP 64`, `NODE_SEP 56`, `EDGE_SEP 24`, `STAGE_GAP 48`, `GROUP_PAD 20`,
  `GROUP_HEAD 36`, `LOOP_LANE 20`. One frame width for every stage (max needed), so frames line up.
- D12 Stage strip, name field, Kira Space switch, save bar, inspector panel, Delete key, Ctrl+S, route
  select, drag a result dot to a step: all kept as is.
- D13 `stop` results keep drawing no edge (as P247); the dot tooltip says `stop`.

## 3. Design

### 3.1 `board/workflowGraph.ts` (pure)

- Constants per D5, D11. Drop `STEP_H`, `LEAF_H`, `END_W`, `END_H`.
- `GraphNode` keeps `x, y, w, h` (w, h always `NODE_W`, `NODE_H` for non-frame nodes); stage frame adds
  `spineX` (column x inside the frame, for its handles).
- `GraphEdge` adds `points?: {x: number; y: number}[]` (absolute flow coords, rank-skipping forward
  edges), `lane?: number` and `laneX?: number` (loops, absolute), `spine: boolean`.
- `spineIds(stage)`: D8 walk; ignores loops and `stop`/`end`.
- `layoutAgent(stage)`: dagre `rankdir TB`, `ranksep`, `nodesep`, `edgesep`; spine weights; returns
  inner layout relative to its own origin, spine x, inner width and height, loop lane count.
- `loopLanes(edges, rowOf)`: greedy interval colouring sorted by span then source row; returns lane per
  loop edge id and lane count.
- `layoutWorkflow(wf)`: lay each stage, compute global column `C = max(gutter_i + spineX_i - minX_i)`,
  frame width `W = max over stages`, then stack stages at `y += h + STAGE_GAP`, each shifted so its spine
  lands on `C`. Leaf stages: one node at `x = C - NODE_W/2`. Convert dagre points to absolute flow coords
  (frame x + `GROUP_PAD`, frame y + `GROUP_HEAD + GROUP_PAD`). Returns `{nodes, edges, width, height}`.
- Edit ops (`setRoute`, `normalizeOrder`, ...) unchanged.

### 3.2 `workflows/AdeWorkflowGraph.vue`

- Canvas markup: `div.scroller` (`absolute inset-0 overflow-y-auto overflow-x-hidden`,
  `data-testid="ade-wf-graph"`) > `div` with `height: (layout.height + 2*PAD) * z px` > `VueFlow`.
- VueFlow props per D3; `:min-zoom="0.1" :max-zoom="1"` (bounds only; never user-driven).
- `useElementSize(scroller)` gives width; `z` per D4; `watch([layout, width])` calls `setViewport({x, y: PAD*z,
  zoom: z})`. Remove `fitView`, `zoomIn`, `zoomOut`, `onNodesInitialized`, `useResizeObserver`, the
  toolbar and its `TooltipIconButton` import.
- Edge data carries `points`, `laneX`, `spine` through to the edge component.
- Inspector empty text: drop nothing; still explains dragging a result dot.

### 3.3 Node and edge components

- `AdeStepNode.vue`: fixed size, 1-line prompt, `loop-in` Left handle, D6 result row with `AdeTip`
  per dot (`data-testid="ade-wf-node-result"` kept).
- `AdeStageGroupNode.vue`: handles Top/Bottom at `data.spineX` (frame) or centre (leaf); leaf node fixed
  size; agent frame header row only.
- `AdeEndNode.vue`: fixed size, centred text, `in` Top.
- `AdeResultEdge.vue`: three geometries: smoothstep (rank-adjacent forward), rounded polyline over
  `points` (rank-skipping forward), gutter path (loop, D10). Keep `data-tone`, `data-loop`,
  `data-results`, `data-selected`; add `data-spine`. Label placement per D9/D10. Keep marker ids.
- Tailwind only, no scoped style, no colour literals (`check-ade-colours`). shadcn `Tooltip` via
  `AdeTip`. All `<script setup lang="ts">`.

### 3.4 Docs

`docs/ARCHITECTURE.md` "Graph editor (P247 ...)" bullet (around line 3908): add one sentence: top to
bottom, fixed node size, locked layout, vertical native scroll, no zoom, loops in a left gutter
(P255). P250 is editing ARCHITECTURE.md elsewhere (no hunk near 3908 at planning time); rebase if it
conflicts.

## 4. Files and ownership

One sequential Sonnet implementer (work is one continuous piece: model, canvas, nodes, edges, specs).

P255 owns:
- `apps/kira-space/frontend/src/ade/v2/board/workflowGraph.ts`
- `apps/kira-space/frontend/src/ade/v2/workflows/AdeWorkflowGraph.vue`
- `apps/kira-space/frontend/src/ade/v2/workflows/AdeStepNode.vue`
- `apps/kira-space/frontend/src/ade/v2/workflows/AdeStageGroupNode.vue`
- `apps/kira-space/frontend/src/ade/v2/workflows/AdeEndNode.vue`
- `apps/kira-space/frontend/src/ade/v2/workflows/AdeResultEdge.vue`
- `apps/kira-space/tests/unit/ade-v2-workflow-graph.spec.ts` (modify)
- `apps/kira-space/tests/ui/ade-v2-workflow-layout.spec.ts` (new)
- `apps/kira-space/tests/ui/ade-v2-workflows.spec.ts` (modify, one test; shared with P250, see below)
- `apps/kira-space/tests/visual/ade-workflow-graph.spec.ts` and
  `apps/kira-space/tests/visual/ade-workflow-graph.spec.ts-snapshots/` (re-record, add one case)
- `docs/ARCHITECTURE.md` (one bullet, 3.4)
- `docs/v2.2/plans/P255-result.md`, `docs/v2.2/SPEC.md` (P255 row status only)

Docker (P252): zero overlap. P255 touches nothing under `packages/docker-ui`, `apps/kira-studio`,
`internal/docker`, or any docker spec.

P250 overlap (it owns `apps/kira-space/tests/{ui,mobile,contract,claude}/**`):
- `tests/ui/ade-v2-workflows.spec.ts`: P250 commit `411fd0774` (branch `p250-W`, unmerged) inserts a
  contract test just above `dragging a result dot to another step sets its route`. P255 changes only
  that drag test's target locator (`.vue-flow__handle.target` becomes ambiguous with the new `loop-in`
  handle; use `[data-handleid="in"]`). Different lines; rebase resolves cleanly. Implement in its own
  worktree; rebase onto `v2.0` after P250 lands, or P250 rebases onto P255, whichever lands second.
- `docs/ARCHITECTURE.md`: different section (3.4).
- All other P255 test files are new or outside P250's dirs (`tests/unit`, `tests/visual`).
- Not touched: `frontend/src/ade/v2/board/stageBlocks.ts` (P250 S1), `tests/ui/ade-v2-automations.spec.ts`
  (its `ade-wf-node[data-step-id="plan"]` click keeps working; selector unchanged).

## 5. Tests (CLAUDE.md bar)

IPC split: layout is frontend-only; wire and save payload unchanged. Backend half already exists
(`flows/adeflow` `TestBranching` 'saved results round trip'); no new flow test.

Unit, modify `tests/unit/ade-v2-workflow-graph.spec.ts` `describe('layoutWorkflow')` (geometry with
interacting rules: spine, lanes, stage stacking). Replace `... lays stages left to right` with:
- stages stack top to bottom, frames share one width and one spine column;
- every non-frame node is `NODE_W x NODE_H`;
- linear stage and the standard fixture's `impl` stage: spine nodes share one centre x, y strictly
  increasing;
- diamond (A routes to B or C, both route to D): B and C share one rank, D on the spine, no
  forward edge points upward;
- loops: nested and overlapping loops get distinct lanes, disjoint loops share a lane, self loop gets
  a lane; no loop edge has `points`.

UI, new `tests/ui/ade-v2-workflow-layout.spec.ts` (mocked bridge, standard fixture):
- node not draggable: mouse drag a step node 150px; its bounding box unchanged;
- every `ade-wf-node`, `ade-wf-stage-node` (leaf), `ade-wf-end-node` has equal width and height;
- stage nodes ordered top to bottom by stage index; spine step nodes share centre x within 1px;
- wheel over the canvas scrolls `ade-wf-graph` vertically (`scrollTop` grows) and the viewport transform
  scale is unchanged; Ctrl+wheel and double click change no scale; `scrollWidth <= clientWidth`;
- no `ade-wf-zoom-in`, `ade-wf-zoom-out`, `ade-wf-fit`, `.vue-flow__minimap`;
- loop edges `data-loop="true"` sit left of every node in their stage (path bbox right edge <= node
  left);
- an edit re-runs layout: add a step after `impl` in the inspector; the new node appears below `impl`
  on the spine column, `tests` moves down.

UI, modify `tests/ui/ade-v2-workflows.spec.ts`: drag test locator only (section 4). Scroll the `pr`
node into view first if `impl` is off screen in the test viewport.

Visual, `tests/visual/ade-workflow-graph.spec.ts`: re-record `workflow-graph.png` (layout changes by
design); add `workflow-graph-branches.png`: a stage with a diamond branch, a forward skip to end and two
nested loops. Record with `bun run test:visual:update:space` (baselines re-recorded in this container
before, P227/P229).

Existing specs and baselines touched: `tests/unit/ade-v2-workflow-graph.spec.ts`,
`tests/ui/ade-v2-workflows.spec.ts`, `tests/visual/ade-workflow-graph.spec.ts`,
`tests/visual/ade-workflow-graph.spec.ts-snapshots/workflow-graph-visual-linux.png`. None other assert
graph positions, zoom or dragging (grep `ade-wf-graph|ade-wf-zoom|ade-wf-fit|vue-flow` over
`apps/kira-space/tests`; e2e-real and mobile have no `ade-wf-` selector).

Checks: `bun run lint` (incl. check-ade-colours), `bun run lint:dead`, `bun run typecheck`,
`bun run test:unit`, `bun run test:ui:space` (workflows, workflow-layout, automations, panel, run specs),
`bun run test:visual:space`.

## 6. Commits

1. `feat(ade): lay out the workflow graph top to bottom with one node size` (workflowGraph.ts + unit).
2. `feat(ade): lock the workflow canvas to vertical scroll, no zoom` (AdeWorkflowGraph, nodes, edge).
3. `test(space): workflow layout UI spec and visual baselines` (+ drag locator).
4. `docs: P255 result and architecture note`.

## 7. Orchestrator verification checklist

- `grep -n "zoomIn\|zoomOut\|fitView\|ade-wf-zoom\|ade-wf-fit" apps/kira-space/frontend/src/ade/v2` empty.
- VueFlow tag sets `:zoom-on-scroll="false" :zoom-on-pinch="false" :zoom-on-double-click="false"
  :pan-on-drag="false" :pan-on-scroll="false" :prevent-scrolling="false"`; scroller has
  `overflow-x-hidden`.
- `workflowGraph.ts` has no per-kind height constants; one `NODE_W`, one `NODE_H`.
- New UI spec present and green; visual baselines re-recorded; unit layout tests replaced, not deleted.
- `git diff v2.0 --stat` lists only section 4 files; no `stageBlocks.ts`, no docker paths.

## 8. Deferred (defaults taken)

- End node size: same as steps (D5). Alternative: compact terminal pill.
- Loop rendering: gutter edge (D10). Alternative: badge on the source result dot, no edge.
- Autoscroll while dragging a result dot past the scroller edge: not built; route select covers far
  targets.
- Width overflow: fit-width shrink (D4) with no floor. Alternative: horizontal scroll, rejected by D2.
- Stop results: no edge (D13). Alternative: small stop marker under the dot.

## 9. Not in P255

Task detail (`AdeWorkflowBlock`, `AdeStageBlock`), run views, YAML mode, inspectors, wire, Go.
