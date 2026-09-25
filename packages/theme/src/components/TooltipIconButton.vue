<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import type { ButtonVariants } from '@theme/components/ui/button';
import { Button } from '@theme/components/ui/button';
import { Tooltip, TooltipContent, TooltipDisabledTrigger, TooltipTrigger } from '@theme/components/ui/tooltip';

// P113 F2: 152 call sites across 52 files repeated this exact
// Tooltip > TooltipTrigger as-child > [TooltipDisabledTrigger] > Button > CodiconIcon shape, 13-16
// lines of template each. `label` doubles as the tooltip text and the button's `aria-label` (the
// overwhelming majority of sites use the same string for both); `ariaLabel` is an escape hatch for
// the few sites whose accessible name and tooltip text genuinely differ (a static aria-label next
// to a dynamic tooltip). The default slot overrides the tooltip body for a site whose tooltip is
// richer than plain text/an interpolation. Every other attribute (`data-testid`, `@click`,
// `disabled`, extra classes) falls through to the Button via $attrs — inheritAttrs is off because
// this component has no single root element to inherit onto.
defineOptions({ inheritAttrs: false });

withDefaults(
  defineProps<{
    icon: string;
    label: string;
    ariaLabel?: string;
    iconSize?: number;
    disabledTrigger?: boolean;
    variant?: ButtonVariants['variant'];
    size?: ButtonVariants['size'];
  }>(),
  {
    ariaLabel: undefined,
    iconSize: 13,
    disabledTrigger: false,
    variant: 'toolbar',
    size: 'kira-icon',
  },
);
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <TooltipDisabledTrigger v-if="disabledTrigger">
        <Button :variant="variant" :size="size" :aria-label="ariaLabel ?? label" v-bind="$attrs">
          <CodiconIcon :name="icon" :size="iconSize" />
        </Button>
      </TooltipDisabledTrigger>
      <Button v-else :variant="variant" :size="size" :aria-label="ariaLabel ?? label" v-bind="$attrs">
        <CodiconIcon :name="icon" :size="iconSize" />
      </Button>
    </TooltipTrigger>
    <TooltipContent><slot>{{ label }}</slot></TooltipContent>
  </Tooltip>
</template>
