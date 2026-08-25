<script setup lang="ts">
import { computed } from 'vue';
import { selectedCellFor } from '../../../state/cellSelection';
import { layoutState, setCellEditorHeight } from '../../../state/layout';
import PanelSplitter from '../../../theme/primitives/PanelSplitter.vue';
import CellEditorView from './CellEditorView.vue';

// Mounted by the view that owns the tab (P26 D1), so one dock <-> one tab, torn down with it.
// `readOnly` (P40 D11): true when the mounting view has no write path for its cells at all (the
// query console) — a viewer, not an editor that happens to be refusing this particular cell.
// Distinct from a cell being individually uneditable (a read-only connection, a truncated value),
// which stays governed by CellEditorView's own readOnlyReasonFor regardless of this flag.
const props = withDefaults(defineProps<{ tabId: string; readOnly?: boolean }>(), {
  readOnly: false,
});

const cell = computed(() => selectedCellFor(props.tabId));
</script>

<template>
  <template v-if="cell">
    <PanelSplitter
      class="cell-splitter"
      orientation="row"
      reverse
      :size="layoutState.panel.cellEditor.height"
      :min="120"
      :max="480"
      @resize="setCellEditorHeight"
    />
    <div
      class="cell-dock"
      data-testid="cell-editor"
      :data-tab-id="tabId"
      :style="{ height: `${layoutState.panel.cellEditor.height}px` }"
    >
      <CellEditorView :cell="cell" :read-only="readOnly" />
    </div>
  </template>
</template>

<style scoped>
/* The workbench grid gave the splitter its size (a `--kira-gap` row between two gap-separated
   panels, tokens.css:31-36); inside a view there is no gap band to aim at, so the track carries
   its own height and the dock's border is the visible boundary (D11). */
.cell-splitter {
  height: var(--kira-s-2);
  flex-shrink: 0;
}

.cell-dock {
  flex-shrink: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--kira-bg);
  border-top: var(--kira-border-width) solid var(--kira-border);
}
</style>
