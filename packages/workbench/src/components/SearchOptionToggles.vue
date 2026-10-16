<script setup lang="ts">
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { t } from '@theme/i18n';

// The match-case/whole-word/regex toggle trio shared by every find and search widget. A plain
// fragment, not a wrapping element: each caller's wrapper differs (gap, items-center, min-w-0).
defineProps<{
  /** Prepended to `match-case`/`whole-word`/`regex` for the testids. */
  testidPrefix?: string;
  /** Overrides `${testidPrefix}match-case` for the one site whose testid does not follow that. */
  matchCaseTestid?: string;
}>();

const matchCase = defineModel<boolean>('matchCase', { required: true });
const wholeWord = defineModel<boolean>('wholeWord', { required: true });
const regex = defineModel<boolean>('regex', { required: true });
</script>

<template>
  <TooltipIconButton
    icon="case-sensitive"
    :label="t('workbench.search.matchCase.label')"
    :pressed="matchCase"
    :data-testid="matchCaseTestid ?? `${testidPrefix ?? ''}match-case`"
    @click="matchCase = !matchCase"
  />
  <TooltipIconButton
    icon="whole-word"
    :label="t('workbench.search.wholeWord.label')"
    :pressed="wholeWord"
    :data-testid="`${testidPrefix ?? ''}whole-word`"
    @click="wholeWord = !wholeWord"
  />
  <TooltipIconButton
    icon="regex"
    :label="t('workbench.search.regex.label')"
    :pressed="regex"
    :data-testid="`${testidPrefix ?? ''}regex`"
    @click="regex = !regex"
  />
</template>
