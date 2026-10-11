<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { cn } from '@theme/lib/utils';
import type { HTMLAttributes } from 'vue';
import { computed } from 'vue';
import type { AlertVariants } from '.';
import { ALERT_ICONS, alertVariants } from '.';

const props = defineProps<{
  class?: HTMLAttributes['class'];
  variant?: AlertVariants['variant'];
  /** Codicon name; defaults to the tone's own icon, `null` renders none. */
  icon?: string | null;
  /** Top-of-view banner: full width, no side or top border, no radius. */
  strip?: boolean;
}>();

const iconName = computed(() => {
  if (props.icon === null) return null;
  return props.icon ?? ALERT_ICONS[props.variant ?? 'info'];
});
</script>

<template>
  <div
    data-slot="alert"
    :class="cn(alertVariants({ variant, strip }), iconName === null && 'grid-cols-[minmax(0,1fr)] *:col-start-1', props.class)"
    role="alert"
  >
    <CodiconIcon v-if="iconName !== null" data-slot="alert-icon" class="mt-px" :name="iconName" :size="13" />
    <slot />
  </div>
</template>
