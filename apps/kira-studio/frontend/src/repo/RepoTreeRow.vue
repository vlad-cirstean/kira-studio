<script setup lang="ts">
import { computed } from 'vue';
import CodiconIcon from '../theme/CodiconIcon.vue';
import type { RepoTreeRowVm } from './state/fileTree';

// §7.2: "Icons come from CodiconIcon with a small extension map ... not a new icon dependency" —
// five buckets, independent of views/repo/language.ts's own ~20-id Monaco language map (a
// different purpose: coloring coverage vs. a glance-icon).
const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'webp',
  'bmp',
  'ico',
  'avif',
]);
const CODE_EXTENSIONS = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'go',
  'rs',
  'py',
  'java',
  'c',
  'h',
  'cpp',
  'hpp',
  'vue',
  'svelte',
  'html',
  'css',
  'scss',
  'less',
  'sh',
  'bash',
  'sql',
  'yaml',
  'yml',
  'toml',
  'proto',
  'graphql',
]);

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

const props = withDefaults(
  defineProps<{ row: RepoTreeRowVm; selected: boolean; sticky?: boolean }>(),
  {
    sticky: false,
  },
);
const emit = defineEmits<{
  select: [row: RepoTreeRowVm];
  toggle: [row: RepoTreeRowVm];
  open: [row: RepoTreeRowVm, preview: boolean];
  contextmenu: [row: RepoTreeRowVm, event: MouseEvent];
}>();

const icon = computed(() => {
  if (props.row.isDir) return props.row.expanded ? 'folder-opened' : 'folder';
  const ext = extOf(props.row.name);
  if (ext === 'json' || ext === 'jsonc') return 'json';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (IMAGE_EXTENSIONS.has(ext)) return 'file-media';
  if (CODE_EXTENSIONS.has(ext)) return 'file-code';
  return 'file';
});

// §7.1's four-value status glyph — 'M'/'A' amber-ish/green-ish, 'D' struck, '?' muted, matching
// the connection tree's own status-color convention (a data attribute the stylesheet keys off).
const statusAttr = computed(() => props.row.status);

function onClick(): void {
  emit('select', props.row);
  if (props.row.isDir) {
    emit('toggle', props.row);
  } else {
    // §7.2: single click opens a preview tab.
    emit('open', props.row, true);
  }
}

function onDblClick(): void {
  if (props.row.isDir) return;
  // §7.2: double click opens a permanent tab.
  emit('open', props.row, false);
}

function onContextMenu(e: MouseEvent): void {
  emit('contextmenu', props.row, e);
}
</script>

<template>
  <div
    class="repo-tree-row"
    :class="{ selected }"
    :style="{ paddingLeft: `${8 + row.depth * 14}px` }"
    :data-testid="sticky ? 'repo-tree-sticky-row' : 'repo-tree-row'"
    :data-path="row.path"
    :data-status="statusAttr"
    :tabindex="sticky ? -1 : selected ? 0 : -1"
    @click="onClick"
    @dblclick="onDblClick"
    @contextmenu.prevent.stop="onContextMenu"
  >
    <button
      type="button"
      class="twisty"
      :class="{ invisible: !row.hasChildren }"
      tabindex="-1"
      :aria-label="row.expanded ? 'Collapse' : 'Expand'"
      @click.stop="row.hasChildren && emit('toggle', row)"
    >
      <CodiconIcon :name="row.expanded ? 'chevron-down' : 'chevron-right'" :size="13" />
    </button>
    <CodiconIcon :name="icon" :size="13" class="node-icon" />
    <span class="label" v-tooltip="row.name">{{ row.name }}</span>
  </div>
</template>

<style scoped>
.repo-tree-row {
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

.repo-tree-row:hover {
  background: var(--kira-hover);
}

.repo-tree-row.selected {
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

.node-icon {
  flex-shrink: 0;
  color: var(--kira-fg-muted);
}

.label {
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.repo-tree-row[data-status='M'] .label,
.repo-tree-row[data-status='A'] .label {
  color: var(--kira-warn);
}

.repo-tree-row[data-status='D'] .label {
  color: var(--kira-error);
  text-decoration: line-through;
}

.repo-tree-row[data-status='?'] .label {
  color: var(--kira-fg-muted);
}
</style>
