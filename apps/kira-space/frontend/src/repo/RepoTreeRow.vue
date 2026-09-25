<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { computed } from 'vue';
import { fileIconStyle } from './fileIcon';
import type { RepoTreeRowVm } from './state/fileTree';

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

// P67b §6.2: directories keep their folder glyph (OQ-3 — the diff tree has no directory-icon rule
// to port, so none is invented here). A file's own icon comes from fileIconStyle below instead.
const dirIcon = computed(() => (props.row.expanded ? 'folder-opened' : 'folder'));

// §7.1's four-value status glyph — 'M'/'A' amber-ish/green-ish, 'D' struck, '?' muted, matching
// the connection tree's own status-color convention. data-status stays on the row for tests/
// styling hooks; the label's own colour is now a direct computed class rather than an
// attribute-selector CSS rule keyed off it.
const statusAttr = computed(() => props.row.status);

const labelStatusClass = computed(() => {
  switch (statusAttr.value) {
    case 'M':
    case 'A':
      return 'text-warn';
    case 'D':
      return 'text-error line-through';
    case '?':
      return 'text-muted-foreground';
    default:
      return '';
  }
});

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

// P105 §5.2(c): Enter opens (permanent, matching double-click); Space mirrors a single click
// (select + toggle-or-preview-open) — the two keys the roving tabindex above already implies.
function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter') {
    e.preventDefault();
    emit('select', props.row);
    if (props.row.isDir) emit('toggle', props.row);
    else emit('open', props.row, false);
  } else if (e.key === ' ') {
    e.preventDefault();
    onClick();
  }
}
</script>

<template>
  <div
    class="flex items-center relative cursor-default whitespace-nowrap select-none h-row text-kira-md gap-1 pr-2 repo-tree-row"
    :class="{ selected }"
    :style="{ paddingLeft: `${8 + row.depth * 14}px` }"
    :data-testid="sticky ? 'repo-tree-sticky-row' : 'repo-tree-row'"
    :data-path="row.path"
    :data-status="statusAttr"
    role="treeitem"
    :aria-expanded="row.isDir ? row.expanded : undefined"
    :aria-selected="selected"
    :tabindex="sticky ? -1 : selected ? 0 : -1"
    @click="onClick"
    @dblclick="onDblClick"
    @keydown="onKeydown"
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
    <CodiconIcon
      v-if="row.isDir"
      :name="dirIcon"
      :size="16"
      class="node-icon shrink-0 w-4 h-4 text-muted-foreground mask-contain mask-no-repeat mask-center"
    />
    <span
      v-else
      class="node-icon shrink-0 w-4 h-4 text-muted-foreground mask-contain mask-no-repeat mask-center"
      :style="fileIconStyle(row.path)"
      aria-hidden="true"
    ></span>
    <Tooltip>
      <TooltipTrigger as-child>
        <span class="overflow-hidden text-ellipsis min-w-0" :class="labelStatusClass">{{ row.name }}</span>
      </TooltipTrigger>
      <TooltipContent>{{ row.name }}</TooltipContent>
    </Tooltip>
  </div>
</template>

<style scoped>
@reference "@theme/base.css";

/* P110 B37: only the live :hover state plus its cascade order against the JS-toggled .selected
   class stays here -- both scoped rules share equal specificity, so source order (selected after
   hover) is what makes a selected row's own background win over hover; moving .selected onto a
   plain utility class would drop below the scoped :hover rule's specificity instead (scoped styles
   add an attribute selector) and invert that. Everything else moved onto the template as inline
   utility classes -- .node-icon's own mask-size/mask-repeat/mask-position (+ -webkit- prefixed)
   became Tailwind's own mask-contain/mask-no-repeat/mask-center (confirmed via compile check to
   emit both prefixed and unprefixed forms); the three data-status attribute-selector rules became
   labelStatusClass, a computed bound directly onto the label span (data-status itself stays on the
   row, for tests/other styling hooks). */
.repo-tree-row:hover {
  @apply bg-hover;
}

.repo-tree-row.selected {
  @apply bg-select;
}
</style>
