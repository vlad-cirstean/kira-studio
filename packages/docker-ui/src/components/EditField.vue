<script setup lang="ts">
import { Badge } from '@theme/components/ui/badge';
import type { EditMode } from '../lib/editDiff';

defineProps<{
  field: string;
  label: string;
  mode: EditMode;
  changed?: boolean;
  error?: string;
  hint?: string;
}>();
</script>

<template>
  <fieldset
    class="m-0 flex min-w-0 flex-col gap-1 border-0 p-0"
    :aria-label="label"
    :data-testid="`docker-edit-field-${field}`"
    :data-changed="changed ? 'true' : 'false'"
  >
    <div class="flex items-center gap-2">
      <span class="text-muted-foreground">{{ label }}</span>
      <span v-if="changed" class="size-1.5 rounded-full bg-focus" title="Changed" />
      <Badge :variant="mode === 'now' ? 'info' : 'warn'" data-testid="docker-edit-badge" :data-mode="mode">
        {{ mode === 'now' ? 'applies now' : 'recreates container' }}
      </Badge>
    </div>
    <slot />
    <p v-if="error" class="text-error" data-testid="docker-edit-field-error">{{ error }}</p>
    <p v-else-if="hint" class="text-muted-foreground">{{ hint }}</p>
  </fieldset>
</template>
