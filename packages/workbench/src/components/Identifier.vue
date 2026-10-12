<script setup lang="ts">
import TooltipIconButton from '@theme/components/TooltipIconButton.vue';
import TruncatedText from '@theme/components/TruncatedText.vue';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { t } from '@theme/i18n';
import { useResizeObserver } from '@vueuse/core';
import { computed, ref, useTemplateRef } from 'vue';
import { useCopy } from '../behaviour/clipboard';

// An id, sha, branch, ref or path shown as a value: always `font-data`, truncated with a tooltip
// for the full text, optionally shortened and copyable.
const props = defineProps<{
  value: string;
  /** `path` keeps the file name visible and truncates the directory instead. */
  split?: 'path';
  /** Shortens the shown text (`shortSha`, a docker short id); the tooltip and copy keep `value`. */
  short?: (value: string) => string;
  /** Adds a trailing copy button that copies `value`. */
  copyable?: boolean;
}>();

const shown = computed(() => (props.short ? props.short(props.value) : props.value));
const parts = computed(() => {
  const at = shown.value.lastIndexOf('/');
  return at < 0
    ? { dir: '', name: shown.value }
    : { dir: shown.value.slice(0, at + 1), name: shown.value.slice(at + 1) };
});

const dirEl = useTemplateRef<HTMLElement>('dirEl');
const dirCut = ref(false);
useResizeObserver(dirEl, () => {
  const node = dirEl.value;
  dirCut.value = node !== null && node.scrollWidth > node.clientWidth;
});

const { copy, copied } = useCopy();
</script>

<template>
  <span class="inline-flex min-w-0 items-center gap-1 font-data">
    <Tooltip v-if="split === 'path'" :disabled="!dirCut">
      <TooltipTrigger as-child>
        <span class="flex min-w-0">
          <span ref="dirEl" class="min-w-0 truncate">{{ parts.dir }}</span>
          <span class="shrink-0">{{ parts.name }}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent>{{ value }}</TooltipContent>
    </Tooltip>
    <TruncatedText v-else :text="value"><slot>{{ shown }}</slot></TruncatedText>
    <TooltipIconButton
      v-if="copyable"
      :icon="copied ? 'check' : 'copy'"
      :label="t('workbench.identifier.copy.label')"
      class="shrink-0"
      @click="copy(value)"
    />
  </span>
</template>
