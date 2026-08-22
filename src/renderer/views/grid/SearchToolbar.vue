<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { clearSearchState, runSearch, type SearchHandle, searchState } from './search';

const props = defineProps<{ tabId: string }>();
const emit = defineEmits<{ goToMatch: [row: number, col: number]; close: [] }>();

const query = ref('');
const matchCase = ref(false);
const wholeWord = ref(false);
const regex = ref(false);
const errorMessage = ref<string | null>(null);
const scanning = ref(false);
const foundSoFar = ref(0);

let handle: SearchHandle | null = null;

const entry = computed(() => searchState[props.tabId]);

function startSearch(): void {
  handle?.cancel();
  errorMessage.value = null;
  if (query.value === '') {
    clearSearchState(props.tabId);
    return;
  }
  scanning.value = true;
  foundSoFar.value = 0;
  try {
    handle = runSearch(
      props.tabId,
      {
        text: query.value,
        matchCase: matchCase.value,
        wholeWord: wholeWord.value,
        regex: regex.value,
      },
      (found) => {
        foundSoFar.value = found;
      },
    );
  } catch (err) {
    // An invalid regex is reported inline, never thrown into an unhandled rejection (D28).
    errorMessage.value = err instanceof Error ? err.message : String(err);
    scanning.value = false;
    return;
  }
  handle.done.then((matches) => {
    scanning.value = false;
    searchState[props.tabId] = { matches, index: matches.length > 0 ? 0 : -1 };
    if (matches.length > 0) emit('goToMatch', matches[0].row, matches[0].col);
  });
}

watch([query, matchCase, wholeWord, regex], startSearch);

function goNext(): void {
  const e = entry.value;
  if (!e || e.matches.length === 0) return;
  e.index = (e.index + 1) % e.matches.length;
  const m = e.matches[e.index];
  emit('goToMatch', m.row, m.col);
}
function goPrev(): void {
  const e = entry.value;
  if (!e || e.matches.length === 0) return;
  e.index = (e.index - 1 + e.matches.length) % e.matches.length;
  const m = e.matches[e.index];
  emit('goToMatch', m.row, m.col);
}

function close(): void {
  handle?.cancel();
  clearSearchState(props.tabId);
  emit('close');
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    close();
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (e.shiftKey) goPrev();
    else goNext();
  }
}

onUnmounted(() => {
  handle?.cancel();
  clearSearchState(props.tabId);
});
</script>

<template>
  <div class="search-toolbar" data-testid="search-toolbar" @keydown="onKeydown">
    <input
      v-model="query"
      type="text"
      class="search-input"
      placeholder="Find"
      data-testid="search-input"
    />
    <button
      type="button"
      class="toggle"
      :class="{ active: matchCase }"
      title="Match case"
      data-testid="search-match-case"
      @click="matchCase = !matchCase"
    >
      Aa
    </button>
    <button
      type="button"
      class="toggle"
      :class="{ active: wholeWord }"
      title="Whole word"
      data-testid="search-whole-word"
      @click="wholeWord = !wholeWord"
    >
      ab
    </button>
    <button
      type="button"
      class="toggle"
      :class="{ active: regex }"
      title="Regular expression"
      data-testid="search-regex"
      @click="regex = !regex"
    >
      .*
    </button>
    <span v-if="errorMessage" class="search-error" data-testid="search-error">{{
      errorMessage
    }}</span>
    <span v-else class="search-count" data-testid="search-count">
      <template v-if="entry && entry.matches.length > 0">
        {{ entry.index + 1 }} of {{ entry.matches.length }}
      </template>
      <template v-else-if="scanning"> {{ foundSoFar }}… </template>
      <template v-else> 0 of 0 </template>
    </span>
    <button type="button" title="Previous match" data-testid="search-prev" @click="goPrev">
      ˄
    </button>
    <button type="button" title="Next match" data-testid="search-next" @click="goNext">˅</button>
    <button type="button" title="Close" data-testid="search-close" @click="close">✕</button>
  </div>
</template>

<style scoped>
.search-toolbar {
  position: absolute;
  top: 8px;
  right: 24px;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 6px;
  background: var(--kira-bg-elevated);
  border: var(--kira-border-width) solid var(--kira-border);
  border-radius: var(--kira-radius);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  font-size: 11px;
}

.search-input {
  width: 160px;
  background: var(--kira-bg-input);
  border: var(--kira-border-width) solid var(--kira-border);
  border-radius: var(--kira-radius-sm);
  color: var(--kira-fg);
  padding: 2px 6px;
  font-size: 11px;
}

.toggle {
  background: transparent;
  border: var(--kira-border-width) solid var(--kira-border);
  border-radius: var(--kira-radius-sm);
  color: var(--kira-fg-muted);
  cursor: pointer;
  padding: 1px 5px;
  font-size: 10px;
}

.toggle.active {
  background: var(--kira-select);
  color: var(--kira-fg);
}

.search-count {
  color: var(--kira-fg-muted);
  white-space: nowrap;
  min-width: 48px;
  text-align: center;
}

.search-error {
  color: var(--kira-error);
  white-space: nowrap;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.search-toolbar button:not(.toggle) {
  background: transparent;
  border: none;
  color: var(--kira-fg-muted);
  cursor: pointer;
  padding: 0 4px;
}

.search-toolbar button:not(.toggle):hover {
  color: var(--kira-fg);
}
</style>
