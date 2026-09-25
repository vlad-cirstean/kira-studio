<script setup lang="ts">
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';

// P113 F3: the match-case/whole-word/regex toggle trio — identical icons, labels, active-state
// class and toggle shape — repeated across SearchToolbar.vue (the data views' find widget),
// ResponseFindBar.vue (the HTTP response find widget) and kira-space's RepoSearchView.vue. A plain
// fragment, not its own wrapping div: each caller's own wrapper already differs slightly (gap,
// items-center, min-w-0), and reproducing one here would be a visual change nobody asked for —
// this only replaces the three buttons themselves.
defineProps<{
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
  /** Prepended to `match-case`/`whole-word`/`regex` for two of the three testids. Every site's own
   *  testid already follows `${prefix}whole-word` / `${prefix}regex` (SearchToolbar.vue:
   *  `${testidPrefix}search-`, ResponseFindBar.vue: `'http-find-'`, RepoSearchView.vue:
   *  `'repo-search-'`) — only match-case needs its own override below (RepoSearchView.vue's own
   *  testid there is `repo-search-case`, not `repo-search-match-case`). */
  testidPrefix?: string;
  /** Overrides `${testidPrefix}match-case` for the one site whose match-case testid doesn't follow
   *  that pattern. */
  matchCaseTestId?: string;
}>();

defineEmits<{
  'update:matchCase': [value: boolean];
  'update:wholeWord': [value: boolean];
  'update:regex': [value: boolean];
}>();
</script>

<template>
  <TooltipIconButton
    icon="case-sensitive"
    label="Match case"
    :class="{ 'bg-field text-fg': matchCase }"
    :data-testid="matchCaseTestId ?? `${testidPrefix ?? ''}match-case`"
    @click="$emit('update:matchCase', !matchCase)"
  />
  <TooltipIconButton
    icon="whole-word"
    label="Whole word"
    :class="{ 'bg-field text-fg': wholeWord }"
    :data-testid="`${testidPrefix ?? ''}whole-word`"
    @click="$emit('update:wholeWord', !wholeWord)"
  />
  <TooltipIconButton
    icon="regex"
    label="Regular expression"
    :class="{ 'bg-field text-fg': regex }"
    :data-testid="`${testidPrefix ?? ''}regex`"
    @click="$emit('update:regex', !regex)"
  />
</template>
