<script setup lang="ts">
import type { ImportFile } from '@shared/domain/memoryImport';
import { Badge } from '@theme/components/ui/badge';
import { Button } from '@theme/components/ui/button';
import { computed } from 'vue';

// P211: one file of an import — fixed height, the virtualized list's row.
const props = defineProps<{ file: ImportFile; selected: boolean }>();
const emit = defineEmits<{ select: []; retry: [] }>();

const variant = computed(() => {
  switch (props.file.state) {
    case 'done':
      return 'ok';
    case 'failed':
      return 'err';
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
    class="flex h-full items-center gap-1.5 border-b border-border pr-3 text-kira-md hover:bg-hover"
    :class="{ 'bg-hover': selected }"
    :data-testid="`import-file-${file.relPath}`"
    :data-state="file.state"
  >
    <button
      type="button"
      class="flex h-full min-w-0 flex-1 cursor-default items-center gap-1.5 border-0 bg-transparent pl-3 text-left"
      @click="emit('select')"
    >
      <span class="min-w-0 flex-1 truncate" :title="file.relPath">{{ file.relPath }}</span>
      <span v-if="file.state === 'done'" class="shrink-0 text-kira-sm text-muted-foreground">
        +{{ file.added }} ~{{ file.updated }} ={{ file.noop }}
      </span>
      <span v-else-if="file.chunkCount > 0" class="shrink-0 text-kira-sm text-muted-foreground">
        {{ file.chunksDone }} / {{ file.chunkCount }}
      </span>
      <Badge :variant="variant">{{ file.state }}</Badge>
    </button>
    <Button
      v-if="file.state === 'failed'"
      size="kira"
      variant="toolbar"
      :data-testid="`import-retry-file-${file.relPath}`"
      @click="emit('retry')"
    >
      Retry
    </Button>
  </div>
</template>
