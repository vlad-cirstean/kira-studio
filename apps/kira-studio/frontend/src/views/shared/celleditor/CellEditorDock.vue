<script setup lang="ts">
import { SplitterPanel } from 'reka-ui';
import { computed } from 'vue';
import { useCellSelectionStore } from '../../../state/cellSelection';
import { useLayoutStore } from '../../../state/layout';
import CellEditorView from './CellEditorView.vue';

const cellSelectionStore = useCellSelectionStore();
const layoutStore = useLayoutStore();

// Mounted by the view that owns the tab (P26 D1), so one dock <-> one tab, torn down with it.
// `readOnly` (P40 D11): true when the mounting view has no write path for its cells at all (the
// query console) — a viewer, not an editor that happens to be refusing this particular cell.
// Distinct from a cell being individually uneditable (a read-only connection, a truncated value),
// which stays governed by CellEditorView's own readOnlyReasonFor regardless of this flag.
const props = withDefaults(defineProps<{ tabId: string; readOnly?: boolean }>(), {
  readOnly: false,
});

const cell = computed(() => cellSelectionStore.selectedCellFor(props.tabId));
</script>

<template>
  <!-- P104: a plain content panel — the drag handle (SplitterResizeHandle) that used to be this
       component's own first template child now lives in each mounting view's own SplitterGroup,
       since a resize handle must be reka's direct child alongside the panel it sits next to
       (SplitterPanel.vue's own `order` doc: "required for groups with conditionally rendered
       panels" — every mounting view gates that handle on the same `cell` condition this panel's
       own `v-if` uses). Still owns its own size/min/max/resize wiring (layoutStore), so there is
       exactly one place that reads/writes the cell-editor height, not one per mounting view. -->
  <SplitterPanel
    v-if="cell"
    class="cell-dock"
    data-testid="cell-editor"
    :data-tab-id="tabId"
    size-unit="px"
    :default-size="layoutStore.panel.cellEditor.height"
    :min-size="120"
    :max-size="480"
    :order="2"
    @resize="layoutStore.setCellEditorHeight"
  >
    <CellEditorView :cell="cell" :read-only="readOnly" />
  </SplitterPanel>
</template>

<style scoped>
@reference "@theme/base.css";

.cell-dock {
  @apply min-h-0 overflow-hidden bg-bg;
}
</style>
