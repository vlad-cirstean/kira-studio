<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue'
import { ToggleGroup, ToggleGroupItem } from '@theme/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip'
import { cn } from '@theme/lib/utils'

// P262 §2.3: the one secondary-tab / segmented-picker element. Wraps ToggleGroup so call sites
// drop the `(v) => v && set(v)` guard: an empty value (clicking the active item) is never emitted.
export interface SecondaryTabItem {
  value: string
  label: string
  icon?: string
  count?: number | string
  disabled?: boolean
  testid?: string
  tooltip?: string
}

withDefaults(defineProps<{
  modelValue: string
  items: readonly SecondaryTabItem[]
  variant?: 'tabs' | 'segmented'
  size?: 'kira' | 'kira-lg'
  ariaLabel?: string
}>(), {
  variant: 'tabs',
  size: 'kira',
  ariaLabel: undefined,
})

const emit = defineEmits<(e: 'update:modelValue', value: string) => void>()

function onUpdate(v: unknown): void {
  if (typeof v === 'string' && v !== '') {
    emit('update:modelValue', v)
  }
}
</script>

<template>
  <ToggleGroup
    type="single"
    data-slot="secondary-tabs"
    :variant="variant === 'segmented' ? 'outline' : 'default'"
    :size="size"
    :model-value="modelValue"
    :aria-label="ariaLabel"
    @update:model-value="onUpdate"
  >
    <template v-for="item in items" :key="item.value">
      <!-- A tooltip trigger stamps its own data-state on the element it wraps, which would hide
           the toggle's on/off state: wrap in a span only when the item has a tooltip. -->
      <Tooltip v-if="item.tooltip">
        <TooltipTrigger as-child>
          <span class="inline-flex">
            <ToggleGroupItem
              :value="item.value"
              :disabled="item.disabled"
              :data-testid="item.testid"
              :class="cn(variant === 'tabs' && 'text-muted-foreground data-[state=on]:text-fg')"
            >
              <slot name="item" :item="item" :active="item.value === modelValue">
                <CodiconIcon v-if="item.icon" :name="item.icon" :size="13" />
                {{ item.label }}
                <span v-if="item.count !== undefined" class="text-kira-sm text-muted-foreground">{{ item.count }}</span>
              </slot>
            </ToggleGroupItem>
          </span>
        </TooltipTrigger>
        <TooltipContent>{{ item.tooltip }}</TooltipContent>
      </Tooltip>
      <ToggleGroupItem
        v-else
        :value="item.value"
        :disabled="item.disabled"
        :data-testid="item.testid"
        :class="cn(variant === 'tabs' && 'text-muted-foreground data-[state=on]:text-fg')"
      >
        <slot name="item" :item="item" :active="item.value === modelValue">
          <CodiconIcon v-if="item.icon" :name="item.icon" :size="13" />
          {{ item.label }}
          <span v-if="item.count !== undefined" class="text-kira-sm text-muted-foreground">{{ item.count }}</span>
        </slot>
      </ToggleGroupItem>
    </template>
  </ToggleGroup>
</template>
