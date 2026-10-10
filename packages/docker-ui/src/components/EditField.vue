<script setup lang="ts">
import { computed, inject } from 'vue';
import type { EditMode } from '../lib/editDiff';
import { inPlaceSectionKey } from '../lib/editSection';

const props = defineProps<{
  field: string;
  label: string;
  mode: EditMode;
  changed?: boolean;
  error?: string;
  hint?: string;
}>();

const inPlaceTab = inject(inPlaceSectionKey, undefined);
const needsRecreate = computed(() => inPlaceTab === true && props.mode === 'recreate');
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
      <span v-if="changed" class="size-1.5 rounded-full bg-muted-foreground" title="Changed" />
    </div>
    <slot />
    <p v-if="error" class="text-error" data-testid="docker-edit-field-error">{{ error }}</p>
    <p v-else-if="needsRecreate" class="text-muted-foreground" data-testid="docker-edit-field-recreate-hint">This change needs a recreate.</p>
    <p v-else-if="hint" class="text-muted-foreground">{{ hint }}</p>
  </fieldset>
</template>
