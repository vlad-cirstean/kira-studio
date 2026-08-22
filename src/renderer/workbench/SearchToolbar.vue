<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import Codicon from '../theme/Codicon.vue';
import { getPage, type Tab } from './state/tabs';

// §8.5 search toolbar (P2 D19): searches ONLY the currently loaded page, in the renderer, never the
// server. Runs in 2 000-row rAF slices with a running match count so a 5 000×40 page cannot stall
// the frame budget. Never mixed with the filter toolbar — the placeholder says so plainly.

const props = defineProps<{ tab: Tab }>();

const query = ref('');
const matchCase = ref(false);
const wholeWord = ref(false);
const regex = ref(false);
const regexError = ref<string | null>(null);

const matches = ref<Array<{ row: number; col: number }>>([]);
const matchIndex = ref(0);
const scanning = ref(false);

const count = computed(() => matches.value.length);
const current = computed(() => (count.value === 0 ? 0 : matchIndex.value + 1));

// rAF-sliced scan.
let raf: number | null = null;
let cancel = false;

function stopScan(): void {
  cancel = true;
  if (raf !== null) cancelAnimationFrame(raf);
  raf = null;
}

function runSearch(): void {
  stopScan();
  const q = query.value;
  matches.value = [];
  matchIndex.value = 0;
  regexError.value = null;
  if (q === '') return;

  let re: RegExp | null = null;
  if (regex.value) {
    try {
      re = new RegExp(q, matchCase.value ? 'g' : 'gi');
    } catch {
      regexError.value = 'invalid regex';
      return;
    }
  }

  const view = getPage(props.tab.id);
  if (!view) return;
  const rows = view.rowCount;
  const cols = view.columns.length;
  let row = 0;
  cancel = false;
  scanning.value = true;

  const slice = (): void => {
    if (cancel) {
      scanning.value = false;
      return;
    }
    const end = Math.min(rows, row + 2000);
    for (; row < end; row++) {
      for (let c = 0; c < cols; c++) {
        const text = view.text(row, c);
        const ok = regex.value && re
          ? matchRegex(re, text)
          : matchText(text, q, matchCase.value, wholeWord.value);
        if (ok) matches.value.push({ row, col: c });
      }
    }
    if (row < rows) {
      raf = requestAnimationFrame(slice);
    } else {
      scanning.value = false;
      if (matches.value.length > 0) matchIndex.value = 0;
    }
  };
  raf = requestAnimationFrame(slice);
}

function matchRegex(re: RegExp, text: string): boolean {
  // Global regexes need lastIndex reset between calls.
  re.lastIndex = 0;
  return re.test(text);
}

function matchText(text: string, q: string, caseSensitive: boolean, whole: boolean): boolean {
  const hay = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? q : q.toLowerCase();
  if (whole) {
    const idx = hay.indexOf(needle);
    if (idx < 0) return false;
    const before = idx === 0 || !isWordChar(hay[idx - 1]);
    const after = idx + needle.length >= hay.length || !isWordChar(hay[idx + needle.length]);
    return before && after;
  }
  return hay.includes(needle);
}

function isWordChar(ch: string): boolean {
  return /[\w$]/.test(ch);
}

function step(dir: 1 | -1): void {
  if (matches.value.length === 0) return;
  matchIndex.value = (matchIndex.value + dir + matches.value.length) % matches.value.length;
  const m = matches.value[matchIndex.value];
  scrollToMatch(m);
}

function scrollToMatch(m: { row: number; col: number }): void {
  const grid = document.querySelector('[data-testid="data-grid"]');
  const view = getPage(props.tab.id);
  if (!grid || !view) return;
  const rowHeight = Number.parseFloat(getComputedStyle(grid).getPropertyValue('--kira-row-height')) || 28;
  const col = view.columns[m.col];
  grid.scrollTop = Math.max(0, m.row * rowHeight - 40);
  if (col) grid.scrollLeft = Math.max(0, col.left - 80);
  // Notify the grid to highlight via a global event (the grid reads this flag).
  window.dispatchEvent(new CustomEvent('kira:search-match', { detail: m }));
}

watch(
  () => [query.value, matchCase.value, wholeWord.value, regex.value] as const,
  () => runSearch(),
);

watch(
  () => getPage(props.tab.id)?.rowCount ?? 0,
  () => runSearch(),
);

onBeforeUnmount(stopScan);
</script>

<template>
  <div class="search-toolbar" data-testid="search-toolbar">
    <Codicon name="search" :size="13" />
    <input
      v-model="query"
      type="text"
      class="query"
      placeholder="Search the loaded page"
      data-testid="search-query"
    />
    <button type="button" class="toggle" :class="{ on: matchCase }" title="Match case" data-testid="search-case" @click="matchCase = !matchCase">
      Aa
    </button>
    <button type="button" class="toggle" :class="{ on: wholeWord }" title="Whole word" data-testid="search-word" @click="wholeWord = !wholeWord">
      <Codicon name="whole-word" :size="12" />
    </button>
    <button type="button" class="toggle" :class="{ on: regex }" title="Regex" data-testid="search-regex" @click="regex = !regex">
      .*
    </button>
    <span v-if="regexError" class="error" data-testid="search-regex-error">{{ regexError }}</span>
    <span v-else class="count" data-testid="search-count">{{ scanning ? '…' : `${current} of ${count}` }}</span>
    <button type="button" class="arrow" title="Previous match" data-testid="search-prev" :disabled="count === 0" @click="step(-1)">
      <Codicon name="arrow-up" :size="12" />
    </button>
    <button type="button" class="arrow" title="Next match" data-testid="search-next" :disabled="count === 0" @click="step(1)">
      <Codicon name="arrow-down" :size="12" />
    </button>
  </div>
</template>

<style scoped>
.search-toolbar {
  position: absolute;
  top: 6px;
  right: 12px;
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 8px;
  background: var(--kira-bg-elevated);
  border: var(--kira-border-width) solid var(--kira-border-strong);
  border-radius: var(--kira-radius);
  box-shadow: var(--kira-shadow);
  color: var(--kira-fg-muted);
}

.query {
  width: 180px;
  height: 20px;
  padding: 0 6px;
  background: var(--kira-bg-input);
  border: var(--kira-border-width) solid var(--kira-border-strong);
  border-radius: var(--kira-radius);
  color: var(--kira-fg);
  font-family: var(--kira-font-family);
  font-size: 12px;
  outline: none;
}

.toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 20px;
  border: none;
  border-radius: var(--kira-radius);
  background: transparent;
  color: var(--kira-fg-muted);
  font-size: 11px;
  cursor: pointer;
}

.toggle.on {
  background: var(--kira-select);
  color: var(--kira-fg);
}

.count {
  font-size: 11px;
  color: var(--kira-fg-muted);
  min-width: 52px;
  text-align: center;
}

.error {
  font-size: 11px;
  color: var(--kira-error);
}

.arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: var(--kira-radius);
  background: transparent;
  color: var(--kira-fg-muted);
  cursor: pointer;
}

.arrow:hover:not(:disabled) {
  background: var(--kira-hover);
  color: var(--kira-fg);
}

.arrow:disabled {
  color: var(--kira-fg-disabled);
  cursor: default;
}
</style>
