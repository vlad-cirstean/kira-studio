<script setup lang="ts">
import { computed } from 'vue';
import Codicon from '../theme/Codicon.vue';
import ErrorPopover from './ErrorPopover.vue';
import { columnTypeIcon, nodeIcon } from './icons';
import type { TreeRowVm } from './state/tree';

const props = defineProps<{ row: TreeRowVm; selected: boolean }>();
const emit = defineEmits<{
  select: [row: TreeRowVm];
  toggle: [row: TreeRowVm];
  open: [row: TreeRowVm];
  contextmenu: [row: TreeRowVm, event: MouseEvent];
}>();

const icon = computed(() => {
  if (props.row.kind === 'column' && props.row.detail) return columnTypeIcon(props.row.detail);
  return nodeIcon(props.row.kind === 'connection' ? 'connection' : props.row.kind);
});

const statusTitle = computed(() => {
  if (props.row.kind !== 'connection') return undefined;
  return props.row.statusDetail ?? undefined;
});

function highlightParts(): { text: string; hit: boolean }[] {
  if (!props.row.matched) return [{ text: props.row.name, hit: false }];
  const query = props.row.matched ? props.row.name : '';
  return [{ text: query, hit: true }];
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
    data-testid="tree-row"
    :data-path="row.path"
    :data-kind="row.kind"
    :data-status="row.kind === 'connection' ? row.status : undefined"
    @click="onClick"
    @dblclick="onDblClick"
    @contextmenu.prevent.stop="onContextMenu"
  >
    <div v-if="row.depth === 0" class="color-rail" :style="{ background: `var(--kira-conn-${row.color})` }" />

    <button
      type="button"
      class="twisty"
      :class="{ invisible: !row.hasChildren }"
      tabindex="-1"
      @click="onTwistyClick"
    >
      <Codicon v-if="row.loading" name="loading" class="spin" :size="12" />
      <Codicon v-else :name="row.expanded ? 'chevron-down' : 'chevron-right'" :size="12" />
    </button>

    <span v-if="row.kind === 'connection'" class="status-dot" :data-status="row.status" :title="statusTitle" />

    <Codicon :name="icon" :size="14" class="node-icon" />

    <span class="label" :title="row.name">
      <template v-for="(part, i) in parts" :key="i">
        <mark v-if="part.hit">{{ part.text }}</mark>
        <template v-else>{{ part.text }}</template>
      </template>
    </span>

    <span v-if="row.badges?.length" class="badges">
      <span v-for="badge in row.badges" :key="badge" class="badge">{{ badge }}</span>
    </span>

    <ErrorPopover v-if="row.error" :message="row.error" />
    <span v-else-if="row.detail" class="detail">{{ row.detail }}</span>
  </div>
</template>

<style scoped>
.tree-row {
  height: var(--kira-row-height);
  display: flex;
  align-items: center;
  gap: 4px;
  padding-right: 8px;
  position: relative;
  cursor: default;
  white-space: nowrap;
  font-size: 12px;
  user-select: none;
}

.tree-row:hover {
  background: var(--kira-hover);
}

.tree-row.selected {
  background: var(--kira-select);
}

.color-rail {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
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
  background: var(--kira-focus);
  color: var(--kira-accent-fg);
  border-radius: 2px;
}

.badges {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.badge {
  font-size: 9px;
  line-height: 1.4;
  padding: 0 4px;
  border-radius: 3px;
  background: var(--kira-badge);
  color: var(--kira-fg);
}

.detail {
  margin-left: auto;
  flex-shrink: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--kira-fg-muted);
  font-size: 11px;
}

</style>
