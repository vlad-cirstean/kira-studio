<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { connColorVar } from '@theme/connColor';
import { computed } from 'vue';
import { useConnectionsStore } from '../state/connections';
import EngineIcon from '../theme/EngineIcon.vue';
import { columnTypeIcon, nodeIcon } from '../theme/icons';
import ErrorPopover from './ErrorPopover.vue';
import { type TreeRowVm, useTreeStore } from './state/tree';

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

const connectionsStore = useConnectionsStore();
const treeStore = useTreeStore();

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
const railColor = computed(() => connectionsStore.connectionRecord(props.row.connectionId)?.color);

// The connection row's own kind ("postgres", "mongodb", ...), shown as a badge
// instead of a second icon — the state dot already occupies the icon-box slot.
const connectionKind = computed(() => {
  if (props.row.kind !== 'connection') return undefined;
  return connectionsStore.connectionRecord(props.row.connectionId)?.kind;
});

// Splits row.name on every case-insensitive occurrence of the live search query so only the
// matched substring(s) get <mark>-ed, not the whole label.
function highlightParts(): { text: string; hit: boolean }[] {
  const query = treeStore.activeSearchQuery;
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

// P105 §5.2(c): the container's own onTreeKeydown (ProjectPanel.vue) already claims Enter for
// the row's primary action (the same one dblclick fires) — Space mirrors a single click instead,
// a genuine non-conflicting keyboard equivalent, not a no-op stand-in.
function onKeydown(e: KeyboardEvent): void {
  if (e.key === ' ') {
    e.preventDefault();
    onClick();
  }
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
    role="treeitem"
    :aria-level="row.depth + 1"
    :aria-expanded="row.hasChildren ? row.expanded : undefined"
    :aria-selected="selected"
    :tabindex="sticky ? -1 : selected ? 0 : -1"
    @click="onClick"
    @dblclick="onDblClick"
    @keydown="onKeydown"
    @contextmenu.prevent.stop="onContextMenu"
  >
    <div class="p-tree-rail" :style="{ '--kira-rail': connColorVar(railColor) }" />

    <!-- P31 D25/F25: the twisty is the one control in the app whose entire meaning is already
         drawn by the chevron direction, and it fires on the single most-hovered control in the
         panel — no tooltip. :aria-label stays: P104 §6.2 made every icon-only control set its
         own explicit aria-label by hand (no more directive mirroring it in automatically), so
         dropping it here would leave this button nameless. -->
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
      <Tooltip :disabled="!statusTitle">
        <TooltipTrigger as-child>
          <span class="status-dot" :data-status="row.status" />
        </TooltipTrigger>
        <TooltipContent v-if="statusTitle">{{ statusTitle }}</TooltipContent>
      </Tooltip>
    </span>
    <span v-if="connectionKind" class="icon-box">
      <EngineIcon :kind="connectionKind" :size="13" />
    </span>
    <CodiconIcon v-else-if="row.kind !== 'connection'" :name="icon" :size="13" class="node-icon" />

    <Tooltip>
      <TooltipTrigger as-child>
        <span class="label">
          <template v-for="(part, i) in parts" :key="i">
            <mark v-if="part.hit">{{ part.text }}</mark>
            <template v-else>{{ part.text }}</template>
          </template>
        </span>
      </TooltipTrigger>
      <TooltipContent>{{ row.name }}</TooltipContent>
    </Tooltip>

    <span v-if="row.badges?.length" class="badges">
      <span v-for="badge in row.badges" :key="badge" class="p-count">{{ badge }}</span>
    </span>

    <ErrorPopover v-if="row.error" :message="row.error" />
    <!-- P24: a connect failure has no separate `row.error`/ErrorPopover of its own (tree.ts's
         `error` field is a post-connect children-fetch failure only, never set when connect()
         itself fails) — previously the reason lived nowhere but the status dot's own tooltip
         (a 8px hit target), with no visible text at all. Truncated-with-hover-detail, matching
         OperationsPanel.vue's own `error-text`/`Tooltip` pattern for the same "errors are
         truncated by default, full text on hover" shape. -->
    <Tooltip v-else-if="row.kind === 'connection' && row.status === 'error' && row.statusDetail">
      <TooltipTrigger as-child>
        <span class="detail error-text" data-testid="connection-error-detail">{{ row.statusDetail }}</span>
      </TooltipTrigger>
      <TooltipContent>{{ row.statusDetail }}</TooltipContent>
    </Tooltip>
    <span v-else-if="row.detail" class="detail">{{ row.detail }}</span>
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

.tree-row {
  @apply flex items-center relative cursor-default whitespace-nowrap select-none;
  height: var(--kira-row-height);
  gap: var(--kira-s-2);
  padding-right: var(--kira-s-4);
  font-size: var(--kira-t-md);
}

.tree-row:hover {
  background: var(--kira-hover);
}

.tree-row.selected {
  background: var(--kira-select);
}

.twisty {
  @apply shrink-0 w-3.5 h-3.5 flex items-center justify-center bg-transparent border-none p-0 cursor-pointer;
  color: var(--kira-fg-muted);
}

.twisty.invisible {
  @apply invisible;
}

/* Selected directly by tests/ui/tree.spec.ts's own `.twisty .spin` locator — class name kept,
   body reuses Tailwind's built-in spin animation. */
.spin {
  @apply animate-spin;
}

.status-dot {
  @apply shrink-0 w-2 h-2 rounded-full;
  background: var(--kira-fg-disabled);
}

.status-dot[data-status='connected'] {
  background: var(--kira-ok);
}

.status-dot[data-status='connecting'] {
  background: var(--kira-warn);
  animation: tree-row-pulse 1s ease-in-out infinite;
}

.status-dot[data-status='error'] {
  background: var(--kira-error);
}

/* Tailwind's built-in animate-pulse is 2s cubic-bezier, opacity 1→0.5 — this dot's own 1s
   ease-in-out, opacity 1→0.35 doesn't match either value, so the keyframes stay hand-written. */
@keyframes tree-row-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.35;
  }
}

.node-icon {
  @apply shrink-0;
  color: var(--kira-fg-muted);
}

.label {
  @apply overflow-hidden text-ellipsis min-w-0;
}

.label mark {
  /* Same yellow search-match tint as DataGrid.vue/StreamView.vue/etc. (D21) — one highlight
     color for every search-capable view in the app. */
  @apply rounded-sm;
  background: var(--kira-search-match);
  color: inherit;
}

.badges {
  @apply flex gap-0.5 shrink-0;
}

.detail {
  @apply ml-auto shrink min-w-0 overflow-hidden text-ellipsis;
  color: var(--kira-fg-muted);
  font-size: var(--kira-t-sm);
}

.error-text {
  color: var(--kira-error);
}
</style>
