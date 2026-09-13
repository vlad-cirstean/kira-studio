<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { wrapSelectionOnType } from '../theme/wrapSelection';
import {
  closeQuickOpen,
  QUICK_OPEN_MAX_RESULTS,
  type QuickOpenRow,
  quickOpenLoading,
  quickOpenResults,
  quickOpenState,
  quickOpenTruncated,
} from './state/quickOpen';

const inputRef = ref<HTMLInputElement | null>(null);
const listRef = ref<HTMLElement | null>(null);
const activeIndex = ref(0);

const loading = computed(() => quickOpenLoading());
const rows = computed(() => quickOpenResults());
const truncated = computed(() => quickOpenTruncated());

watch(
  () => quickOpenState.open,
  async (open) => {
    if (!open) return;
    activeIndex.value = 0;
    await nextTick();
    inputRef.value?.focus();
  },
);

watch(rows, () => {
  activeIndex.value = 0;
});

watch(activeIndex, () => {
  void nextTick(() => {
    listRef.value?.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' });
  });
});

// C9 S5: the palette lists and filters; opening a row does nothing yet — S6 wires the real
// openRepoFileTab call in its place.
function openRow(_row: QuickOpenRow, _preview: boolean): void {
  closeQuickOpen();
}

function runOpenAt(index: number, preview: boolean): void {
  const row = rows.value[index];
  if (!row) return;
  closeQuickOpen();
  openRow(row, preview);
}

function onKeydown(e: KeyboardEvent): void {
  wrapSelectionOnType(e);
  if (e.key === 'Escape') {
    e.preventDefault();
    closeQuickOpen();
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    activeIndex.value = Math.min(rows.value.length - 1, activeIndex.value + 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    activeIndex.value = Math.max(0, activeIndex.value - 1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    // D7: Enter previews, ⇧Enter opens a permanent tab — the palette's own keyboard equivalent of
    // the tree/search views' single-click/double-click split, since a palette has no double-click.
    runOpenAt(activeIndex.value, !e.shiftKey);
  }
}
</script>

<template>
  <div
    v-if="quickOpenState.open"
    class="palette-backdrop"
    data-testid="quick-open-backdrop"
    @click="closeQuickOpen"
  >
    <div class="palette p-float quick-open" data-testid="quick-open" @click.stop>
      <div class="palette-input-pad">
        <div class="p-input ui md palette-input">
          <input
            ref="inputRef"
            v-model="quickOpenState.query"
            data-testid="quick-open-input"
            type="text"
            placeholder="Search files by name"
            @keydown="onKeydown"
          />
        </div>
      </div>
      <div ref="listRef" class="palette-list">
        <div v-if="loading" class="palette-empty dim" data-testid="quick-open-loading">
          Loading files…
        </div>
        <template v-else>
          <div
            v-for="(row, i) in rows"
            :key="row.path"
            class="p-row palette-item quick-open-item"
            :class="{ 'is-selected': i === activeIndex }"
            data-testid="quick-open-item"
            :data-path="row.path"
            @mouseenter="activeIndex = i"
            @click="runOpenAt(i, true)"
            @dblclick="runOpenAt(i, false)"
          >
            <span class="quick-open-name">
              <template v-for="(part, pi) in row.nameParts" :key="pi">
                <b v-if="part.matched" class="quick-open-match">{{ part.text }}</b>
                <span v-else>{{ part.text }}</span>
              </template>
            </span>
            <span v-if="row.dir" class="quick-open-dir dim">{{ row.dir }}</span>
          </div>
          <div v-if="rows.length === 0" class="palette-empty dim" data-testid="quick-open-empty">
            No matching files
          </div>
        </template>
        <div v-if="truncated" class="palette-empty dim" data-testid="quick-open-truncated">
          Showing the first {{ QUICK_OPEN_MAX_RESULTS }} of many matches — refine your search
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* D4: mirrors CommandPalette.vue's own palette-backdrop/palette/palette-input-pad/palette-input/
   palette-list/palette-item/palette-empty vocabulary verbatim — the two share chrome, not a base
   component (D4's own reasoning). */
.palette-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--kira-z-dialog);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 120px;
  background: rgba(0, 0, 0, 0.3);
}

.palette {
  /* §4: 560px, wider than CommandPalette's 420px — paths run longer than command labels. */
  width: 560px;
  max-height: 360px;
  display: flex;
  flex-direction: column;
}

.palette-input-pad {
  flex-shrink: 0;
  padding: var(--kira-s-3);
}

.palette-input {
  width: 100%;
}

.palette-list {
  overflow-y: auto;
  padding: var(--kira-s-2);
  display: flex;
  flex-direction: column;
  gap: 1px;
  border-top: var(--kira-border-width) solid var(--kira-border);
}

.palette-item {
  white-space: nowrap;
}

.quick-open-item {
  display: flex;
  align-items: baseline;
  gap: var(--kira-s-2);
  min-width: 0;
}

.quick-open-name {
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.quick-open-match {
  color: var(--kira-accent);
  font-weight: 600;
}

.quick-open-dir {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: var(--kira-t-sm);
  /* §4: long paths ellipsise at the start, so the distinguishing tail (nearest the file) survives
     truncation instead of the repo-root end every path shares. */
  direction: rtl;
  text-align: left;
}

.palette-empty {
  height: var(--kira-h-sm);
  display: flex;
  align-items: center;
  padding: 0 var(--kira-s-3);
  font-size: var(--kira-t-md);
}
</style>
