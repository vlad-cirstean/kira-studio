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
  return connectionsState.records.find((r) => r.id === props.row.connectionId)?.color ?? null;
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
    class="relative flex cursor-default items-center gap-1 whitespace-nowrap text-xs hover:bg-hover"
    :class="{ selected: treeState.selected === k }"
    :style="{
      height: 'var(--kira-row-height)',
      paddingLeft: `${8 + row.depth * 14}px`,
    }"
    data-testid="tree-row"
    :data-path="row.node.path"
    :data-kind="row.node.kind"
    :data-status="state ?? undefined"
    @click="select"
    @dblclick="onDblClick"
    @contextmenu.prevent.stop="onContextMenu"
  >
    <span
      v-if="color"
      class="absolute left-0 top-[3px] bottom-[3px] w-[2px] rounded-sm opacity-85"
      :style="{ background: `var(--kira-conn-${color})` }"
    />

    <button
      v-if="row.node.hasChildren"
      type="button"
      class="flex h-[14px] w-[14px] shrink-0 items-center justify-center text-muted"
      :aria-expanded="expanded"
      @click.stop="onTwisty"
    >
      <Codicon v-if="loading" name="loading" :size="13" class="spin" />
      <Codicon v-else :name="expanded ? 'chevron-down' : 'chevron-right'" :size="13" />
    </button>
    <span v-else class="w-[14px] shrink-0" />

    <span
      v-if="isConnection"
      class="h-1.5 w-1.5 shrink-0 rounded-full"
      :class="{ pulse: state === 'connecting' }"
      :style="{ background: statusColor }"
      :title="statusTitle"
    />

    <Codicon :name="icon" :size="14" class="shrink-0 text-muted" />

    <span class="min-w-0 flex-1 truncate" :title="row.node.name">
      <template v-for="(seg, i) in labelSegments" :key="i">
        <mark v-if="seg.match" class="rounded-sm bg-conn-amber/40 px-0.5 text-inherit">{{
          seg.text
        }}</mark>
        <template v-else>{{ seg.text }}</template>
      </template>
    </span>

    <span v-if="row.node.badges?.length" class="flex shrink-0 gap-0.5">
      <span
        v-for="badge in row.node.badges"
        :key="badge"
        class="rounded-sm bg-badge px-1.5 py-px text-[10px] leading-[14px] text-fg"
        >{{ badge }}</span
      >
    </span>

    <span
      v-if="isConnection && state === 'connected'"
      class="h-1.5 w-1.5 shrink-0 rounded-full"
      :style="{ background: 'var(--kira-ok)', boxShadow: '0 0 4px var(--kira-ok)' }"
    />

    <span
      v-if="row.node.detail"
      class="ml-auto shrink-0 text-[10px] text-disabled"
      :title="row.node.detail"
      >{{ row.node.detail }}</span
    >
  </div>
</template>

<style scoped>
.selected {
  background: var(--kira-select);
}

.selected:hover {
  background: var(--kira-select);
}

.spin {
  animation: kira-spin 1s linear infinite;
}

@keyframes kira-spin {
  to {
    transform: rotate(360deg);
  }
}

.pulse {
  animation: kira-pulse 1.2s ease-in-out infinite;
}

@keyframes kira-pulse {
  50% {
    opacity: 0.4;
  }
}
</style>
