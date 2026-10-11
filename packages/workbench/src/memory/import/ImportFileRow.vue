<script setup lang="ts">
import type { ImportFile } from '@shared/domain/memoryImport';
import { rowVariants } from '@theme/components/rowVariants';
import { Badge } from '@theme/components/ui/badge';
import { Button } from '@theme/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { t } from '@theme/i18n';
import { cn } from '@theme/lib/utils';
import { computed } from 'vue';
import { FILE_STATE_LABEL } from './importFormat';

// P211: one file of an import — fixed height, the virtualized list's row.
const props = defineProps<{ file: ImportFile; selected: boolean }>();
const emit = defineEmits<{ select: []; retry: [] }>();

const variant = computed(() => {
  switch (props.file.state) {
    case 'done':
      return 'ok';
    case 'failed':
      return 'error';
    case 'skipped':
    case 'cancelled':
      return 'default';
    default:
      return 'info';
  }
});
</script>

<template>
  <div
    :class="cn(rowVariants({ layout: 'tree', selected }), 'h-full gap-1.5 border-b border-border pr-3')"
    :data-testid="`import-file-${file.relPath}`"
    :data-state="file.state"
  >
    <button
      type="button"
      class="flex h-full min-w-0 flex-1 cursor-default items-center gap-1.5 border-0 bg-transparent pl-3 text-left"
      @click="emit('select')"
    >
      <Tooltip>
        <TooltipTrigger as-child>
          <span class="min-w-0 flex-1 truncate">{{ file.relPath }}</span>
        </TooltipTrigger>
        <TooltipContent>{{ file.relPath }}</TooltipContent>
      </Tooltip>
      <span v-if="file.state === 'done'" class="shrink-0 text-kira-sm text-muted-foreground">
        +{{ file.added }} ~{{ file.updated }} ={{ file.noop }}
      </span>
      <span v-else-if="file.chunkCount > 0" class="shrink-0 text-kira-sm text-muted-foreground">
        {{ file.chunksDone }} / {{ file.chunkCount }}
      </span>
      <Badge :variant="variant">{{ t(FILE_STATE_LABEL[file.state]) }}</Badge>
    </button>
    <Button
      v-if="file.state === 'failed'"
      size="kira"
      variant="toolbar"
      :data-testid="`import-retry-file-${file.relPath}`"
      @click="emit('retry')"
    >
      {{ t('common.action.retry.label') }}
    </Button>
  </div>
</template>
