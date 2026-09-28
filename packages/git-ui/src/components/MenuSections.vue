<script setup lang="ts">
// P131 Part 2 §3.6: a model renderer, not a wrapper around a shadcn component -- the same role
// KuiMenuList held for its three consumers (RowContextMenu, AppToolbar's push menu,
// PullStrategyPicker), now rendering a MenuSection[] as DropdownMenuItems instead of building its
// own row/keyboard-nav machinery (reka's DropdownMenuContent already owns that).
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@theme/components/ui/dropdown-menu';
import type { MenuSection } from '../lib/menuModel.ts';

defineProps<{
  sections: readonly MenuSection[];
  title?: string;
}>();

const emit = defineEmits<(e: 'select', id: string) => void>();
</script>

<template>
  <DropdownMenuLabel v-if="title">{{ title }}</DropdownMenuLabel>
  <template v-for="(section, sectionIndex) in sections" :key="sectionIndex">
    <DropdownMenuSeparator v-if="sectionIndex > 0" />
    <DropdownMenuItem
      v-for="item in section.items"
      :key="item.id"
      :disabled="item.disabled"
      :variant="item.danger ? 'destructive' : 'default'"
      :data-testid="item.id"
      :aria-describedby="item.disabled && item.disabledReason ? `${item.id}-reason` : undefined"
      @select="emit('select', item.id)"
    >
      <!-- KuiMenuList's own G34 D9 rule: the icon box is unconditional so every row's label
           starts at the same x position whether or not that particular item carries an icon. -->
      <span class="flex items-center justify-center shrink-0 size-4">
        <span v-if="item.icon" class="codicon" :class="item.icon" aria-hidden="true" />
      </span>
      <span class="flex flex-col min-w-0">
        <span>{{ item.label }}</span>
        <span v-if="item.detail" class="text-kira-sm text-muted-foreground">{{ item.detail }}</span>
      </span>
      <span v-if="item.disabled && item.disabledReason" :id="`${item.id}-reason`" class="sr-only">
        {{ item.disabledReason }}
      </span>
    </DropdownMenuItem>
  </template>
</template>
