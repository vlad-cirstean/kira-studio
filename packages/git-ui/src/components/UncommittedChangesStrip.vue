<script setup lang="ts">
/**
 * G-UX (item 4): "current changes on a branch aren't visible in the git graph at all" — a small,
 * pinned strip above the graph, not a synthetic row inside it. The literal ask (a GitLens-style
 * virtual row in-line with real commits) was rejected for v1: "grid row index" and "store row
 * index" are the same untyped integer in ~25 places across `columns.ts`/`graphColumn.ts`/
 * `layoutStore.ts`/`CommitGrid.vue`/`state/selection.ts`/`App.vue` (including a persisted
 * scroll-row value saved across sessions) — inserting a row upstream of real data would mean
 * converting every one of those to an explicit grid-row<->store-row mapping, its own project. This
 * sits entirely outside SlickGrid's coordinate space instead: a `flex-shrink: 0` sibling mounted
 * above `<CommitGrid>` in `App.vue`'s own flex-column `.kv-graph-region`, so none of those ~25
 * row-index assumptions are touched.
 *
 * Data: `OpsState.statusSummary` — already reactive, already refreshed on every `repo.changed`
 * (`OpsState`'s own constructor). Shown only while `!isClean`.
 *
 * Alignment: a bounded scan of the first `HEAD_SCAN_LIMIT` loaded rows for the HEAD decoration —
 * the same `isHeadDecoration` single source of truth `graphColumn.ts`'s own formatter already
 * reads, so this can never disagree with which row the real graph bolds — then that row's lane
 * via `GraphViewState.layout`, positioned with the exact `laneX`/`graphColumnWidth` math
 * `rowSvg.ts`/`geometry.ts` use for the real graph column, so the two line up visually. The node
 * glyph itself reuses `rowSvg.ts`'s own stash shape (an unfilled dashed ring, lane-coloured) —
 * dashed reads as "not a real commit" the same way it already does for a stash entry.
 *
 * No click action in v1 — informational only (a count, and a tooltip naming every changed path,
 * honouring `dirtyTruncated`). Wiring a click to actually open the changes would need a new IPC
 * method: `editor.openAllChanges` requires a `sha`, which "uncommitted" does not have — out of
 * scope for "make it visible."
 */
import { computed, onBeforeUnmount, ref } from 'vue';
import { GEOMETRY, graphColumnWidth } from '../graph/geometry.ts';
import { laneClass } from '../graph/palette.ts';
import { isHeadDecoration, laneX } from '../graph/rowSvg.ts';
import type { GraphViewState } from '../state/graphView.ts';
import type { OpsState } from '../state/ops.ts';

const props = defineProps<{
  graphView: GraphViewState;
  opsState: OpsState;
}>();

/** Cheap: the checked-out branch's own HEAD decoration is essentially always within the first
 *  page of history (the newest commits) — a bounded scan, never a search over the whole loaded
 *  store. If HEAD has not loaded yet (a very deep, unusual case), the strip simply shows no node
 *  glyph until it does — see `headRow` below. */
const HEAD_SCAN_LIMIT = 200;

/** `GraphViewState.layout` is driven by `onChunkLayout` callbacks, not a reactive ref (that
 *  class's own doc comment: "Layout is driven from the append, not from the render") — bumped on
 *  every applied chunk so `headLane`/`headColor` below recompute once a row's lane actually
 *  arrives, which can land a tick after the row's own text does (W5's "text first, graph a frame
 *  later"). */
const layoutTick = ref(0);
const unsubscribeLayout = props.graphView.onChunkLayout(() => {
  layoutTick.value++;
});
onBeforeUnmount(unsubscribeLayout);

const summary = computed(() => props.opsState.statusSummary.value);
const visible = computed(() => summary.value !== undefined && !summary.value.isClean);

const headRow = computed<number | undefined>(() => {
  // Establishes a dependency on generation/loadedRows so a reset or a freshly streamed page
  // re-scans — `store`/`layout` themselves are markRaw and never trigger this computed on their
  // own (GraphViewState's own doc comment on why only the scalars are reactive).
  void props.graphView.generation.value;
  const limit = Math.min(props.graphView.loadedRows.value, HEAD_SCAN_LIMIT);
  const store = props.graphView.store;
  for (let row = 0; row < limit; row++) {
    if (store.decorationAt(row).some(isHeadDecoration)) return row;
  }
  return undefined;
});

const headLane = computed<number | undefined>(() => {
  void layoutTick.value;
  const row = headRow.value;
  if (row === undefined) return undefined;
  const layout = props.graphView.layout;
  if (row >= layout.rowCount) return undefined;
  return layout.laneOf(row);
});

const headColor = computed<number | undefined>(() => {
  void layoutTick.value;
  const row = headRow.value;
  if (row === undefined) return undefined;
  const layout = props.graphView.layout;
  if (row >= layout.rowCount) return undefined;
  return layout.colorOf(row);
});

/** Matches the real graph column's own width formula exactly (`geometry.ts`'s own doc comment on
 *  why `CommitGrid.vue`'s `setColumns` and this strip must never disagree about what a lane count
 *  spans). */
const gutterWidth = computed(() => graphColumnWidth(props.graphView.laneCount.value));
const nodeCx = computed(() => (headLane.value !== undefined ? laneX(headLane.value) : undefined));
const laneClassName = computed(() =>
  headColor.value !== undefined ? laneClass(headColor.value) : undefined,
);
const dashArray = `${GEOMETRY.strokeWidth} ${GEOMETRY.strokeWidth}`;

const totalCount = computed(() => {
  const counts = summary.value?.counts;
  if (!counts) return 0;
  return counts.staged + counts.unstaged + counts.untracked + counts.unmerged;
});

const tooltipText = computed(() => {
  const s = summary.value;
  if (!s) return '';
  const lines = s.dirtyPaths.join('\n');
  return s.dirtyTruncated ? `${lines}\n…` : lines;
});
</script>

<template>
  <div v-if="visible" class="kv-uncommitted-strip" role="status" data-testid="uncommitted-strip">
    <div class="kv-uncommitted-strip-gutter" :style="{ width: `${gutterWidth}px` }">
      <svg
        v-if="nodeCx !== undefined"
        class="kv-uncommitted-strip-node"
        :width="gutterWidth"
        height="18"
      >
        <circle
          :cx="nodeCx"
          cy="9"
          :r="GEOMETRY.nodeRadius"
          :class="laneClassName"
          :stroke-width="GEOMETRY.strokeWidth"
          :stroke-dasharray="dashArray"
          style="fill: none"
        />
      </svg>
    </div>
    <span
      v-kui-tooltip="tooltipText"
      class="kv-uncommitted-strip-label"
      data-testid="uncommitted-strip-label"
    >
      {{ totalCount }} uncommitted {{ totalCount === 1 ? 'change' : 'changes' }}
    </span>
  </div>
</template>

<style>
.kv-uncommitted-strip {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  height: 22px;
  border-bottom: 1px solid var(--kv-panel-border);
  background-color: var(--kv-row-hover-bg);
}

.kv-uncommitted-strip-gutter {
  flex-shrink: 0;
  height: 100%;
  display: flex;
  align-items: center;
  overflow: visible;
}

.kv-uncommitted-strip-node {
  overflow: visible;
}

.kv-uncommitted-strip-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--kv-description-fg);
  font-size: 0.9em;
}
</style>
