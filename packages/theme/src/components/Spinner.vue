<script setup lang="ts">
import { t } from '@theme/i18n';
import { computed } from 'vue';

// P263 §2.6: the one loading motion. `icon` swaps the glyph for an action's own icon spinning
// (`sync`, `refresh`). `label=""` marks it decorative (a parent already carries `role="status"`).
const props = withDefaults(
  defineProps<{ size?: 12 | 13 | 24; icon?: 'loading' | 'sync' | 'refresh'; label?: string }>(),
  { size: 13, icon: 'loading', label: () => t('common.state.loading.loading') },
);

const style = computed(() => ({ fontSize: `${props.size}px` }));
</script>

<template>
  <i
    data-slot="spinner"
    :class="`codicon codicon-${icon} shrink-0 animate-spin`"
    :style="style"
    :role="label ? 'status' : undefined"
    :aria-label="label || undefined"
    :aria-hidden="label ? undefined : 'true'"
  />
</template>
