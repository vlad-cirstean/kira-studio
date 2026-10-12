<script setup lang="ts">
// Renders workbench MenuItem[] as DropdownMenu entries: the one renderer behind the point-anchored
// context menu and every anchored action dropdown. The caller owns the surrounding
// DropdownMenu/DropdownMenuContent.
import CodiconIcon from '@theme/CodiconIcon.vue';
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@theme/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import VarText from '@theme/components/VarText.vue';
import { connBgClass } from '@theme/connColor';
import { plainText, type TextPart } from '@theme/varText';
import { useId } from 'vue';
import { formatShortcut } from '../shortcuts/keys';
import type { MenuItem } from '../state/contextMenu';

defineProps<{ items: readonly MenuItem[] }>();

// A disabled item takes no pointer events, so its hint needs them back to show on hover.
const HINT_WHEN_DISABLED = 'data-disabled:pointer-events-auto';
// Colour-choice swatch mark; becomes colorMarkClass('swatch') once the theme exports it.
// A two-line (detail) item outgrows the fixed item height.
const DETAIL_ROW = 'h-auto py-1';
const SWATCH_MARK = 'size-2.5 rounded-full shrink-0';
const uid = useId();

function hintParts(hint: string | readonly TextPart[] | undefined): readonly TextPart[] {
  return typeof hint === 'string' ? [hint] : (hint ?? []);
}

function keyOf(item: MenuItem, idx: number): string {
  return item.type === 'separator' || item.type === 'label' ? `${item.type}-${idx}` : item.id;
}

function swatchClass(swatch: string): string | undefined {
  return swatch === 'none' ? 'border border-disabled' : connBgClass(swatch);
}

async function onItemClick(item: MenuItem): Promise<void> {
  if (item.type !== 'item' || item.disabled) return;
  await item.run();
}
</script>

<template>
  <template v-for="(item, idx) in items" :key="keyOf(item, idx)">
    <DropdownMenuSeparator v-if="item.type === 'separator'" />

    <DropdownMenuLabel v-else-if="item.type === 'label'">{{ item.label }}</DropdownMenuLabel>

    <DropdownMenuSub v-else-if="item.type === 'submenu'">
      <DropdownMenuSubTrigger :data-testid="`menu-item-${item.id}`">
        <span class="flex items-center justify-center shrink-0 size-4">
          <CodiconIcon
            v-if="item.icon"
            :name="item.icon"
            :size="13"
            class="text-muted-foreground"
          />
        </span>
        <span class="flex-1 min-w-0 truncate">{{ item.label }}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent data-testid="context-submenu">
          <MenuItems :items="item.items" />
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>

    <Tooltip v-else :disabled="!item.hint">
      <TooltipTrigger as-child>
        <DropdownMenuItem
          :disabled="!!item.disabled"
          :variant="item.danger ? 'danger' : 'default'"
          :class="[item.hint && HINT_WHEN_DISABLED, item.detail && DETAIL_ROW]"
          :aria-describedby="item.hint ? `${uid}-${item.id}-hint` : undefined"
          :data-testid="`menu-item-${item.id}`"
          @select="onItemClick(item)"
        >
          <span class="flex items-center justify-center shrink-0 size-4">
            <span v-if="item.swatch" :class="[SWATCH_MARK, swatchClass(item.swatch)]" />
            <CodiconIcon
              v-else-if="item.icon"
              :name="item.icon"
              :size="13"
              :class="item.iconClass ?? 'text-muted-foreground'"
            />
          </span>
          <span class="flex-1 min-w-0">
            <span class="block truncate">{{ item.label }}</span>
            <span v-if="item.detail" class="block truncate text-kira-sm text-muted-foreground">{{
              item.detail
            }}</span>
          </span>
          <span v-if="item.hint" :id="`${uid}-${item.id}-hint`" class="sr-only">{{
            plainText(hintParts(item.hint))
          }}</span>
          <DropdownMenuShortcut
            v-if="item.shortcut"
            :data-testid="`menu-item-${item.id}-shortcut`"
            >{{
              formatShortcut(item.shortcut)
            }}</DropdownMenuShortcut
          >
          <span v-if="item.checked" class="flex items-center justify-center shrink-0 size-4">
            <CodiconIcon name="check" :size="13" />
          </span>
        </DropdownMenuItem>
      </TooltipTrigger>
      <TooltipContent v-if="item.hint"><VarText :parts="hintParts(item.hint)" /></TooltipContent>
    </Tooltip>
  </template>
</template>
