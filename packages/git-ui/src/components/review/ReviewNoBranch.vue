<script setup lang="ts">
import { t } from '@theme/i18n';
import BranchPicker from '@workbench/components/pickers/BranchPicker.vue';
import { computed } from 'vue';
import { branchGroups, branchOptions } from '../../lib/refOptions.ts';
import type { RefsState } from '../../state/refs.ts';

const props = defineProps<{ refsState: RefsState }>();
const emit = defineEmits<(e: 'pick', name: string) => void>();

const branches = computed(() => branchOptions(props.refsState, { remote: true }));
</script>

<template>
  <div class="flex flex-col gap-1 p-3 min-h-0 h-full" data-testid="review-no-branch">
    <h2 class="text-kira-lg font-medium text-fg">{{ t('git.review.start.title') }}</h2>
    <p class="text-muted-foreground">{{ t('git.review.noBranch.emptyHint') }}</p>
    <BranchPicker
      inline
      class="min-h-0 flex-1"
      testid="review-branch"
      :branches="branches"
      :groups="branchGroups()"
      :placeholder="t('common.action.choose.label')"
      :loading="refsState.head.value === undefined"
      @select="(o) => emit('pick', o.value)"
    />
  </div>
</template>
