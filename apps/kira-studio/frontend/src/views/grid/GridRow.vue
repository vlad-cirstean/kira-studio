<script setup lang="ts">
import { computed, inject, onUpdated } from 'vue';
import CodiconIcon from '../../theme/CodiconIcon.vue';
import { GUTTER_WIDTH } from '../shared/page/columns';
import { ROW_HEIGHT_KEY, type RowVM } from './rowVm';

// P22 iter2 D4(i): one row's `.grid-row` subtree, extracted from DataGrid.vue's own template so it
// can be a *child component* rather than inline markup in a v-for — see the plan's §5 D4/F11.
// Vue's shouldUpdateComponent skips a component vnode entirely (no render, no vnode diff, no DOM
// patch) when its dynamic props are reference-unchanged; `rowVm` below is the *only* one, on
// purpose (F11(a)) — DataGrid.vue's renderRows is what makes that prop reference-stable for a row
// nothing relevant changed about (D4(ii)).
//
// No event listeners live in this template: D5 (event delegation) moved cell/gutter mousedown/
// mouseenter/click/dblclick/contextmenu handling to one listener per event type on `.data-grid`
// itself (closest()-based, the same pattern extendFromPoint/onCellNavClickFromEvent already used) —
// that is F11(c)'s other prerequisite: an inline-arrow or emit-listener prop on <GridRow> would be
// a second reference for the bail-out to keep stable, on top of rowVm.
const props = defineProps<{ rowVm: RowVM }>();

const rowHeight = inject(
  ROW_HEIGHT_KEY,
  computed(() => 28),
);

// P22 iter2 D4's own sandbox-provable proof: a render-count hook, gated in tests/ui/budgets.spec.ts
// against (rows entered + rows left + a small constant) per scroll step. This settles the mechanism
// (Vue's own reconciliation only re-renders a GridRow whose rowVm reference actually changed) — it
// says nothing about whether that's *enough* to fix the user's real-hardware symptom, which is a
// different question (§7.3 of the plan).
onUpdated(() => {
  window.__kiraGridRowUpdates?.();
});
</script>

<template>
  <div
    class="grid-row"
    data-testid="grid-row"
    :data-row="props.rowVm.row"
    :class="{ 'pending-delete': props.rowVm.deleted }"
    :style="{
      top: `${rowHeight + props.rowVm.pos * rowHeight}px`,
      height: `${rowHeight}px`,
    }"
  >
    <!-- scroll-margin-top = rowHeight below: `.header-row` is position: sticky, which a native
         scrollIntoView(IfNeeded) call doesn't otherwise know to leave room for. -->
    <div
      class="gutter-cell"
      data-testid="grid-gutter-cell"
      :data-row="props.rowVm.row"
      :class="{ dirty: props.rowVm.dirty, deleted: props.rowVm.deleted }"
      :style="{ width: `${GUTTER_WIDTH}px`, scrollMarginTop: `${rowHeight}px` }"
    >
      {{ props.rowVm.gutterNumber }}
    </div>
    <div
      v-for="cellVm in props.rowVm.cells"
      :key="cellVm.name"
      class="grid-cell"
      data-testid="grid-cell"
      :data-row="props.rowVm.row"
      :data-col-index="cellVm.col"
      :data-column="cellVm.name"
      :data-null="cellVm.isNull"
      :class="cellVm.classes"
      :style="{
        left: `${cellVm.left}px`,
        width: `${cellVm.width}px`,
        scrollMarginTop: `${rowHeight}px`,
        color: cellVm.color || undefined,
      }"
    >
      <!-- The inline editor for this cell (if any) is DataGrid.vue's own single overlay <input>,
           not rendered here — a second, editing-only prop would be one more reference this
           component's bail-out has to keep stable for every unedited row, for a state that is
           true for at most one cell in the whole grid at a time (P22 iter2 D4). -->
      <template v-if="!cellVm.editing">
        <template v-if="cellVm.isNull">
          <span class="cell-null">NULL</span>
        </template>
        <template v-else>
          {{ cellVm.text
          }}<span
            v-if="cellVm.truncated"
            class="truncated-marker"
            v-tooltip="'value truncated at 64 KB'"
            >…</span
          >
        </template>
        <!-- No click handler here: routed through .data-grid's own delegated click listener
             (onDataGridClick's cell-nav-btn branch), which is where onCellNavClick's own
             dependencies (navColumns, rt(), dialect) already live (D5). -->
        <button
          v-if="cellVm.navKind"
          type="button"
          class="cell-nav-btn"
          data-testid="cell-nav-button"
          :data-nav-kind="cellVm.navKind"
          :aria-label="cellVm.navKind === 'fk' ? 'Go to referenced row' : 'Referenced by'"
        >
          <CodiconIcon :name="cellVm.navKind === 'fk' ? 'arrow-right' : 'references'" :size="13" />
        </button>
      </template>
    </div>
  </div>
</template>

<!-- P22 iter2 D4: unscoped, not `<style scoped>` — DataGrid.vue's own template also renders
     `.grid-row`/`.gutter-cell`/`.grid-cell` elements (the pending-insert row, the header gutter,
     insert-cells), and Vue's scoped CSS only stamps a child component's *root* element with its
     parent's scope attribute, not the rest of its subtree, so a scoped rule here would not reach
     DataGrid.vue's own uses of these classes and a scoped rule kept in DataGrid.vue would not reach
     these. Plain global CSS is the one thing both files can share without duplicating every rule —
     these class names (grid-row, gutter-cell, grid-cell, cell-null, truncated-marker, cell-nav-btn)
     are specific enough that a collision elsewhere in the app is not a real risk. -->
<style>
.grid-row {
  position: absolute;
  left: 0;
  right: 0;
  /* Scopes a row's layout invalidation to the row (P29 D8) — not `paint` (the cells already clip
     their own overflow, and the sticky gutter/absolutely-positioned nav button both sit inside
     this box) and not `will-change` (this compositing a ~280 000px-tall sizer trades §2.1 for
     §2.2, the way P12's memory findings warn against). */
  contain: layout;
}

/* No zebra striping — the design's own _gridrows.html/_style.css draws no alternating row
   colour, only the hover state below. */
.grid-row:hover .grid-cell:not(.selected),
.grid-row:hover .gutter-cell {
  background: var(--kira-hover);
}

.gutter-cell {
  position: sticky;
  left: 0;
  z-index: 1;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-right: var(--kira-s-4);
  box-sizing: border-box;
  background: var(--kira-bg-elevated);
  color: var(--kira-fg-disabled);
  font-size: var(--kira-t-xs);
  border-right: var(--kira-border-width) solid var(--kira-border-strong);
  border-bottom: var(--kira-border-width) solid var(--kira-border);
  cursor: pointer;
}

/* README/FIX: a row with a staged edit gets the same 2px warn rail the mockup's
   .tr.dirty .td.gutter::before draws — never a background tint across the whole row.
   `.gutter-cell` is already `position: sticky` (a valid containing block for an absolutely
   positioned child in its own right) — an added `position: relative` here used to override that
   sticky positioning outright (a two-class selector beats the base rule's one), unpinning a
   dirty/deleted/inserted row's index cell so it scrolled away horizontally with the rest of the
   row instead of staying put. */
.gutter-cell.dirty::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--kira-warn);
}

/* P31 D31/F30: a row staged for deletion gets its own red rail — mutually exclusive with .dirty
   above (isDirtyRow no longer counts a delete), since a row headed for deletion will not have any
   staged edits applied. */
.gutter-cell.deleted::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--kira-error);
}

/* A pending-insert row is not "edited" (nothing existing changed) — same 2px rail treatment,
   coloured ok/green instead of warn/yellow so the two staged-change kinds read apart at a glance. */
.gutter-cell.inserted::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--kira-ok);
}

.grid-cell {
  position: absolute;
  top: 0;
  height: 100%;
  display: flex;
  align-items: center;
  padding: 0 var(--kira-s-4);
  box-sizing: border-box;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  border-right: var(--kira-border-width) solid var(--kira-border);
  border-bottom: var(--kira-border-width) solid var(--kira-border);
  cursor: default;
  /* D1: guarantees the native role:'copy'/'paste' accelerators have nothing to act on while
     the grid has focus, so they never race the grid's own local Ctrl+C/Ctrl+V handler. */
  user-select: none;
}

.grid-cell.align-right {
  justify-content: flex-end;
  font-variant-numeric: tabular-nums;
}

.grid-cell.fk {
  color: var(--kira-info);
}

/* The nav button only shows on hover/selected, but the text always truncates before its slot —
   otherwise it's only "over the text" once you're already hovering to click it. */
.grid-cell.has-nav {
  padding-right: calc(var(--kira-s-4) + 18px);
}

/* P42 D21/F15: a per-cell `outline` drew a complete ring around every selected cell — two
   adjacent selected cells' touching edges were two separate 1px lines, one pixel apart, both
   focus-coloured. Each of the four sides is now its own inset box-shadow layer, switched on only
   when that side sits on the selection's own outer perimeter (.sel-t/.sel-r/.sel-b/.sel-l,
   DataGrid.vue's own renderRows) — an internal seam between two selected cells gets no shadow from
   either side, so the selection's outer boundary reads as one uniform 1px line. Custom properties
   (not four separate declarations) are what make this compose: box-shadow's four layers are always
   present, each independently no-op (transparent, zero-sized) until its own edge class overrides
   just that one variable. */
.grid-cell.selected {
  background: var(--kira-select);
  --sel-t: 0 0 0 0 transparent;
  --sel-r: 0 0 0 0 transparent;
  --sel-b: 0 0 0 0 transparent;
  --sel-l: 0 0 0 0 transparent;
  box-shadow:
    inset var(--sel-t),
    inset var(--sel-r),
    inset var(--sel-b),
    inset var(--sel-l);
}

.grid-cell.selected.sel-t {
  --sel-t: 0 var(--kira-border-width) 0 0 var(--kira-focus);
}

.grid-cell.selected.sel-r {
  --sel-r: calc(-1 * var(--kira-border-width)) 0 0 0 var(--kira-focus);
}

.grid-cell.selected.sel-b {
  --sel-b: 0 calc(-1 * var(--kira-border-width)) 0 0 var(--kira-focus);
}

.grid-cell.selected.sel-l {
  --sel-l: var(--kira-border-width) 0 0 0 var(--kira-focus);
}

.grid-cell.search-match {
  background: var(--kira-search-match);
}

.grid-cell.search-match-current {
  background: var(--kira-search-match-current);
  color: var(--kira-bg);
}

.cell-null {
  color: var(--kira-fg-disabled);
  font-style: italic;
}

.truncated-marker {
  color: var(--kira-fg-muted);
  margin-left: 2px;
  flex-shrink: 0;
}

/* p-td.edited: the warn colour is the whole affordance, never a background tint (that's reserved
   for selection/search) — a selected+edited cell still shows both, exactly like _gridrows.html's
   "sel edited" row. */
.grid-cell.pending-edit {
  color: var(--kira-warn);
}

/* P7 D5/D8: pure-CSS hover/selection affordance, no JS-tracked hover state — mirrors
   .header-select-zone/.resize-handle's own absolute-inside-absolute precedent (DataGrid.vue). */
.cell-nav-btn {
  display: none;
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: var(--kira-border-width) solid var(--kira-border);
  border-radius: var(--kira-radius-sm);
  background: var(--kira-bg-elevated);
  color: var(--kira-fg-muted);
  cursor: pointer;
  z-index: 1;
}

.cell-nav-btn:hover {
  background: var(--kira-hover);
  color: var(--kira-fg);
}

.grid-cell:hover .cell-nav-btn,
.grid-cell.selected .cell-nav-btn {
  display: flex;
}

.grid-row.pending-delete {
  text-decoration: line-through;
  opacity: 0.5;
}

.grid-row.pending-insert {
  background: color-mix(in srgb, var(--kira-accent) 8%, transparent);
}
</style>
