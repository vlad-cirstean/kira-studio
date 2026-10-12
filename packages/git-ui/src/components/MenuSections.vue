<script setup lang="ts">
// P131 Part 2 §3.6: a model renderer, not a wrapper around a shadcn component -- the same role
// KuiMenuList held for its consumers (AppToolbar's push menu,
// PullStrategyPicker), now rendering a MenuSection[] as DropdownMenuItems instead of building its
// own row/keyboard-nav machinery (reka's DropdownMenuContent already owns that).
import CodiconIcon from '@theme/CodiconIcon.vue';
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
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
      :variant="item.danger ? 'danger' : 'default'"
      :data-testid="item.id"
      :aria-describedby="item.disabled && item.disabledReason ? `${item.id}-reason` : undefined"
      @select="emit('select', item.id)"
    >
      <!-- KuiMenuList's own G34 D9 rule: the icon box is unconditional so every row's label
           starts at the same x position whether or not that particular item carries an icon. -->
      <span class="flex items-center justify-center shrink-0 size-4">
        <CodiconIcon v-if="item.icon" :name="item.icon" :size="13" class="text-muted-foreground" />
      </span>
      <span class="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{{ item.label }}</span>
      <DropdownMenuShortcut v-if="item.detail" class="whitespace-nowrap">{{
        item.detail
      }}</DropdownMenuShortcut>
      <span v-if="item.disabled && item.disabledReason" :id="`${item.id}-reason`" class="sr-only">
        {{ item.disabledReason }}
      </span>
    </DropdownMenuItem>
  </template>
</template>
