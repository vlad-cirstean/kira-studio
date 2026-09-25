<script setup lang="ts">
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import TreeTwisty from '@workbench/components/TreeTwisty.vue';
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

// P105 §5.2(c): Enter activates (toggle for a file row, permanent open for a match — matching
// double-click); Space mirrors a single click.
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter') {
    e.preventDefault();
    emit('select', props.row);
    if (props.row.kind === 'file') emit('toggleCollapse', props.row);
    else emit('open', props.row, false);
  } else if (e.key === ' ') {
    e.preventDefault();
    onClick();
  }
}
</script>

<template>
  <div
    v-if="row.kind === 'file'"
    class="flex items-center cursor-default whitespace-nowrap select-none h-row text-kira-md gap-1 pl-1 pr-2 repo-search-row"
    :class="{ selected }"
    data-testid="repo-search-file-row"
    :data-path="row.path"
    role="option"
    tabindex="0"
    :aria-selected="selected"
    @click="onClick"
    @keydown="onKeydown"
  >
    <!-- P110 I2-13: shares TreeTwisty with the tree rows, but deliberately keeps no cursor-pointer
         (base.css's own retired comment: "a real, deliberate difference") -- the whole row is
         already the click target (onClick below), so the twisty here is decoration, not its own
         control; @toggle mirrors that same row click rather than doing nothing under it. -->
    <TreeTwisty
      :expanded="!row.collapsed"
      :has-children="true"
      class="cursor-default"
      @toggle="onClick"
    />
    <span
      class="shrink-0 w-4 h-4 mask-contain mask-no-repeat mask-center"
      :style="fileIconStyle(row.path)"
      aria-hidden="true"
    ></span>
    <Tooltip>
      <TooltipTrigger as-child>
        <span class="overflow-hidden text-ellipsis flex-1 min-w-0">{{ fileName }}</span>
      </TooltipTrigger>
      <TooltipContent>{{ row.path }}</TooltipContent>
    </Tooltip>
    <span class="text-kira-xs text-subtle shrink-0" data-testid="repo-search-match-count">{{
      row.matchCount
    }}</span>
    <Tooltip v-if="row.fileTruncated">
      <TooltipTrigger as-child>
        <span class="text-kira-xs text-subtle">+</span>
      </TooltipTrigger>
      <TooltipContent>This file hit the per-file match cap — not every match is shown</TooltipContent>
    </Tooltip>
  </div>
  <div
    v-else
    class="flex items-center cursor-default whitespace-nowrap select-none h-row text-kira-md gap-1 pl-6 pr-2 font-data repo-search-row"
    :class="{ selected }"
    data-testid="repo-search-match-row"
    :data-path="row.path"
    :data-line="row.line"
    role="option"
    tabindex="0"
    :aria-selected="selected"
    @click="onClick"
    @dblclick="onDblClick"
    @keydown="onKeydown"
  >
    <span class="text-kira-xs text-subtle shrink-0 min-w-10">{{ row.line }}:{{ row.column }}</span>
    <span class="overflow-hidden text-ellipsis"
      >{{ previewParts.before
      }}<span class="rounded-sm bg-search-match">{{ previewParts.match }}</span
      >{{ previewParts.after }}</span
    >
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

/* P110 B37: only the live :hover state plus its cascade order against the JS-toggled .selected
   class stays here -- both scoped rules share equal specificity, so source order (selected after
   hover) is what makes a selected row's own background win over hover; moving .selected onto a
   plain utility class would drop below the scoped :hover rule's specificity instead (scoped styles
   add an attribute selector) and invert that. Everything else moved onto the template as inline
   utility classes. */
.repo-search-row:hover {
  @apply bg-hover;
}

.repo-search-row.selected {
  @apply bg-select;
}
</style>
