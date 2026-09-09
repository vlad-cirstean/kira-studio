<script lang="ts">
/** `SearchBox.vue`'s own `aria-controls` names this id (P11 W20 a11y pass) — the combobox
 *  pattern's own required-attribute, missing until then. A stable export rather than two files
 *  independently agreeing on the same string literal. `<script setup>` cannot itself carry a
 *  named export, so this one constant lives in a plain sibling `<script>` block instead. */
export const SEARCH_LISTBOX_ID = 'kv-search-listbox';
</script>

<script setup lang="ts">
/**
 * `docs/plans/P11.md` W12: the grouped dropdown `SearchBox.vue` renders inside its own panel
 * (the same nesting `BranchPicker.vue` uses for `TagList.vue`/`StashList.vue`) — refs first
 * (local / remote / tag subsections, each labelled), then commits, each hit showing its kind and,
 * when it matched somewhere other than the subject or ref name, a field label. `role="listbox"`
 * with `aria-activedescendant` set on the *input* (`SearchBox.vue`'s own, per the ARIA combobox
 * pattern — this file never moves DOM focus onto a row), so option elements here carry no
 * `tabindex` of their own and clicking one never blurs the input; `searchResultsModel.ts` owns
 * every grouping/ordering/cap decision, this file only renders it.
 *
 * Keyboard (arrow-key nav, `Enter` to select, `Escape` to close) lives in `SearchBox.vue` — the
 * element that actually holds focus throughout — not here; this file only reflects
 * `highlightedId` back as `aria-selected` and forwards a click as `select`.
 */
import { computeFloatPosition, KuiButton } from "@kira/kira-ui";
import { computed, nextTick, onMounted, ref } from "vue";
import { formatRelativeDate } from "./dateFormat.ts";
import type { SearchOption, SearchResultsModel } from "./searchResultsModel.ts";
import { fieldLabel } from "./searchResultsModel.ts";

const props = defineProps<{
  model: SearchResultsModel;
  highlightedId: string | undefined;
  searching: boolean;
  tailStale: boolean;
  showBodySearchAffordance: boolean;
}>();

const emit = defineEmits<{
  (e: "select", option: SearchOption): void;
  (e: "hover", option: SearchOption): void;
  (e: "runBodySearch"): void;
}>();

const isEmpty = computed(() => props.model.sections.length === 0);

// G20 D5, deviation: the plan's own file-by-file table calls for wrapping this in
// `KuiPopoverPanel`, like the other 6 dropdowns — but this one, uniquely among the 7, is an ARIA
// combobox listbox (see the file's own doc comment): `SearchBox.vue`'s `<input>` must keep real
// DOM focus the whole time this is open, and its own Escape handling (a two-stage
// dismiss-then-clear, OQ5) is bound directly to that input, not to a document-level listener.
// `KuiPopoverPanel`'s own document-level, capture-phase Escape handler would intercept every
// Escape keystroke before it ever reaches the input's own bubble-phase handler, silently
// replacing that two-stage behaviour with a plain close — the exact "positioning-coupled
// interaction logic" §7 item 2 anticipated as a reason to special-case one of the 7 rather than
// force it through the shared wrapper. Positioned directly via `computeFloatPosition` instead —
// real flip/shift, no backdrop, no Escape/click-outside handling of its own (both already live in
// `SearchBox.vue`, untouched) — anchored to this component's own DOM parent (`SearchBox.vue`'s
// `rootEl`), the same "read the wrapper, no prop needed" trick `KuiPopoverPanel` itself uses.
const resultsEl = ref<HTMLElement | null>(null);
const resultsStyle = ref({ left: '-9999px', top: '-9999px' });

async function reposition(): Promise<void> {
  await nextTick();
  const el = resultsEl.value;
  const anchor = el?.parentElement;
  if (!el || !anchor) return;
  const { left, top } = await computeFloatPosition(anchor, el, { placement: 'bottom-start' });
  resultsStyle.value = { left: `${left}px`, top: `${top}px` };
}

onMounted(() => void reposition());
</script>

<template>
  <div ref="resultsEl" class="kv-search-results" data-testid="search-results" :style="resultsStyle">
    <!-- ARIA's listbox role only permits `option`/`group` children (`aria-required-children`) —
         the status line, section titles and options live inside this inner listbox div; the
         stale hint, footers and the body-search button are its *siblings*, not its children. -->
    <div :id="SEARCH_LISTBOX_ID" role="listbox" aria-label="Search results">
      <div v-if="searching" class="kv-search-status" data-testid="search-status">Searching…</div>

      <template v-for="section in model.sections" :key="section.title">
        <div class="kv-search-section-title">
          {{ section.title }} <span class="kv-search-section-count">({{ section.options.length }})</span>
        </div>

        <template v-for="option in section.options" :key="option.id">
          <div
            :id="option.id"
            role="option"
            class="kv-search-option"
            :class="{ 'kv-search-option--active': option.id === highlightedId }"
            :aria-selected="option.id === highlightedId"
            @click="emit('select', option)"
            @mouseenter="emit('hover', option)"
          >
            <template v-if="option.kind === 'ref'">
              <span
                class="codicon"
                :class="{
                  'codicon-git-branch': option.hit.ref.kind === 'branch',
                  'codicon-cloud': option.hit.ref.kind === 'remoteBranch',
                  'codicon-tag': option.hit.ref.kind === 'tag',
                }"
                aria-hidden="true"
              ></span>
              <span class="kv-search-option-main">{{ option.hit.ref.shortName }}</span>
              <span v-if="fieldLabel(option.hit.fields)" class="kv-search-option-field">
                {{ fieldLabel(option.hit.fields) }}
              </span>
            </template>
            <template v-else>
              <span class="kv-search-option-sha">{{ option.hit.sha.slice(0, 7) }}</span>
              <span class="kv-search-option-main">{{ option.hit.subject }}</span>
              <span class="kv-search-option-author">{{ option.hit.authorName }}</span>
              <span class="kv-search-option-date">{{ formatRelativeDate(option.hit.authorTime) }}</span>
              <span v-if="fieldLabel(option.hit.fields)" class="kv-search-option-field">
                {{ fieldLabel(option.hit.fields) }}
              </span>
            </template>
          </div>
        </template>
        <div v-if="section.hiddenCount > 0" class="kv-search-more">
          {{ section.hiddenCount }} more — refine your search
        </div>
      </template>

      <div v-if="isEmpty" class="kv-search-empty">No results</div>
    </div>

    <div v-if="tailStale" class="kv-search-hint" data-testid="search-tail-stale">
      Refs changed since this search ran
    </div>
    <div v-if="model.loadedFooter" class="kv-search-footer">{{ model.loadedFooter }}</div>
    <div v-if="model.tailFooter" class="kv-search-footer">{{ model.tailFooter }}</div>
    <div v-if="model.tailNotice" class="kv-search-footer" data-testid="search-tail-notice">
      {{ model.tailNotice }}
    </div>
    <KuiButton
      v-if="showBodySearchAffordance"
      class="kv-search-body-button"
      data-testid="search-body-button"
      @click="emit('runBodySearch')"
    >
      Search message bodies
    </KuiButton>
  </div>
</template>

<style>
/* G20 D5: real flip/shift positioning (see the script's own doc comment for why this is
   positioned directly rather than through KuiPopoverPanel, unlike the other 6 dropdowns). */
.kv-search-results {
  position: fixed;
  z-index: var(--kui-z-popover, 20);
  width: 420px;
  max-height: 360px;
  overflow-y: auto;
  padding: var(--kv-s-1) 0;
  background-color: var(--kv-panel-bg);
  color: var(--kv-app-fg);
  border: 1px solid var(--kv-panel-border);
  border-radius: var(--kv-radius-sm);
  box-shadow: 0 2px 8px var(--kv-widget-shadow);
}

.kv-search-status {
  padding: var(--kv-s-1) var(--kv-s-4);
  color: var(--kv-description-fg);
  font-size: 0.85em;
}

.kv-search-section-title {
  padding: var(--kv-s-1) var(--kv-s-4);
  font-size: 0.85em;
  font-weight: 600;
  color: var(--kv-description-fg);
}

.kv-search-section-count {
  font-weight: 400;
}

.kv-search-option {
  display: flex;
  align-items: center;
  gap: var(--kv-s-2);
  padding: var(--kv-s-1) var(--kv-s-4);
  cursor: pointer;
  white-space: nowrap;
}

.kv-search-option:hover,
.kv-search-option--active {
  background-color: var(--kv-row-hover-bg);
}

.kv-search-option-main {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.kv-search-option-sha {
  font-family: var(--kv-mono-font-family);
  color: var(--kv-description-fg);
}

.kv-search-option-author,
.kv-search-option-date {
  color: var(--kv-description-fg);
  font-size: 0.9em;
}

.kv-search-option-field {
  padding: 0 var(--kv-s-1);
  color: var(--kv-description-fg);
  font-size: 0.8em;
  border: 1px dashed var(--kv-panel-border);
  border-radius: var(--kv-radius-sm);
}

.kv-search-more,
.kv-search-empty,
.kv-search-hint,
.kv-search-footer {
  padding: var(--kv-s-1) var(--kv-s-4);
  color: var(--kv-description-fg);
  font-size: 0.85em;
}

.kv-search-body-button {
  display: block;
  width: 100%;
  text-align: left;
}
</style>
