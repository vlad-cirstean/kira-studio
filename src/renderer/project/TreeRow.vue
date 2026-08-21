<script setup lang="ts">
import type { ConnectionColor } from '@shared/connection';
import { computed } from 'vue';
import Codicon from '../theme/Codicon.vue';
import { openContextMenu } from '../workbench/state/contextMenu';
import { iconForColumn, iconForKind } from './icons';
import { treeRowMenu } from './menus';
import { connectionsState } from './state/connections';
import { key, searchQuery, type TreeRowVm, toggle, treeState } from './state/tree';

const props = defineProps<{ row: TreeRowVm }>();

const k = computed(() => key(props.row.connectionId, props.row.node.path));
const expanded = computed(() => treeState.expanded.has(k.value));
const loading = computed(() => treeState.loading.has(k.value));
const isConnection = computed(() => props.row.node.kind === 'connection');
const isColumn = computed(() => props.row.node.kind === 'column');

const color = computed<ConnectionColor | null>(() => {
  if (!isConnection.value) return null;
  return connectionsState.records.find((r) => r.id === props.row.connectionId)?.color ?? 'grey';
});

const state = computed(() =>
  isConnection.value
    ? (connectionsState.states[props.row.connectionId]?.status ?? 'disconnected')
    : null,
);

const statusColor = computed(() => {
  switch (state.value) {
    case 'connected':
      return 'var(--kira-ok)';
    case 'connecting':
      return 'var(--kira-warn)';
    case 'error':
      return 'var(--kira-error)';
    default:
      return 'var(--kira-fg-disabled)';
  }
});

const statusTitle = computed(() => {
  if (!isConnection.value) return undefined;
  const s = connectionsState.states[props.row.connectionId];
  if (!s) return undefined;
  return s.error ?? s.serverVersion ?? undefined;
});

const icon = computed(() =>
  isColumn.value ? iconForColumn(props.row.node.detail ?? '') : iconForKind(props.row.node.kind),
);

const labelSegments = computed(() => {
  const search = searchQuery.value;
  const name = props.row.node.name;
  if (!search) return [{ text: name, match: false }];
  const idx = name.toLowerCase().indexOf(search);
  if (idx === -1) return [{ text: name, match: false }];
  return [
    { text: name.slice(0, idx), match: false },
    { text: name.slice(idx, idx + search.length), match: true },
    { text: name.slice(idx + search.length), match: false },
  ];
});

function select(): void {
  treeState.selected = k.value;
}

function onTwisty(): void {
  void toggle(props.row.connectionId, props.row.node.path);
}

function onDblClick(): void {
  if (props.row.node.hasChildren) onTwisty();
}

function onContextMenu(e: MouseEvent): void {
  openContextMenu(e, treeRowMenu(props.row));
}
</script>

<template>
  <div
    class="tree-row"
    :style="{
      height: 'var(--kira-row-height)',
      paddingLeft: `${8 + row.depth * 14}px`,
    }"
    data-testid="tree-row"
    :data-path="row.node.path"
    :data-kind="row.node.kind"
    :data-status="state ?? undefined"
    :class="{ selected: treeState.selected === k }"
    @click="select"
    @dblclick="onDblClick"
    @contextmenu.prevent.stop="onContextMenu"
  >
    <span v-if="color" class="rail" :style="{ background: `var(--kira-conn-${color})` }" />

    <button
      v-if="row.node.hasChildren"
      type="button"
      class="twisty"
      :aria-expanded="expanded"
      @click.stop="onTwisty"
    >
      <Codicon v-if="loading" name="loading" :size="14" class="spin" />
      <Codicon v-else :name="expanded ? 'chevron-down' : 'chevron-right'" :size="14" />
    </button>
    <span v-else class="twisty-spacer" />

    <span
      v-if="isConnection"
      class="dot"
      :class="{ pulse: state === 'connecting' }"
      :style="{ background: statusColor }"
      :title="statusTitle"
    />

    <Codicon :name="icon" :size="14" class="node-icon" />

    <span class="label" :title="row.node.name">
      <template v-for="(seg, i) in labelSegments" :key="i">
        <span v-if="seg.match" class="highlight">{{ seg.text }}</span>
        <template v-else>{{ seg.text }}</template>
      </template>
    </span>

    <span v-if="row.node.badges?.length" class="badges">
      <span v-for="badge in row.node.badges" :key="badge" class="badge">{{ badge }}</span>
    </span>

    <span v-if="row.node.detail" class="detail">{{ row.node.detail }}</span>
  </div>
</template>

<style scoped>
.tree-row {
  display: flex;
  align-items: center;
  gap: 4px;
  position: relative;
  padding-right: 6px;
  cursor: default;
  white-space: nowrap;
  font-size: 12px;
}

.tree-row:hover {
  background: var(--kira-hover);
}

.tree-row.selected {
  background: var(--kira-select);
}

.rail {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
}

.twisty {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--kira-fg-muted);
  cursor: pointer;
}

.twisty-spacer {
  width: 14px;
  flex-shrink: 0;
}

.spin {
  animation: kira-spin 1s linear infinite;
}

@keyframes kira-spin {
  to {
    transform: rotate(360deg);
  }
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dot.pulse {
  animation: kira-pulse 1.2s ease-in-out infinite;
}

@keyframes kira-pulse {
  50% {
    opacity: 0.4;
  }
}

.node-icon {
  color: var(--kira-fg-muted);
  flex-shrink: 0;
}

.label {
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.highlight {
  background: var(--kira-select);
  color: var(--kira-fg);
  border-radius: 2px;
}

.badges {
  display: flex;
  gap: 3px;
  flex-shrink: 0;
}

.badge {
  background: var(--kira-badge);
  color: var(--kira-fg);
  border-radius: 3px;
  padding: 0 4px;
  font-size: 10px;
  line-height: 14px;
}

.detail {
  margin-left: auto;
  color: var(--kira-fg-muted);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 1;
}
</style>
