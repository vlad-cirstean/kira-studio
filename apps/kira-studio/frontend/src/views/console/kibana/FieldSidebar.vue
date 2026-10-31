<script setup lang="ts">
import type { KibanaField } from '@shared/domain/kibana';
import CodiconIcon from '@theme/CodiconIcon.vue';
import SearchField from '@theme/components/SearchField.vue';
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { t } from '@theme/i18n';
import { rowVariants } from '@theme/lib/rowVariants';
import { useCappedList } from '@workbench/behaviour/cappedList';
import { matchesQuery } from '@workbench/behaviour/match';
import ShowMoreButton from '@workbench/components/ShowMoreButton.vue';
import { computed, ref, watch } from 'vue';

const props = defineProps<{ fields: readonly KibanaField[]; loading: boolean }>();
const emit = defineEmits<{ insert: [field: string]; exists: [field: string] }>();

const STEP = 200;
const ICONS: Record<string, string> = {
  string: 'symbol-string',
  number: 'symbol-numeric',
  date: 'calendar',
  boolean: 'symbol-boolean',
  ip: 'globe',
  geo_point: 'location',
};

const search = ref('');
const matches = computed(() => {
  return props.fields.filter((f) => matchesQuery(f.name, search.value));
});
const { visible, hiddenCount, showMore, reset } = useCappedList(() => matches.value, STEP);
watch(search, reset);
</script>

<template>
  <div class="flex h-full min-h-0 flex-col" data-testid="kibana-field-sidebar">
    <div class="p-2">
      <SearchField
        v-model="search"
        :placeholder="t('studio.kibana.fields.search.placeholder')"
        :aria-label="t('studio.kibana.fields.search.placeholder')"
        data-testid="kibana-field-search"
      />
    </div>
    <ul class="min-h-0 flex-1 overflow-y-auto">
      <li
        v-for="f in visible"
        :key="f.name"
        :class="[rowVariants({ layout: 'tree' }), 'group pl-2']"
        data-testid="kibana-field-row"
      >
        <Tooltip>
          <TooltipTrigger as-child>
            <button
              type="button"
              class="flex h-control min-w-0 flex-1 items-center gap-1.5 text-left text-kira-md"
              :data-testid="`kibana-field-${f.name}`"
              @click="emit('insert', f.name)"
            >
              <CodiconIcon
                :name="ICONS[f.type] ?? 'symbol-field'"
                :size="12"
                class="shrink-0 text-muted-foreground"
              />
              <span class="truncate font-data">{{ f.name }}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>{{ f.type }}</TooltipContent>
        </Tooltip>
        <TooltipIconButton
          icon="add"
          class="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          :label="t('studio.kibana.fields.exists.tooltip', { field: f.name })"
          :data-testid="`kibana-field-exists-${f.name}`"
          @click="emit('exists', f.name)"
        />
      </li>
      <li
        v-if="!loading && matches.length === 0"
        class="px-2 py-1 text-kira-sm text-muted-foreground"
      >
        {{ t('studio.kibana.fields.none.empty') }}
      </li>
    </ul>
    <ShowMoreButton :hidden-count="hiddenCount" :step="STEP" @click="showMore" />
  </div>
</template>
