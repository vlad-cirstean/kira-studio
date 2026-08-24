<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import CodiconIcon from '../../theme/CodiconIcon.vue';
import IconButton from '../../theme/primitives/IconButton.vue';
import TextField from '../../theme/primitives/TextField.vue';
import { getPage } from './streamPage';
import {
  clearStreamSearchState,
  goToNextMatch,
  goToPrevMatch,
  runStreamSearch,
  streamSearchState,
} from './streamSearch';

const props = defineProps<{ tabId: string }>();
const emit = defineEmits<{ goToMatch: [row: number]; close: [] }>();

// README's own "search walks the loaded rows only and never issues a query" wording, borrowed
// verbatim from grid/SearchToolbar.vue's precedent — applies here too (item 5).
const loadedRowCount = computed(() => getPage(props.tabId)?.rowCount ?? 0);

const query = ref('');
const entry = computed(() => streamSearchState[props.tabId]);

watch(query, (q) => {
  runStreamSearch(props.tabId, q);
  const e = streamSearchState[props.tabId];
  if (e && e.matches.length > 0) emit('goToMatch', e.matches[0]);
});

function next(): void {
  const row = goToNextMatch(props.tabId);
  if (row !== null) emit('goToMatch', row);
}
function prev(): void {
  const row = goToPrevMatch(props.tabId);
  if (row !== null) emit('goToMatch', row);
}

function close(): void {
  clearStreamSearchState(props.tabId);
  emit('close');
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') close();
  else if (e.key === 'Enter') {
    e.preventDefault();
    if (e.shiftKey) prev();
    else next();
  }
}

onUnmounted(() => clearStreamSearchState(props.tabId));
</script>

<template>
  <!-- Docks below the toolbar it searches, same placement law as grid/SearchToolbar.vue. -->
  <div class="stream-search-toolbar p-toolbar" data-testid="stream-search-toolbar" @keydown="onKeydown">
    <span class="icon-box muted"><CodiconIcon name="search" :size="14" /></span>
    <div class="search-input">
      <TextField v-model="query" placeholder="Find" data-testid="stream-search-input" />
    </div>
    <span class="p-sm muted search-count" data-testid="stream-search-count">
      <template v-if="entry && entry.matches.length > 0">
        <b class="mono">{{ entry.index + 1 }}</b> of <b class="mono">{{ entry.matches.length }}</b>
      </template>
      <template v-else>0 of 0</template>
    </span>
    <IconButton icon="chevron-up" :size="12" v-tooltip="'Previous match'" data-testid="stream-search-prev" @click="prev" />
    <IconButton icon="chevron-down" :size="12" v-tooltip="'Next match'" data-testid="stream-search-next" @click="next" />
    <div class="sep" />
    <span class="p-xs dim">in the {{ loadedRowCount.toLocaleString() }} loaded rows</span>
    <IconButton icon="close" class="p-push" v-tooltip="'Close'" data-testid="stream-search-close" @click="close" />
  </div>
</template>

<style scoped>
.stream-search-toolbar {
  background: var(--kira-bg-elevated);
}

.search-input {
  width: 200px;
  flex-shrink: 0;
}

.search-input :deep(.p-input) {
  width: 100%;
}

.search-count {
  white-space: nowrap;
}
</style>
