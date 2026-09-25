<script setup lang="ts">
import type { ForeignKeyMeta } from '@shared/domain/tree';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Badge } from '@theme/components/ui/badge';
import { Button } from '@theme/components/ui/button';
import { onClickOutside, useEventListener } from '@vueuse/core';
import { computeFloatPosition, pointReference } from '@workbench/util/floatingPosition';
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { control } from '../../bridge/control';
import { typeClassColor } from '../../theme/icons';
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

// P105 §5.2(b): the backdrop itself has no interactive role — VueUse's onClickOutside on the
// panel replaces both the backdrop's own click handler and the panel's @click.stop that used to
// keep an inside click from reaching it.
onClickOutside(panelEl, () => emit('close'));

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

// PopoverPanel.vue's own precedent: useEventListener disposes itself on unmount.
useEventListener(document, 'keydown', onKeydown, true);

onMounted(() => {
  void position();
  void load();
});

onUnmounted(() => {
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
  <div class="fk-preview-backdrop" data-testid="fk-preview-backdrop">
    <div ref="panelEl" class="fk-preview bg-elevated border border-border-strong rounded-kira shadow-kira-dialog overflow-hidden" data-testid="fk-preview" :style="style">
      <div class="fk-preview-header">
        <span class="fk-preview-title">{{ tableLabel }}</span>
        <Badge
          v-if="state.status === 'ready' && state.hasMore"
          variant="info"
          data-testid="fk-preview-more"
        >
          {{ state.rows.length }} of many matching rows
        </Badge>
      </div>

      <div class="fk-preview-actions">
        <Button variant="toolbar" size="kira" data-testid="fk-preview-open" @click="onOpenClick">
          <CodiconIcon name="arrow-right" :size="13" />
          Open in new tab
        </Button>
      </div>

      <div class="fk-preview-body">
        <div v-if="state.status === 'loading'" class="fk-preview-loading">
          <CodiconIcon name="loading" class="animate-spin" :size="14" />
        </div>
        <Badge v-else-if="state.status === 'error'" variant="err">{{ state.message }}</Badge>
        <Alert v-else-if="state.status === 'ready' && state.rows.length === 0" variant="note" data-testid="fk-preview-empty">
          <AlertDescription>No matching row in {{ tableLabel }}</AlertDescription>
        </Alert>
        <table v-else-if="state.status === 'ready'" class="fk-preview-table">
          <tbody>
            <tr v-for="(col, i) in state.columns" :key="col.name">
              <th :style="{ color: typeClassColor(col.typeClass) }">
                {{ col.name }}
                <span v-if="col.isPrimaryKey" class="header-key">PK</span>
                <span v-if="col.isTarget" class="header-key is-fk">FK</span>
              </th>
              <td>
                <Badge
                  v-if="state.rows[0]?.values[i]?.isNull"
                  variant="info"
                  data-testid="fk-preview-null"
                  >NULL</Badge
                >
                <span v-else>{{ state.rows[0]?.values[i]?.text }}</span>
                <Badge v-if="state.rows[0]?.values[i]?.truncated" variant="warn">truncated</Badge>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

.fk-preview-backdrop {
  @apply fixed inset-0 z-[var(--kira-z-popover)];
}

.fk-preview {
  @apply fixed w-80 flex flex-col max-h-[var(--kira-float-max-h,none)] max-w-[var(--kira-float-max-w,none)];
}

.fk-preview-header {
  @apply flex items-center justify-between border-b border-border-strong flex-none gap-1 p-1.5;
}

.fk-preview-title {
  @apply font-semibold overflow-hidden text-ellipsis whitespace-nowrap;
}

.fk-preview-body {
  /* Load-bearing: without this a flex child refuses to shrink below its content height, and the
     panel overflows its own max-height instead of scrolling here. */
  @apply flex-1 min-h-0 overflow-y-auto p-1.5;
}

.fk-preview-loading {
  @apply flex items-center justify-center h-10 text-muted-foreground;
}

/* P110 B37: .spin/@keyframes fk-preview-spin deleted -- Tailwind's own animate-spin (1s linear
   infinite, rotate 0->360) is byte-identical, confirmed via compile check. */

.fk-preview-table {
  @apply w-full border-collapse text-kira-sm;
}
.fk-preview-table th {
  @apply text-left font-medium text-muted-foreground whitespace-nowrap align-top py-0.5 pl-0 pr-1;
}
.fk-preview-table td {
  @apply break-words py-0.5;
}

/* .header-key/.header-key.is-fk: no rule here — this popover is always rendered inside
   SlickGridHost's own `.slick-grid-host` root (§4.3), so slickTheme.css's own
   `.slick-grid-host .header-key` rule already applies (the "same header-key style" §4.2 asks
   for), unscoped CSS reaching into any descendant regardless of which component rendered it. */

.fk-preview-actions {
  @apply flex border-b border-border-strong flex-none gap-1 p-1.5;
}
</style>
