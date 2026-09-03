<script setup lang="ts">
import { computed } from 'vue';
import { connectionRecord } from '../state/connections';
import CodiconIcon from '../theme/CodiconIcon.vue';
import { connColorVar } from '../theme/connColor';
import EngineIcon from '../theme/EngineIcon.vue';
import { columnTypeIcon, nodeIcon } from '../theme/icons';
import ErrorPopover from './ErrorPopover.vue';
import type { TreeRowVm } from './state/tree';
import { activeSearchQuery } from './state/tree';

// P28 D7: `sticky` is the only difference between a normal row and a band-pinned one — a
// different testid (so it can never double-count a `tree-row` locator) and a forced -1 tabindex
// (so the tree keeps its single roving tab stop). Every emit, every child element, the colour
// rail and the twisty behave identically either way — a pinned row is a real row, not a decoration.
const props = withDefaults(defineProps<{ row: TreeRowVm; selected: boolean; sticky?: boolean }>(), {
  sticky: false,
});
const emit = defineEmits<{
  select: [row: TreeRowVm];
  toggle: [row: TreeRowVm];
  open: [row: TreeRowVm];
  contextmenu: [row: TreeRowVm, event: MouseEvent];
}>();

const icon = computed(() => {
  // P19: a group folder's icon reflects its own expand state, unlike every other kind.
  if (props.row.kind === 'group') return props.row.expanded ? 'folder-opened' : 'folder';
  if (props.row.kind === 'column' && props.row.detail) return columnTypeIcon(props.row.detail);
  return nodeIcon(props.row.kind === 'connection' ? 'connection' : props.row.kind);
});

const statusTitle = computed(() => {
  if (props.row.kind !== 'connection') return undefined;
  return props.row.statusDetail ?? undefined;
});

// P16 design system LAW: the connection colour is a 2px rail running the length
// of the connection's whole group in the tree, not a badge on one row — so it
// is looked up per-row from the connection record (row.color is only ever set
// on the connection row itself) and drawn at every depth.
const railColor = computed(() => connectionRecord(props.row.connectionId)?.color);

// The connection row's own kind ("postgres", "mongodb", ...), shown as a badge
// instead of a second icon — the state dot already occupies the icon-box slot.
const connectionKind = computed(() => {
  if (props.row.kind !== 'connection') return undefined;
  return connectionRecord(props.row.connectionId)?.kind;
});

// Splits row.name on every case-insensitive occurrence of the live search query so only the
// matched substring(s) get <mark>-ed, not the whole label.
function highlightParts(): { text: string; hit: boolean }[] {
  const query = activeSearchQuery.value;
  if (!props.row.matched || !query) return [{ text: props.row.name, hit: false }];
  const name = props.row.name;
  const lower = name.toLowerCase();
  const parts: { text: string; hit: boolean }[] = [];
  let i = 0;
  while (i < name.length) {
    const idx = lower.indexOf(query, i);
    if (idx === -1) {
      parts.push({ text: name.slice(i), hit: false });
      break;
    }
    if (idx > i) parts.push({ text: name.slice(i, idx), hit: false });
    parts.push({ text: name.slice(idx, idx + query.length), hit: true });
    i = idx + query.length;
  }
  return parts;
}

const parts = computed(highlightParts);

function onClick(): void {
  emit('select', props.row);
}

function onDblClick(): void {
  // Not gated on hasChildren: a redis 'key' leaf (P9) is childless by design (D14) but still
  // needs double-click to open its keyvalue tab. onOpen() itself gates the expand/collapse
  // fallback on hasChildren, so a childless non-openable row (column, index) still no-ops.
  emit('open', props.row);
}

function onTwistyClick(e: MouseEvent): void {
  e.stopPropagation();
  if (props.row.hasChildren) emit('toggle', props.row);
}

function onContextMenu(e: MouseEvent): void {
  emit('contextmenu', props.row, e);
}
</script>

<template>
  <div
    class="tree-row"
    :class="{ selected }"
    :style="{ paddingLeft: `${8 + row.depth * 14}px` }"
    :data-testid="sticky ? 'tree-sticky-row' : 'tree-row'"
    :data-path="row.path"
    :data-kind="row.kind"
    :data-status="row.kind === 'connection' ? row.status : undefined"
    :data-depth="sticky ? row.depth : undefined"
    :tabindex="sticky ? -1 : selected ? 0 : -1"
    @click="onClick"
    @dblclick="onDblClick"
    @contextmenu.prevent.stop="onContextMenu"
  >
    <div class="p-tree-rail" :style="{ '--kira-rail': connColorVar(railColor) }" />

    <!-- P31 D25/F25: the twisty is the one control in the app whose entire meaning is already
         drawn by the chevron direction, and it fires on the single most-hovered control in the
         panel — no v-tooltip. :aria-label stays: the app's tooltip directive mirrors into
         aria-label only when a control has no accessible name otherwise, so dropping both would
         leave this button nameless. -->
    <button
      type="button"
      class="twisty"
      :class="{ invisible: !row.hasChildren }"
      tabindex="-1"
      :aria-label="row.expanded ? 'Collapse' : 'Expand'"
      @click="onTwistyClick"
    >
      <CodiconIcon v-if="row.loading" name="loading" class="spin" :size="13" />
      <CodiconIcon v-else :name="row.expanded ? 'chevron-down' : 'chevron-right'" :size="13" />
    </button>

    <span v-if="row.kind === 'connection'" class="icon-box">
      <span class="status-dot" :data-status="row.status" v-tooltip="statusTitle" />
    </span>
    <span v-if="connectionKind" class="icon-box">
      <EngineIcon :kind="connectionKind" :size="13" />
    </span>
    <CodiconIcon v-else-if="row.kind !== 'connection'" :name="icon" :size="13" class="node-icon" />

    <span class="label" v-tooltip="row.name">
      <template v-for="(part, i) in parts" :key="i">
        <mark v-if="part.hit">{{ part.text }}</mark>
        <template v-else>{{ part.text }}</template>
      </template>
    </span>

    <span v-if="row.badges?.length" class="badges">
      <span v-for="badge in row.badges" :key="badge" class="p-count">{{ badge }}</span>
    </span>

    <ErrorPopover v-if="row.error" :message="row.error" />
    <!-- P24: a connect failure has no separate `row.error`/ErrorPopover of its own (tree.ts's
         `error` field is a post-connect children-fetch failure only, never set when connect()
         itself fails) — previously the reason lived nowhere but the status dot's own v-tooltip
         (a 8px hit target), with no visible text at all. Truncated-with-hover-detail, matching
         OperationsPanel.vue's own `error-text`/`v-tooltip` pattern for the same "errors are
         truncated by default, full text on hover" shape. -->
    <span
      v-else-if="row.kind === 'connection' && row.status === 'error' && row.statusDetail"
      class="detail error-text"
      data-testid="connection-error-detail"
      v-tooltip="row.statusDetail"
      >{{ row.statusDetail }}</span
    >
    <span v-else-if="row.detail" class="detail">{{ row.detail }}</span>
  </div>
</template>

<style scoped>
.tree-row {
  height: var(--kira-row-height);
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
  padding-right: var(--kira-s-4);
  position: relative;
  cursor: default;
  white-space: nowrap;
  font-size: var(--kira-t-md);
  user-select: none;
}

.tree-row:hover {
  background: var(--kira-hover);
}

.tree-row.selected {
  background: var(--kira-select);
}

.twisty {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--kira-fg-muted);
  padding: 0;
  cursor: pointer;
}

.twisty.invisible {
  visibility: hidden;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.status-dot {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--kira-fg-disabled);
}

.status-dot[data-status='connected'] {
  background: var(--kira-ok);
}

.status-dot[data-status='connecting'] {
  background: var(--kira-warn);
  animation: pulse 1s ease-in-out infinite;
}

.status-dot[data-status='error'] {
  background: var(--kira-error);
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

.node-icon {
  flex-shrink: 0;
  color: var(--kira-fg-muted);
}

.label {
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.label mark {
  /* Same yellow search-match tint as DataGrid.vue/StreamView.vue/etc. (D21) — one highlight
     color for every search-capable view in the app. */
  background: var(--kira-search-match);
  color: inherit;
  border-radius: 2px;
}

.badges {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.detail {
  margin-left: auto;
  flex-shrink: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--kira-fg-muted);
  font-size: var(--kira-t-sm);
}

.error-text {
  color: var(--kira-error);
}

</style>
