<script setup lang="ts">
import { grpcMethodClass } from '@shared/domain/grpc';
import { httpMethodClass } from '@shared/domain/http';
import { computed, nextTick, ref, watch } from 'vue';
import CodiconIcon from '../theme/CodiconIcon.vue';
import { activeSearchQuery, type CollectionRowVm, collectionsState } from './state/collections';

// P4 D13: the same 8 + depth × 14 px indent, roving tabindex and twisty as project/TreeRow.vue,
// with three differences that are the whole reason this is a separate file rather than a widened
// shared row: no connection colour rail, no status dot and no EngineIcon (none of which mean
// anything here); a leading **method chip** for a request row, which is what Postman itself shows
// and what makes a long request list scannable; and an inline rename input.
//
// It is a separate file for a hard reason as well as a soft one: `http/**` may not import
// `project/**` (biome.json), so reuse was never on the table.
const props = withDefaults(
  defineProps<{ row: CollectionRowVm; selected: boolean; sticky?: boolean }>(),
  { sticky: false },
);

const emit = defineEmits<{
  select: [row: CollectionRowVm];
  toggle: [row: CollectionRowVm];
  open: [row: CollectionRowVm];
  contextmenu: [row: CollectionRowVm, event: MouseEvent];
  rename: [row: CollectionRowVm, name: string];
  'cancel-rename': [];
}>();

// A collection is a library; a folder flips with its own expand state, the same way Studio's
// group row does. A request gets no icon at all — the method chip is its identity.
const icon = computed(() => {
  if (props.row.kind === 'collection') return 'folder-library';
  return props.row.expanded ? 'folder-opened' : 'folder';
});

const renaming = computed(() => collectionsState.renamingKey === props.row.key);
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
  const query = activeSearchQuery.value;
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

function onTwistyClick(e: MouseEvent): void {
  e.stopPropagation();
  if (props.row.hasChildren) emit('toggle', props.row);
}
</script>

<template>
  <div
    class="tree-row"
    :class="{ selected }"
    :style="{ paddingLeft: `${8 + row.depth * 14}px` }"
    :data-testid="sticky ? 'collection-sticky-row' : 'collection-row'"
    :data-kind="row.kind"
    :data-id="row.id"
    :data-depth="row.depth"
    :tabindex="sticky ? -1 : selected ? 0 : -1"
    @click="emit('select', row)"
    @dblclick="emit('open', row)"
    @contextmenu.prevent.stop="emit('contextmenu', row, $event)"
  >
    <!-- Same reasoning as project/TreeRow.vue's twisty: its entire meaning is drawn by the
         chevron direction, so no v-tooltip, but :aria-label stays so it isn't nameless. -->
    <button
      type="button"
      class="twisty"
      :class="{ invisible: !row.hasChildren }"
      tabindex="-1"
      :aria-label="row.expanded ? 'Collapse' : 'Expand'"
      @click="onTwistyClick"
    >
      <CodiconIcon :name="row.expanded ? 'chevron-down' : 'chevron-right'" :size="13" />
    </button>

    <span
      v-if="row.kind === 'request' && row.protocol === 'grpc'"
      class="p-chip method"
      :class="grpcMethodClass(row.method)"
      data-testid="grpc-collection-chip"
    >
      gRPC
    </span>
    <span v-else-if="row.kind === 'request'" class="p-chip method" :class="httpMethodClass(row.method)">{{
      row.method
    }}</span>
    <CodiconIcon v-else :name="icon" :size="13" class="node-icon" />

    <!-- D13: inline rename doubles as the naming step for all three creation paths, so there is
         one naming interaction instead of a prompt dialog this app does not have. It is also VS
         Code's explorer behaviour, which is the tree this panel is modelled on. -->
    <input
      v-if="renaming"
      ref="inputRef"
      v-model="draft"
      class="rename-input"
      data-testid="collection-rename-input"
      @click.stop
      @dblclick.stop
      @keydown.enter.prevent="commitRename"
      @keydown.esc.prevent="cancelRename"
      @blur="commitRename"
    />
    <span v-else class="label" v-tooltip="row.url || row.name">
      <template v-for="(part, i) in parts" :key="i">
        <mark v-if="part.hit">{{ part.text }}</mark>
        <template v-else>{{ part.text }}</template>
      </template>
    </span>
  </div>
</template>

<style scoped>
.tree-row {
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

.tree-row:hover {
  background: var(--kira-hover);
}

.tree-row.selected {
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

/* A fixed width so every row's name starts at the same x — an unaligned ragged edge is exactly
   what makes a long request list hard to scan, which is the reason the chip exists at all. */
.method {
  flex-shrink: 0;
  width: 52px;
  text-align: center;
  font-size: var(--kira-t-xs);
  letter-spacing: 0.02em;
  overflow: hidden;
  text-overflow: ellipsis;
}

.label {
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.label mark {
  /* The same yellow search-match tint every other search-capable view in the app uses. */
  background: var(--kira-search-match);
  color: inherit;
  border-radius: 2px;
}

.rename-input {
  flex: 1;
  min-width: 0;
  font: inherit;
  color: var(--kira-fg);
  background: var(--kira-bg-input);
  border: var(--kira-border-width) solid var(--kira-accent);
  border-radius: 2px;
  padding: 0 var(--kira-s-1);
  outline: none;
}
</style>
