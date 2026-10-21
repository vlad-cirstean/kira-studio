<script setup lang="ts">
import type { BaseCandidate, BaseResolution, BaseResolutionReason } from '@kira/git-ipc';
import CodiconIcon from '@theme/CodiconIcon.vue';
/**
 * "shown in the view's header as a picker — never as static text —
 * naming the base and how it was resolved ('upstream', 'default branch')." The trigger names the
 * current base (or "Choose a base…" while `reason: "none"`) plus a quiet reason label; the
 * dropdown has two sections — Suggested (`resolution.candidates`, each carrying its own reason)
 * and All branches (`refsState`'s own branches/remote-tracking branches, through the same
 * `refListModel.ts` fold `BranchPicker.vue` uses, so the two lists sort/filter/cap identically).
 * Tags are never offered here — `<base>..<branch>` is a question about two branches,
 * mirroring the "not offered for tags" rule on the row menu's own entry.
 */
import InlineState from '@theme/components/InlineState.vue';
import PickerTrigger from '@theme/components/PickerTrigger.vue';
import SearchField from '@theme/components/SearchField.vue';
import SectionHeading from '@theme/components/SectionHeading.vue';
import { Popover, PopoverContent, PopoverTrigger } from '@theme/components/ui/popover';
import { t } from '@theme/i18n';
import { rowMeta, rowVariants } from '@theme/lib/rowVariants';
import { cn } from '@theme/lib/utils';
import { computed, ref, useTemplateRef } from 'vue';
import { buildRefListSections } from '../../lib/refListModel.ts';
import { useFieldFocus } from '../../lib/useFieldFocus.ts';
import type { RefsState } from '../../state/refs.ts';

const props = defineProps<{
  resolution: BaseResolution | undefined;
  refsState: RefsState;
}>();

const emit = defineEmits<(e: 'select', ref: string) => void>();

/** `"override"` and `"none"` both render nothing — an overridden base needs no explanation of
 *  where it came from, and `reason: "none"` never reaches this (paired only with `base: null`,
 *  which the trigger already renders as the placeholder text rather than a labelled name). */
function reasonLabel(reason: BaseResolutionReason): string | undefined {
  switch (reason) {
    case 'upstream':
      return t('git.review.base.reasonUpstream.label');
    case 'defaultBranch':
      return t('git.review.base.reasonDefaultBranch.label');
    case 'override':
    case 'none':
      return undefined;
  }
}

const triggerLabel = computed(() => props.resolution?.base ?? t('git.review.base.choose.label'));
const triggerReason = computed(() => {
  const resolution = props.resolution;
  if (!resolution || resolution.base === null) return undefined;
  return reasonLabel(resolution.reason);
});

const isOpen = ref(false);
const filter = ref('');
// P131 Part 3 §5.2: reka's modal Popover owns focus trap, outside-click and Escape, and returns
// focus to the trigger on close — the same contract `useModalFocus`/`onClickOutside`/the rootEl
// Escape listener existed to provide by hand.
const filterEl = useTemplateRef<{ $el: Element }>('filterEl');
const focusFilter = useFieldFocus(filterEl);

function open(): void {
  isOpen.value = true;
}

function close(): void {
  isOpen.value = false;
  filter.value = '';
}

const sections = computed(() =>
  buildRefListSections(
    {
      branches: props.refsState.branches.value,
      remoteBranches: props.refsState.remoteBranches.value,
      tags: [],
    },
    filter.value,
  ),
);

/** `head` stays `undefined` until the first `refs.list` lands (and after a repo switch), so an
 *  empty list then means "not loaded yet", not "no branch matches". */
const refsLoading = computed(() => props.refsState.head.value === undefined);
const hiddenCount = computed(
  () => sections.value.branches.hiddenCount + sections.value.remoteBranches.hiddenCount,
);

/** The candidate shortlist minus whichever entry is already the current base — picking it again
 *  would be a no-op re-resolve for nothing the user could see change. */
const suggested = computed<readonly BaseCandidate[]>(() => {
  const current = props.resolution?.base;
  return (props.resolution?.candidates ?? []).filter((c) => c.ref !== current);
});

function candidateReason(candidate: BaseCandidate): string {
  return reasonLabel(candidate.reason) ?? '';
}

function pick(ref: string): void {
  close();
  emit('select', ref);
}

/** §5.2: reka's own default (the panel's first focusable element) loses to the filter input
 *  explicitly, mirroring BranchPicker.vue's own `onOpenAutoFocus`. */
function onOpenAutoFocus(e: Event): void {
  e.preventDefault();
  focusFilter();
}
</script>

<template>
  <div class="relative">
    <Popover modal :open="isOpen" @update:open="(o) => (o ? open() : close())">
      <PopoverTrigger as-child>
        <PickerTrigger size="kira" data-testid="base-selector-trigger">
          {{ triggerLabel }}
          <span v-if="triggerReason" :class="rowMeta">{{ triggerReason }}</span>
        </PickerTrigger>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        class="w-80 p-0 gap-0"
        :aria-label="t('git.review.base.popover.aria')"
        @open-auto-focus="onOpenAutoFocus"
      >
        <div class="max-h-80 flex flex-col min-h-0">
          <div class="m-1">
            <SearchField
              ref="filterEl"
              v-model="filter"
              :placeholder="t('git.picker.filterBranches.placeholder')"
              :aria-label="t('git.picker.filterBranches.placeholder')"
            />
          </div>
          <div class="overflow-auto min-h-0">
            <section v-if="suggested.length > 0" :aria-label="t('git.review.base.suggested.label')">
              <SectionHeading :label="t('git.review.base.suggested.label')" />
              <button
                v-for="candidate in suggested"
                :key="candidate.ref"
                type="button"
                :class="cn(rowVariants(), 'w-full')"
                @click="pick(candidate.ref)"
              >
                <span class="truncate">{{ candidate.ref }}</span>
                <span :class="cn('ml-auto', rowMeta)">{{ candidateReason(candidate) }}</span>
              </button>
            </section>

            <section :aria-label="t('git.review.base.allBranches.label')">
              <SectionHeading :label="t('git.review.base.allBranches.label')" />
              <button
                v-for="row in sections.branches.visible"
                :key="row.refname"
                type="button"
                :class="cn(rowVariants(), 'w-full')"
                @click="pick(row.shortName)"
              >
                <span class="truncate">{{ row.shortName }}</span>
              </button>
              <button
                v-for="row in sections.remoteBranches.visible"
                :key="row.refname"
                type="button"
                :class="cn(rowVariants(), 'w-full')"
                @click="pick(row.shortName)"
              >
                <CodiconIcon name="cloud" :size="13" />
                <span class="truncate">{{ row.shortName }}</span>
              </button>
              <InlineState v-if="hiddenCount > 0" kind="empty" data-testid="base-selector-hidden">
                {{ t('git.review.base.hidden.hint', { count: hiddenCount }) }}
              </InlineState>
              <InlineState
                v-if="sections.branches.visible.length === 0 && sections.remoteBranches.visible.length === 0"
                :kind="refsLoading ? 'loading' : 'empty'"
              >
                {{
                  refsLoading ? t('git.review.base.loading.loading') : t('common.state.noMatches.empty')
                }}
              </InlineState>
            </section>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  </div>
</template>
