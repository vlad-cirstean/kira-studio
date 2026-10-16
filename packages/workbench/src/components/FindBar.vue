<script setup lang="ts">
import SearchField from '@theme/components/SearchField.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { t } from '@theme/i18n';
import { useFocus } from '@vueuse/core';
import { computed, useTemplateRef } from 'vue';
import { useFindBar } from '../behaviour/findBar';
import { useFocusOnMount } from '../behaviour/focus';
import ViewToolbar from './ViewToolbar.vue';

defineOptions({ inheritAttrs: false });

// The one find bar shell: search field, option toggles, match count, previous/next, close. The
// view owns the matcher and the count; this wires Enter, Shift+Enter, Escape and the debounced
// query. Mounted fresh each time the bar opens, so mount hands the field focus.
const props = defineProps<{
  /** 1-based current match; 0 with `total` 0 reads as no matches. */
  position: number;
  total: number;
  /** Prefix of every testid: `<prefix>bar`, `input`, `count`, `prev`, `next`, `close`. */
  testidPrefix: string;
  invalid?: boolean;
  placeholder?: string;
}>();

const query = defineModel<string>({ required: true });

const emit = defineEmits<{
  /** The query, once typing pauses for `TIMING.search`. */
  query: [query: string];
  next: [];
  prev: [];
  close: [];
}>();

const rootEl = useTemplateRef<InstanceType<typeof ViewToolbar>>('rootEl');
useFindBar({
  root: rootEl,
  query,
  onQuery: (q) => emit('query', q),
  next: () => emit('next'),
  prev: () => emit('prev'),
  close: () => emit('close'),
});

const fieldWrap = useTemplateRef<HTMLElement>('fieldWrap');
useFocusOnMount(computed(() => fieldWrap.value?.querySelector('input')));

const countText = computed(() =>
  props.total === 0
    ? t('common.state.noMatches.empty')
    : t('common.matchPosition.status', { position: props.position, total: props.total }),
);

const { focused } = useFocus(computed(() => fieldWrap.value?.querySelector('input')));

defineExpose({
  focus: () => {
    focused.value = true;
  },
});
</script>

<template>
  <!-- biome-ignore lint/a11y/useSemanticElements: vue-tsc reports <search> as an unresolved component -->
  <div role="search" class="contents" :aria-label="t('workbench.findBar.region.aria')">
    <ViewToolbar
      ref="rootEl"
      class="bg-elevated"
      v-bind="$attrs"
      :data-testid="`${testidPrefix}bar`"
    >
      <div ref="fieldWrap" class="w-52 shrink-0">
        <SearchField
          v-model="query"
          :placeholder="placeholder ?? t('common.action.find.label')"
          :aria-invalid="invalid"
          :data-testid="`${testidPrefix}input`"
        />
      </div>
      <div class="flex items-center gap-1.5 min-w-0">
        <slot name="options" />
      </div>
      <span
        class="text-kira-sm text-muted-foreground whitespace-nowrap"
        :data-testid="`${testidPrefix}count`"
      >
        <slot name="count" :text="countText">{{ countText }}</slot>
      </span>
      <TooltipIconButton
        icon="chevron-up"
        :label="t('common.action.previousMatch.label')"
        :data-testid="`${testidPrefix}prev`"
        @click="emit('prev')"
      />
      <TooltipIconButton
        icon="chevron-down"
        :label="t('common.action.nextMatch.label')"
        :data-testid="`${testidPrefix}next`"
        @click="emit('next')"
      />
      <TooltipIconButton
        icon="close"
        :label="t('common.action.close.label')"
        class="ml-auto"
        :data-testid="`${testidPrefix}close`"
        @click="emit('close')"
      />
    </ViewToolbar>
  </div>
</template>
