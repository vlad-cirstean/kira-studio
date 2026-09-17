<script setup lang="ts">
import type { ForeignKeyMeta } from '@shared/domain/tree';
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { control } from '../../bridge/control';
import CodiconIcon from '../../theme/CodiconIcon.vue';
import { computeFloatPosition, pointReference } from '../../theme/floatingPosition';
import { typeClassColor } from '../../theme/icons';
import AppButton from '../../theme/primitives/AppButton.vue';
import { type FkPreviewState, fetchReferencedRow, type PreviewSignal } from './fkPreview';
import { type FkNavContext, foreignKeyValueFilter, qualifiedNameForPath } from './menu';

// P67 §4.3: anchored the same way ContextMenu.vue's own top-level menu is — a virtual point
// reference (theme/floatingPosition.ts's pointReference), NOT the nav button element. §1.1: that
// button is imperative DOM, destroyed by SlickGrid's own `invalidateRow` on the next scroll frame,
// so a detached reference is exactly what this component would hold if it anchored to it instead.
//
// Not PopoverPanel.vue: every one of its consumers renders as a DOM sibling of its own trigger
// (its `reposition()` reads `backdropEl.value?.parentElement`) — the nav button has no such Vue
// parent to render a sibling into. §4.3's own "why not extend PopoverPanel" note explains why that
// chain is not widened for this one caller; the ~40 lines of backdrop/Escape chrome below are
// ContextMenu.vue's own duplication, deliberately, for the same reason.
const props = defineProps<{
  /** The click point, in viewport coordinates — pointReference's own input. */
  x: number;
  y: number;
  entry: ForeignKeyMeta;
  ctx: FkNavContext;
  /** Attribution only (fkPreview.ts's own fetchReferencedRow) — never the target's tab id. */
  sourceTabId: string;
  /** SlickGridHost's own resolved nav MenuItem.run for this edge — "Open in new tab" is that
   *  exact click behaviour (navigateForeignKey), unchanged, one click further in (§2 item 3). Not
   *  called directly from here so navigateForeignKey itself stays untouched (§10.3's checklist). */
  openInNewTab: () => void;
}>();

const emit = defineEmits<{ close: [] }>();

const panelEl = ref<HTMLElement | null>(null);
const style = ref({ left: '0px', top: '0px' });
const state = ref<FkPreviewState>({ status: 'loading' });
const signal: PreviewSignal = { cancelled: false, opId: null };

const tableLabel = qualifiedNameForPath(props.ctx.connectionId, props.entry.referencedPath);

async function position(): Promise<void> {
  await nextTick();
  const el = panelEl.value;
  if (!el) return;
  const { left, top } = await computeFloatPosition(pointReference(props.x, props.y), el, {
    offset: 6,
    // flip stays at its own default (true), unlike ContextMenu.vue: this is a panel, not a menu —
    // "above the point" is a real, useful placement for a row near the bottom of the viewport, and
    // ContextMenu's own reason for disabling it ("a point has no other side to flip to") is a menu
    // convention, not a constraint pointReference itself imposes (§4.3).
  });
  style.value = { left: `${left}px`, top: `${top}px` };
}

async function load(): Promise<void> {
  const filter = foreignKeyValueFilter(
    props.ctx.dialect,
    props.entry.columns,
    props.entry.referencedColumns,
    props.ctx.rowValues,
  );
  // Defensive only: the caller (SlickGridHost's onGridClick) never opens this popover for an edge
  // whose filter can't be built (cellNavEntry already filters those out) — this can't happen on a
  // real click, but a filter-less fetch would be meaningless if it somehow did.
  if (filter === null) {
    state.value = { status: 'error', message: 'no value to filter on' };
    return;
  }
  state.value = { status: 'loading' };
  const result = await fetchReferencedRow(
    props.ctx.connectionId,
    props.sourceTabId,
    props.entry,
    filter,
    signal,
  );
  if (signal.cancelled) return;
  state.value = result;
}

// The loading state renders one fixed-height spinner row (§4.2) so the very first paint doesn't
// jump; once real content lands (a row, an error, "no matching row") the panel's height changes
// with it, so it's repositioned again here rather than staying wherever the loading-sized panel
// first landed.
watch(state, () => void position());

function onBackdropClick(): void {
  emit('close');
}

function onKeydown(e: KeyboardEvent): void {
  // Capture phase, not bubble — PopoverPanel.vue's own onKeydown carries the identical reasoning:
  // the grid root has its own keydown handler, and this popover owns Escape while it's open.
  if (e.key === 'Escape') {
    e.stopPropagation();
    emit('close');
  }
}

function onOpenClick(): void {
  emit('close');
  props.openInNewTab();
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown, true);
  void position();
  void load();
});

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown, true);
  // Belt and braces (§4.1): cancel is best-effort server-side, and `signal.cancelled` alone
  // already drops a response that lands after this — cancelling too costs nothing when the read
  // has already finished.
  if (signal.opId && state.value.status === 'loading') {
    signal.cancelled = true;
    void control.opsCancel(signal.opId);
  }
});
</script>

<template>
  <div class="fk-preview-backdrop" data-testid="fk-preview-backdrop" @click="onBackdropClick">
    <div
      ref="panelEl"
      class="fk-preview p-float"
      data-testid="fk-preview"
      :style="style"
      @click.stop
    >
      <div class="fk-preview-header">
        <span class="fk-preview-title">{{ tableLabel }}</span>
        <span
          v-if="state.status === 'ready' && state.hasMore"
          class="p-chip info"
          data-testid="fk-preview-more"
        >
          {{ state.rows.length }} of many matching rows
        </span>
      </div>

      <div class="fk-preview-actions">
        <AppButton data-testid="fk-preview-open" icon="arrow-right" @click="onOpenClick">
          Open in new tab
        </AppButton>
      </div>

      <div class="fk-preview-body">
        <div v-if="state.status === 'loading'" class="fk-preview-loading">
          <CodiconIcon name="loading" class="spin" :size="14" />
        </div>
        <div v-else-if="state.status === 'error'" class="p-chip err">{{ state.message }}</div>
        <div
          v-else-if="state.status === 'ready' && state.rows.length === 0"
          class="p-strip note"
          data-testid="fk-preview-empty"
        >
          No matching row in {{ tableLabel }}
        </div>
        <table v-else-if="state.status === 'ready'" class="fk-preview-table">
          <tbody>
            <tr v-for="(col, i) in state.columns" :key="col.name">
              <th :style="{ color: typeClassColor(col.typeClass) }">
                {{ col.name }}
                <span v-if="col.isPrimaryKey" class="header-key">PK</span>
                <span v-if="col.isTarget" class="header-key is-fk">FK</span>
              </th>
              <td>
                <span
                  v-if="state.rows[0]?.values[i]?.isNull"
                  class="p-chip info"
                  data-testid="fk-preview-null"
                  >NULL</span
                >
                <span v-else>{{ state.rows[0]?.values[i]?.text }}</span>
                <span v-if="state.rows[0]?.values[i]?.truncated" class="p-chip warn">truncated</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fk-preview-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--kira-z-popover);
}

.fk-preview {
  position: fixed;
  width: 320px;
  max-height: var(--kira-float-max-h, none);
  max-width: var(--kira-float-max-w, none);
  display: flex;
  flex-direction: column;
}

.fk-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--kira-s-2);
  padding: var(--kira-s-3);
  border-bottom: var(--kira-border-width) solid var(--kira-border-strong);
  flex: 0 0 auto;
}

.fk-preview-title {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fk-preview-body {
  padding: var(--kira-s-3);
  flex: 1 1 auto;
  /* Load-bearing: without this a flex child refuses to shrink below its content height, and the
     panel overflows its own max-height instead of scrolling here. */
  min-height: 0;
  overflow-y: auto;
}

.fk-preview-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 40px;
  color: var(--kira-fg-muted);
}

.spin {
  animation: fk-preview-spin 1s linear infinite;
}
@keyframes fk-preview-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.fk-preview-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--kira-t-sm);
}
.fk-preview-table th {
  text-align: left;
  font-weight: 500;
  color: var(--kira-fg-muted);
  padding: var(--kira-s-1) var(--kira-s-2) var(--kira-s-1) 0;
  white-space: nowrap;
  vertical-align: top;
}
.fk-preview-table td {
  padding: var(--kira-s-1) 0;
  word-break: break-word;
}

/* .header-key/.header-key.is-fk: no rule here — this popover is always rendered inside
   SlickGridHost's own `.slick-grid-host` root (§4.3), so slickTheme.css's own
   `.slick-grid-host .header-key` rule already applies (the "same header-key style" §4.2 asks
   for), unscoped CSS reaching into any descendant regardless of which component rendered it. */

.fk-preview-actions {
  display: flex;
  gap: var(--kira-s-2);
  padding: var(--kira-s-3);
  border-bottom: var(--kira-border-width) solid var(--kira-border-strong);
  flex: 0 0 auto;
}
</style>
