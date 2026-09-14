<script setup lang="ts">
import { computed } from 'vue';
import CodiconIcon from '../theme/CodiconIcon.vue';
import { fileIconStyle } from './fileIcon';
import type { RepoSearchRowVm } from './state/search';

// C7 §7.3: one flat row component for both shapes the store's own row fold produces — a file
// header (path, match count, collapse chevron) or a match (line:column, highlighted preview) —
// mirroring RepoTreeRow.vue's own markup/class conventions so the two panels read as one system.
const props = defineProps<{ row: RepoSearchRowVm; selected: boolean }>();
const emit = defineEmits<{
  select: [row: RepoSearchRowVm];
  toggleCollapse: [row: RepoSearchRowVm];
  open: [row: RepoSearchRowVm, preview: boolean];
}>();

const fileName = computed(() => {
  const i = props.row.path.lastIndexOf('/');
  return i < 0 ? props.row.path : props.row.path.slice(i + 1);
});

// previewMatchStart/End are UTF-16 offsets into preview (packages/shared/domain/repo.ts) — exactly
// what a JS string index already is, so slicing needs no further conversion.
const previewParts = computed(() => {
  const preview = props.row.preview ?? '';
  const start = props.row.previewMatchStart ?? 0;
  const end = props.row.previewMatchEnd ?? 0;
  return {
    before: preview.slice(0, start),
    match: preview.slice(start, end),
    after: preview.slice(end),
  };
});

function onClick(): void {
  emit('select', props.row);
  if (props.row.kind === 'file') {
    emit('toggleCollapse', props.row);
  } else {
    // §7.3: a single click opens a preview tab — the tree's own onSelect/onOpen split.
    emit('open', props.row, true);
  }
}

function onDblClick(): void {
  if (props.row.kind === 'file') return;
  emit('open', props.row, false);
}
</script>

<template>
  <div
    v-if="row.kind === 'file'"
    class="repo-search-row"
    :class="{ selected }"
    data-testid="repo-search-file-row"
    :data-path="row.path"
    @click="onClick"
  >
    <button
      type="button"
      class="twisty"
      tabindex="-1"
      :aria-label="row.collapsed ? 'Expand' : 'Collapse'"
    >
      <CodiconIcon :name="row.collapsed ? 'chevron-right' : 'chevron-down'" :size="13" />
    </button>
    <span class="node-icon" :style="fileIconStyle(row.path)" aria-hidden="true"></span>
    <span class="label" v-tooltip="row.path">{{ fileName }}</span>
    <span class="p-xs dim match-count" data-testid="repo-search-match-count">{{
      row.matchCount
    }}</span>
    <span
      v-if="row.fileTruncated"
      class="p-xs dim"
      v-tooltip="'This file hit the per-file match cap — not every match is shown'"
      >+</span
    >
  </div>
  <div
    v-else
    class="repo-search-row match-row mono"
    :class="{ selected }"
    data-testid="repo-search-match-row"
    :data-path="row.path"
    :data-line="row.line"
    @click="onClick"
    @dblclick="onDblClick"
  >
    <span class="p-xs dim match-line">{{ row.line }}:{{ row.column }}</span>
    <span class="preview"
      >{{ previewParts.before
      }}<span class="preview-match">{{ previewParts.match }}</span
      >{{ previewParts.after }}</span
    >
  </div>
</template>

<style scoped>
.repo-search-row {
  height: var(--kira-row-height);
  display: flex;
  align-items: center;
  gap: var(--kira-s-2);
  padding-left: var(--kira-s-2);
  padding-right: var(--kira-s-4);
  cursor: default;
  white-space: nowrap;
  font-size: var(--kira-t-md);
  user-select: none;
}

.repo-search-row:hover {
  background: var(--kira-hover);
}

.repo-search-row.selected {
  background: var(--kira-select);
}

.match-row {
  padding-left: calc(var(--kira-s-2) + 20px);
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
}

/* P67b §6.2: matches RepoTreeRow.vue's own rule — a real per-language icon here too, rather than
   the tree gaining per-language icons while search keeps one generic glyph. */
.node-icon {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  mask-size: contain;
  mask-repeat: no-repeat;
  mask-position: center;
  -webkit-mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  -webkit-mask-position: center;
}

.label {
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

.match-count {
  flex-shrink: 0;
}

.match-line {
  flex-shrink: 0;
  min-width: 40px;
}

.preview {
  overflow: hidden;
  text-overflow: ellipsis;
}

.preview-match {
  background: var(--kira-search-match);
  border-radius: 2px;
}
</style>
