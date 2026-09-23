<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { computed } from 'vue';
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
    <Tooltip>
      <TooltipTrigger as-child>
        <span class="label">{{ fileName }}</span>
      </TooltipTrigger>
      <TooltipContent>{{ row.path }}</TooltipContent>
    </Tooltip>
    <span class="p-xs dim match-count" data-testid="repo-search-match-count">{{
      row.matchCount
    }}</span>
    <Tooltip v-if="row.fileTruncated">
      <TooltipTrigger as-child>
        <span class="p-xs dim">+</span>
      </TooltipTrigger>
      <TooltipContent>This file hit the per-file match cap — not every match is shown</TooltipContent>
    </Tooltip>
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
@reference "@theme/base.css";

.repo-search-row {
  @apply flex items-center cursor-default whitespace-nowrap select-none h-row text-kira-md gap-1 pl-1 pr-2;
}

.repo-search-row:hover {
  @apply bg-hover;
}

.repo-search-row.selected {
  @apply bg-select;
}

.match-row {
  padding-left: calc(var(--kira-s-2) + 20px);
}

.twisty {
  @apply flex shrink-0 items-center justify-center bg-transparent border-0 text-muted p-0 w-3.5 h-3.5;
}

/* P67b §6.2: matches RepoTreeRow.vue's own rule — a real per-language icon here too, rather than
   the tree gaining per-language icons while search keeps one generic glyph. */
.node-icon {
  @apply shrink-0 w-4 h-4;
  mask-size: contain;
  mask-repeat: no-repeat;
  mask-position: center;
  -webkit-mask-size: contain;
  -webkit-mask-repeat: no-repeat;
  -webkit-mask-position: center;
}

.label {
  @apply overflow-hidden text-ellipsis flex-1 min-w-0;
}

.match-count {
  @apply shrink-0;
}

.match-line {
  @apply shrink-0 min-w-10;
}

.preview {
  @apply overflow-hidden text-ellipsis;
}

.preview-match {
  @apply rounded-sm;
  background: var(--kira-search-match);
}
</style>
