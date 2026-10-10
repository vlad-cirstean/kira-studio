<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import TreeTwisty from '@workbench/components/TreeTwisty.vue';
import { type MenuItem, useContextMenuStore } from '@workbench/state/contextMenu';
import { copyText } from '@workbench/util/clipboard';
import { computed } from 'vue';
import { isActiveState, publishedPorts, stateDotClass } from '../lib/format';
import { useContainerAction, useContainers } from '../queries';
import { useDockerUiStore } from '../state/dockerUi';
import type { DockerContainer } from '../wire';
import ListState from './ListState.vue';
import OriginIcon from './OriginIcon.vue';
import VirtualList from './VirtualList.vue';

const GROUP_ROW_HEIGHT = 28;
const CONTAINER_ROW_HEIGHT = 44;

interface GroupRow {
  kind: 'group';
  key: string;
  name: string;
  members: DockerContainer[];
}
interface ContainerRow {
  kind: 'container';
  key: string;
  container: DockerContainer;
  grouped: boolean;
}
type Row = GroupRow | ContainerRow;

const ui = useDockerUiStore();
const containers = useContainers();
const actions = useContainerAction();
const contextMenu = useContextMenuStore();

const searching = computed(() => ui.search.trim() !== '');

const visible = computed(() => {
  const q = ui.search.trim().toLowerCase();
  return (containers.data.value ?? []).filter((c) => {
    if (!ui.showStopped && !isActiveState(c.state)) return false;
    if (q === '') return true;
    return [c.name, c.image, c.composeProject, c.composeService].some((v) => v.toLowerCase().includes(q));
  });
});

const rows = computed<Row[]>(() => {
  const byProject = new Map<string, DockerContainer[]>();
  for (const c of visible.value) {
    const list = byProject.get(c.composeProject) ?? [];
    list.push(c);
    byProject.set(c.composeProject, list);
  }
  const byName = (a: DockerContainer, b: DockerContainer) => a.name.localeCompare(b.name);
  const out: Row[] = [];
  const projects = [...byProject.keys()].filter((p) => p !== '').sort((a, b) => a.localeCompare(b));
  for (const project of projects) {
    const members = (byProject.get(project) ?? []).sort(byName);
    out.push({ kind: 'group', key: `g:${project}`, name: project, members });
    if (searching.value || !ui.collapsedGroups.includes(project)) {
      for (const container of members) {
        out.push({ kind: 'container', key: container.id, container, grouped: true });
      }
    }
  }
  for (const container of (byProject.get('') ?? []).sort(byName)) {
    out.push({ kind: 'container', key: container.id, container, grouped: false });
  }
  return out;
});

const rowHeights = computed(() => rows.value.map((r) => (r.kind === 'group' ? GROUP_ROW_HEIGHT : CONTAINER_ROW_HEIGHT)));

const emptyCopy = computed(() => {
  if (searching.value) return { title: 'No matches', hint: 'No container matches the search.' };
  if ((containers.data.value ?? []).length > 0 && !ui.showStopped) {
    return { title: 'No running containers', hint: 'Turn on Show stopped to list exited ones.' };
  }
  return { title: 'No containers', hint: 'Start one with docker run or docker compose up.' };
});

function portLabel(c: DockerContainer): string {
  const ports = publishedPorts(c.ports);
  return ports.length > 1 ? `${ports[0]} +${ports.length - 1}` : (ports[0] ?? '');
}

function isOpen(name: string): boolean {
  return searching.value || !ui.collapsedGroups.includes(name);
}

function isSelected(c: DockerContainer): boolean {
  return ui.selection?.kind === 'container' && ui.selection.id === c.id;
}

function runningCount(g: GroupRow): number {
  return g.members.filter((c) => c.state === 'running').length;
}

function act(c: DockerContainer, action: 'start' | 'stop' | 'restart'): void {
  void actions.run(c.id, action).catch(() => undefined);
}

function groupAction(g: GroupRow, action: 'start' | 'stop'): void {
  const targets = g.members.filter((c) => (action === 'start' ? c.state !== 'running' : isActiveState(c.state)));
  for (const c of targets) act(c, action);
}

function onContextMenu(e: MouseEvent, c: DockerContainer): void {
  const running = c.state === 'running';
  const items: MenuItem[] = [
    { type: 'item', id: 'start', label: 'Start', icon: 'play', disabled: running, run: () => act(c, 'start') },
    { type: 'item', id: 'stop', label: 'Stop', icon: 'debug-stop', disabled: !isActiveState(c.state), run: () => act(c, 'stop') },
    { type: 'item', id: 'restart', label: 'Restart', icon: 'debug-restart', disabled: !running, run: () => act(c, 'restart') },
    { type: 'separator' },
    { type: 'item', id: 'logs', label: 'Logs', icon: 'output', run: () => ui.select({ kind: 'container', id: c.id }, 'logs') },
    { type: 'item', id: 'terminal', label: 'Open terminal', icon: 'terminal', disabled: !running, run: () => ui.select({ kind: 'container', id: c.id }, 'terminal') },
    { type: 'separator' },
    { type: 'item', id: 'copy-id', label: 'Copy ID', icon: 'copy', run: () => copyText(c.id) },
    { type: 'item', id: 'copy-name', label: 'Copy name', icon: 'copy', run: () => copyText(c.name) },
  ];
  contextMenu.openContextMenu(e, items);
}
</script>

<template>
  <ListState
    v-if="containers.isPending.value || containers.isError.value || rows.length === 0"
    :loading="containers.isPending.value"
    :error="containers.isError.value"
    icon="server"
    :empty-title="emptyCopy.title"
    :empty-hint="emptyCopy.hint"
    @retry="containers.refetch()"
  />
  <VirtualList v-else :rows="rows" :row-heights="rowHeights" testid="docker-container-list">
    <template #row="{ row }">
      <div
        v-if="row.kind === 'group'"
        class="group/row flex h-full cursor-default select-none items-center gap-1 px-1.5 hover:bg-hover"
        data-testid="docker-group"
        :data-project="row.name"
      >
        <TreeTwisty :expanded="isOpen(row.name)" :has-children="true" @toggle="ui.toggleGroup(row.name)" />
        <OriginIcon origin="compose" data-testid="docker-group-icon" />
        <button
          type="button"
          class="min-w-0 flex-1 cursor-default overflow-hidden text-ellipsis whitespace-nowrap border-0 bg-transparent p-0 text-left font-semibold text-inherit"
          :aria-expanded="isOpen(row.name)"
          @click="ui.toggleGroup(row.name)"
        >{{ row.name }}</button>
        <span class="text-kira-sm text-muted-foreground group-hover/row:hidden">{{ runningCount(row) }}/{{ row.members.length }}</span>
        <span class="hidden items-center group-hover/row:flex">
          <TooltipIconButton icon="play" label="Start all" data-testid="docker-group-start" @click="groupAction(row, 'start')" />
          <TooltipIconButton icon="debug-stop" label="Stop all" data-testid="docker-group-stop" @click="groupAction(row, 'stop')" />
        </span>
      </div>
      <div
        v-else
        class="group/row grid h-full cursor-default select-none grid-cols-[0.5rem_minmax(0,1fr)_auto_1.25rem] grid-rows-[auto_auto] items-center gap-x-1.5 gap-y-0.5 py-1 pr-1.5 outline-none focus-visible:outline focus-visible:-outline-offset-1 focus-visible:outline-focus"
        :class="[
          row.grouped ? 'pl-5' : 'pl-1.5',
          isSelected(row.container) ? 'bg-select shadow-[inset_2px_0_0_var(--color-focus)]' : 'hover:bg-hover',
        ]"
        data-testid="docker-row"
        :data-id="row.container.id"
        :data-name="row.container.name"
        :data-state="row.container.state"
        role="option"
        :aria-selected="isSelected(row.container)"
        tabindex="0"
        @click="ui.select({ kind: 'container', id: row.container.id })"
        @dblclick="ui.select({ kind: 'container', id: row.container.id }, 'logs')"
        @keydown.enter="ui.select({ kind: 'container', id: row.container.id })"
        @contextmenu.prevent="onContextMenu($event, row.container)"
      >
        <span class="row-span-1 size-1.5 rounded-full" :class="stateDotClass(row.container.state)" data-testid="docker-state-dot" />
        <span class="flex min-w-0 items-center gap-1.5">
          <span
            class="truncate"
            :class="row.container.state === 'running' ? '' : 'text-muted-foreground'"
            data-testid="docker-row-name"
          >{{ row.container.name }}</span>
          <OriginIcon
            v-if="row.container.origin !== '' && !(row.container.origin === 'compose' && row.grouped)"
            :origin="row.container.origin"
            :name="row.container.originName"
          />
        </span>
        <span v-if="row.container.state !== 'running'" class="text-right text-kira-sm text-muted-foreground" data-testid="docker-row-state">{{ row.container.state }}</span>
        <span v-else />
        <span class="row-span-2 flex items-center justify-end">
          <CodiconIcon v-if="actions.isBusy(row.container.id)" name="loading" :size="12" class="codicon-modifier-spin" />
          <span v-else class="hidden group-hover/row:flex group-focus-within/row:flex">
            <TooltipIconButton
              v-if="row.container.state !== 'running'"
              icon="play"
              label="Start"
              data-testid="docker-row-start"
              @click.stop="act(row.container, 'start')"
            />
            <TooltipIconButton
              v-else
              icon="debug-stop"
              label="Stop"
              data-testid="docker-row-stop"
              @click.stop="act(row.container, 'stop')"
            />
          </span>
        </span>
        <span />
        <span class="col-span-2 flex min-w-0 items-baseline gap-1.5 text-kira-sm text-muted-foreground">
          <span class="truncate" data-testid="docker-row-image">{{ row.container.image }}</span>
          <span v-if="portLabel(row.container)" class="max-w-[40%] shrink-0 truncate font-data" data-testid="docker-row-ports">{{ portLabel(row.container) }}</span>
        </span>
      </div>
    </template>
  </VirtualList>
</template>
