<script setup lang="ts">
import { grpcMethodClass } from '@shared/domain/grpc';
import { httpMethodToken } from '@shared/domain/http';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Badge } from '@theme/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { cn } from '@theme/lib/utils';
import { methodTextClass } from '@theme/methodColor';
import TreeTwisty from '@workbench/components/TreeTwisty.vue';
import { computed, type HTMLAttributes, nextTick, ref, watch } from 'vue';
import { type CollectionRowVm, useCollectionsStore } from './state/collections';

// P4 D13: the same 8 + depth × 14 px indent, roving tabindex and twisty as project/TreeRow.vue,
// with three differences that are the whole reason this is a separate file rather than a widened
// shared row: no connection colour rail, no status dot and no EngineIcon (none of which mean
// anything here); a leading **method chip** for a request row, which is what Postman itself shows
// and what makes a long request list scannable; and an inline rename input.
//
// It is a separate file for a hard reason as well as a soft one: `http/**` may not import
// `project/**` (biome.json), so reuse was never on the table.
const props = withDefaults(
  defineProps<{
    row: CollectionRowVm;
    selected: boolean;
    sticky?: boolean;
    class?: HTMLAttributes['class'];
  }>(),
  { sticky: false },
);

// P110 I2-14: same ternary as TreeRow.vue's own stateClass -- selected beats hover pre-phase on
// specificity, so this reproduces that exactly.
const stateClass = computed(() =>
  props.selected ? 'bg-select' : props.sticky ? 'bg-bg hover:bg-hover' : 'hover:bg-hover',
);

const emit = defineEmits<{
  select: [row: CollectionRowVm];
  toggle: [row: CollectionRowVm];
  open: [row: CollectionRowVm];
  contextmenu: [row: CollectionRowVm, event: MouseEvent];
  rename: [row: CollectionRowVm, name: string];
  'cancel-rename': [];
}>();

const collectionsStore = useCollectionsStore();

// A collection is a library; a folder flips with its own expand state, the same way Studio's
// group row does. A request gets no icon at all — the method chip is its identity.
const icon = computed(() => {
  if (props.row.kind === 'collection') return 'folder-library';
  return props.row.expanded ? 'folder-opened' : 'folder';
});

const renaming = computed(() => collectionsStore.renamingKey === props.row.key);
const draft = ref('');
const inputRef = ref<HTMLInputElement | null>(null);

watch(
  renaming,
  (isRenaming) => {
    if (!isRenaming) return;
    draft.value = props.row.name;
    void nextTick(() => {
      inputRef.value?.focus();
      inputRef.value?.select();
    });
  },
  { immediate: true },
);

function commitRename(): void {
  if (!renaming.value) return;
  const name = draft.value.trim();
  // An empty name is a cancel, not a rename to '' — the row would become unclickable.
  if (!name || name === props.row.name) {
    emit('cancel-rename');
    return;
  }
  emit('rename', props.row, name);
}

function cancelRename(): void {
  emit('cancel-rename');
}

// Splits the label on every case-insensitive occurrence of the live query so only the matched
// substring is <mark>-ed, not the whole label — project/TreeRow.vue's own highlighting, over this
// tree's own row model.
const parts = computed<{ text: string; hit: boolean }[]>(() => {
  const query = collectionsStore.activeSearchQuery;
  const name = props.row.name;
  if (!props.row.matched || !query) return [{ text: name, hit: false }];
  const lower = name.toLowerCase();
  const out: { text: string; hit: boolean }[] = [];
  let i = 0;
  while (i < name.length) {
    const idx = lower.indexOf(query, i);
    if (idx === -1) {
      out.push({ text: name.slice(i), hit: false });
      break;
    }
    if (idx > i) out.push({ text: name.slice(i, idx), hit: false });
    out.push({ text: name.slice(idx, idx + query.length), hit: true });
    i = idx + query.length;
  }
  // A URL-only match leaves the name unsplit, which is correct — the URL is searched, not shown.
  return out.length > 0 ? out : [{ text: name, hit: false }];
});

function onTwistyClick(): void {
  emit('toggle', props.row);
}

// P105 §5.2(c): the container's own onTreeKeydown (CollectionsTree.vue) already claims Enter for
// the row's primary action (the same one dblclick fires) — Space mirrors a single click instead.
function onKeydown(e: KeyboardEvent): void {
  if (e.key === ' ') {
    e.preventDefault();
    emit('select', props.row);
  }
}
</script>

<template>
  <div
    :class="
      cn(
        'relative flex items-center gap-1 pr-2 h-row text-kira-md whitespace-nowrap select-none cursor-default',
        stateClass,
        props.class,
      )
    "
    :style="{ paddingLeft: `${8 + row.depth * 14}px` }"
    :data-testid="sticky ? 'collection-sticky-row' : 'collection-row'"
    :data-kind="row.kind"
    :data-id="row.id"
    :data-depth="row.depth"
    role="treeitem"
    :aria-level="row.depth + 1"
    :aria-expanded="row.hasChildren ? row.expanded : undefined"
    :aria-selected="selected"
    :tabindex="sticky ? -1 : selected ? 0 : -1"
    @click="emit('select', row)"
    @dblclick="emit('open', row)"
    @keydown="onKeydown"
    @contextmenu.prevent.stop="emit('contextmenu', row, $event)"
  >
    <!-- Same reasoning as project/TreeRow.vue's twisty: its entire meaning is drawn by the
         chevron direction, so no tooltip, but :aria-label stays so it isn't nameless. -->
    <TreeTwisty :expanded="row.expanded" :has-children="row.hasChildren" @toggle="onTwistyClick" />

    <!-- A fixed width so every row's name starts at the same x -- an unaligned ragged edge is
         exactly what makes a long request list hard to scan, which is the reason the chip exists
         at all. -->
    <Badge
      v-if="row.kind === 'request' && row.protocol === 'grpc'"
      class="w-14 shrink-0 overflow-hidden text-center text-ellipsis tracking-wide text-kira-xs"
      :variant="grpcMethodClass(row.method)"
      data-testid="grpc-collection-chip"
    >
      gRPC
    </Badge>
    <Badge
      v-else-if="row.kind === 'request'"
      variant="chip"
      class="method w-14 shrink-0 overflow-hidden text-center text-ellipsis tracking-wide text-kira-xs"
      :class="methodTextClass(httpMethodToken(row.method))"
      >{{ row.method }}</Badge
    >
    <CodiconIcon v-else :name="icon" :size="13" class="shrink-0 text-muted-foreground" />

    <!-- D13: inline rename doubles as the naming step for all three creation paths, so there is
         one naming interaction instead of a prompt dialog this app does not have. It is also VS
         Code's explorer behaviour, which is the tree this panel is modelled on. -->
    <input
      v-if="renaming"
      ref="inputRef"
      v-model="draft"
      class="min-w-0 flex-1 rounded-kira-sm border px-0.5 py-0 text-fg bg-field outline-none border-primary"
      data-testid="collection-rename-input"
      @click.stop
      @dblclick.stop
      @keydown.enter.prevent="commitRename"
      @keydown.esc.prevent="cancelRename"
      @blur="commitRename"
    />
    <Tooltip v-else>
      <TooltipTrigger as-child>
        <span class="min-w-0 overflow-hidden text-ellipsis">
          <template v-for="(part, i) in parts" :key="i">
            <!-- The same yellow search-match tint every other search-capable view in the app uses. -->
            <mark v-if="part.hit" class="rounded-kira-sm text-inherit bg-warn/25">{{ part.text }}</mark>
            <template v-else>{{ part.text }}</template>
          </template>
        </span>
      </TooltipTrigger>
      <TooltipContent>{{ row.url || row.name }}</TooltipContent>
    </Tooltip>
    <!-- P110 I2-14: `.tree-row`'s hover/selected ternary moved onto the root binding (stateClass,
         above) -- see packages/theme/src/base.css's own pointer comment for the retired
         `@utility tree-row`. P110 I2-13: the twisty moved to TreeTwisty.vue. -->
  </div>
</template>
