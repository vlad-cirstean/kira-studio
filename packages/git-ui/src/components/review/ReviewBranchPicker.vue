<script setup lang="ts">
import InlineState from '@theme/components/InlineState.vue';
import SearchField from '@theme/components/SearchField.vue';
import SectionHeading from '@theme/components/SectionHeading.vue';
import { t } from '@theme/i18n';
import { rowIndent, rowVariants } from '@theme/lib/rowVariants';
import { cn } from '@theme/lib/utils';
import { computed, nextTick, onMounted, ref, useTemplateRef } from 'vue';
import { buildRefListSections } from '../../lib/refListModel.ts';
import { useFieldFocus } from '../../lib/useFieldFocus.ts';
import type { RefsState } from '../../state/refs.ts';

// The review view's "no branch" state: pick the branch to review. `refListModel`'s fold over
// `refs.list`, tags excluded (a tag is a point, not a line of development).
const props = defineProps<{ refsState: RefsState }>();
const emit = defineEmits<{ pick: [name: string] }>();

const filter = ref('');
const filterInput = useTemplateRef<{ $el: Element }>('filterInput');
const focusFilter = useFieldFocus(filterInput);
onMounted(() => void nextTick(focusFilter));

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
</script>

<template>
  <div class="flex flex-col gap-1 p-3 min-h-0 h-full" data-testid="review-no-branch">
    <h2 class="text-kira-lg font-medium text-fg">{{ t('git.review.start.title') }}</h2>
    <p class="text-muted-foreground">
      {{ t('git.review.noBranch.emptyHint') }}
    </p>
    <SearchField
      ref="filterInput"
      v-model="filter"
      :placeholder="t('git.picker.filterBranches.placeholder')"
      :aria-label="t('git.picker.filterBranches.placeholder')"
    />
    <div class="flex-1 min-h-0 overflow-auto">
      <div>
        <SectionHeading :label="t('common.module.branches.label')" />
        <button
          v-for="row in sections.branches.visible"
          :key="row.refname"
          type="button"
          :class="cn(rowVariants({ layout: 'tree' }), 'w-full text-left')"
          :style="rowIndent(0)"
          @click="emit('pick', row.shortName)"
        >
          {{ row.shortName }}
        </button>
        <InlineState v-if="sections.branches.visible.length === 0" kind="empty">
          {{ t('common.state.noMatches.empty') }}
        </InlineState>
      </div>
      <div>
        <SectionHeading :label="t('git.picker.remoteBranches.label')" />
        <button
          v-for="row in sections.remoteBranches.visible"
          :key="row.refname"
          type="button"
          :class="cn(rowVariants({ layout: 'tree' }), 'w-full text-left')"
          :style="rowIndent(0)"
          @click="emit('pick', row.shortName)"
        >
          {{ row.shortName }}
        </button>
      </div>
    </div>
  </div>
</template>
