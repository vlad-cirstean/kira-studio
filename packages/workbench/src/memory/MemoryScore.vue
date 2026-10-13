<script setup lang="ts">
import type { MemoryScore } from '@shared/domain/memory';
import { Badge } from '@theme/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { type MessageKey, t } from '@theme/i18n';
import { formatScore } from '@theme/i18n/number';
import { computed } from 'vue';

// P275: the rank score of a search result, with the parts that built it in the tooltip. Neutral
// boosts (1.00) are left out.
const props = defineProps<{ score: MemoryScore }>();

const SCOPE_PART = {
  project: 'memory.score.scopeProject.label',
  company: 'memory.score.scopeCompany.label',
  'other-project': 'memory.score.scopeOtherProject.label',
} as const satisfies Record<string, MessageKey>;

const parts = computed(() => {
  const s = props.score;
  const out = [t('memory.score.keyword.label', { value: formatScore(s.keyword) })];
  if (s.semantic > 0)
    out.push(t('memory.score.semantic.label', { value: formatScore(s.semantic) }));
  const boosts: [MessageKey, number][] = [
    ['memory.score.grade.label', s.grade],
    ['memory.score.recency.label', s.recency],
    ['memory.score.history.label', s.history],
    ['memory.score.group.label', s.group],
  ];
  if (s.boost && s.boost !== 'personal') boosts.unshift([SCOPE_PART[s.boost], s.scope]);
  for (const [key, value] of boosts) {
    if (formatScore(value) !== '1.00') out.push(t(key, { value: formatScore(value) }));
  }
  return out;
});
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <Badge
        class="font-data"
        :aria-label="t('memory.score.badge.aria', { value: formatScore(score.total) })"
        data-testid="memory-row-score"
        >{{
          formatScore(score.total)
        }}</Badge
      >
    </TooltipTrigger>
    <TooltipContent data-testid="memory-score-parts">
      <ul class="flex flex-col">
        <li v-for="part in parts" :key="part">{{ part }}</li>
      </ul>
    </TooltipContent>
  </Tooltip>
</template>
