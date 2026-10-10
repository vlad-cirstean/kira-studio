<script setup lang="ts">
/**
 * `docs/plans/P11.md` W12: the grouped dropdown `SearchBox.vue` renders inside its own `Popover`
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
 *
 * P131 Part 2 §5.3: positioning, backdrop and Escape/click-outside handling all moved onto
 * `SearchBox.vue`'s own `Popover` — this file no longer owns any of that (its own outer box
 * classes, `w-105`/`max-h-90`/`overflow-y-auto`/`py-0.5`, moved onto `PopoverContent` there too),
 * rendering only the inner listbox content.
 */
import { Badge } from '@theme/components/ui/badge';
import { Button } from '@theme/components/ui/button';
import { cn } from '@theme/lib/utils';
import { computed } from 'vue';
import { rowVariants } from '../lib/rowVariants.ts';
import { formatRelativeDate } from './dateFormat.ts';
import { SEARCH_LISTBOX_ID } from './searchListboxId.ts';
import type { SearchOption, SearchResultsModel } from './searchResultsModel.ts';
import { fieldLabel } from './searchResultsModel.ts';

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

/** P110 A17: `.kv-search-option`'s own gap/px are already exactly `rowVariants()`'s own
 *  `gap-1`/`px-1.5` (P110 I2-29: the default spacing scale directly).
 *  Only the vertical padding and the "active" (keyboard-highlighted, not a real `:hover`)
 *  background need adding —
 *  through `cn()` since `px-2` below replaces the variant's own `px-1.5` (different value,
 *  same property; §1.3). */
function optionClass(option: SearchOption): string {
  return cn(
    rowVariants({ layout: 'tree' }),
    'pl-2',
    option.id === props.highlightedId ? 'bg-hover' : '',
  );
}
</script>

<template>
  <div data-testid="search-results">
    <!-- ARIA's listbox role only permits `option`/`group` children (`aria-required-children`) —
         the status line, section titles and options live inside this inner listbox div; the
         stale hint, footers and the body-search button are its *siblings*, not its children. -->
    <div :id="SEARCH_LISTBOX_ID" role="listbox" aria-label="Search results">
      <div
        v-if="searching"
        class="text-kira-sm text-subtle py-1 px-1.5"
        data-testid="search-status"
      >
        Searching…
      </div>

      <template v-for="section in model.sections" :key="section.title">
        <div class="h-control-sm flex items-center px-1.5 text-kira-sm text-subtle uppercase tracking-wider">
          {{ section.title }} <span class="font-normal">({{ section.options.length }})</span>
        </div>

        <template v-for="option in section.options" :key="option.id">
          <div
            :id="option.id"
            role="option"
            :class="optionClass(option)"
            :aria-selected="option.id === highlightedId"
            tabindex="-1"
            @click="emit('select', option)"
            @mouseenter="emit('hover', option)"
            @keydown.enter="emit('select', option)"
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
              <span class="flex-1 min-w-0 truncate">{{ option.hit.ref.shortName }}</span>
              <Badge v-if="fieldLabel(option.hit.fields)">{{ fieldLabel(option.hit.fields) }}</Badge>
            </template>
            <template v-else>
              <span class="font-data text-muted-foreground">{{ option.hit.sha.slice(0, 7) }}</span>
              <span class="flex-1 min-w-0 truncate">{{ option.hit.subject }}</span>
              <span class="text-muted-foreground text-kira-sm">{{ option.hit.authorName }}</span>
              <span class="text-muted-foreground text-kira-sm">{{ formatRelativeDate(option.hit.authorTime) }}</span>
              <Badge v-if="fieldLabel(option.hit.fields)">{{ fieldLabel(option.hit.fields) }}</Badge>
            </template>
          </div>
        </template>
        <div v-if="section.hiddenCount > 0" class="text-kira-sm text-subtle py-1 px-1.5">
          {{ section.hiddenCount }} more — refine your search
        </div>
      </template>

      <div v-if="isEmpty" class="text-kira-sm text-subtle py-1 px-1.5">No results</div>
    </div>

    <div
      v-if="tailStale"
      class="text-kira-sm text-subtle py-1 px-1.5"
      data-testid="search-tail-stale"
    >
      Refs changed since this search ran
    </div>
    <div v-if="model.loadedFooter" class="text-kira-sm text-subtle py-1 px-1.5">
      {{ model.loadedFooter }}
    </div>
    <div v-if="model.tailFooter" class="text-kira-sm text-subtle py-1 px-1.5">
      {{ model.tailFooter }}
    </div>
    <div
      v-if="model.tailNotice"
      class="text-kira-sm text-subtle py-1 px-1.5"
      data-testid="search-tail-notice"
    >
      {{ model.tailNotice }}
    </div>
    <Button
      v-if="showBodySearchAffordance"
      variant="toolbar"
      size="kira"
      class="w-full justify-start"
      data-testid="search-body-button"
      @click="emit('runBodySearch')"
    >
      Search message bodies
    </Button>
  </div>
</template>
