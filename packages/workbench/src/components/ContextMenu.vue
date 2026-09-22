<script setup lang="ts">
// P104 §5: the point-anchored singleton menu, reopened on reka's own DropdownMenuRoot. One shared
// menu opened imperatively from useContextMenuStore() at an arbitrary (x, y) — a 0x0 fixed
// DropdownMenuTrigger at that point is the same virtual-anchor shape reka's own ContextMenuTrigger
// renders internally (MenuAnchor :reference), expressed with public components only (§5.2).
import CodiconIcon from '@theme/CodiconIcon.vue';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@theme/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import { connColorVar } from '@theme/connColor';
import { formatShortcut } from '../shortcuts/keys';
import { type MenuItem, useContextMenuStore } from '../state/contextMenu';

const contextMenuStore = useContextMenuStore();

function onUpdateOpen(open: boolean): void {
  if (!open) contextMenuStore.closeContextMenu();
}

async function onItemClick(item: MenuItem): Promise<void> {
  if (item.type !== 'item' || item.disabled) return;
  await item.run();
}
</script>

<template>
  <DropdownMenu :open="contextMenuStore.open" @update:open="onUpdateOpen">
    <DropdownMenuTrigger as-child>
      <span
        class="fixed size-0"
        :style="{ left: `${contextMenuStore.x}px`, top: `${contextMenuStore.y}px` }"
        aria-hidden="true"
      />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" :side-offset="0" data-testid="context-menu" class="min-w-45">
      <template
        v-for="(item, idx) in contextMenuStore.items"
        :key="item.type === 'separator' ? `sep-${idx}` : item.id"
      >
        <DropdownMenuSeparator v-if="item.type === 'separator'" />

        <DropdownMenuSub v-else-if="item.type === 'submenu'">
          <DropdownMenuSubTrigger :data-testid="`menu-item-${item.id}`">
            <span class="flex items-center justify-center shrink-0 size-4">
              <CodiconIcon v-if="item.icon" :name="item.icon" :size="13" class="text-muted-foreground" />
            </span>
            <span class="flex-1 overflow-hidden text-ellipsis">{{ item.label }}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent data-testid="context-submenu">
            <template
              v-for="(sub, subIdx) in item.items"
              :key="sub.type === 'separator' ? `sep-${subIdx}` : sub.id"
            >
              <DropdownMenuSeparator v-if="sub.type === 'separator'" />
              <DropdownMenuItem
                v-else
                :disabled="sub.type === 'item' && !!sub.disabled"
                :variant="sub.type === 'item' && sub.danger ? 'destructive' : 'default'"
                :data-testid="`menu-item-${sub.id}`"
                @select="sub.type === 'item' && onItemClick(sub)"
              >
                <span class="flex items-center justify-center shrink-0 size-4">
                  <span
                    v-if="sub.type === 'item' && sub.swatch"
                    class="w-2.5 h-2.5 rounded-full shrink-0"
                    :class="{ 'border-[1.5px] border-disabled': sub.swatch === 'none' }"
                    :style="sub.swatch === 'none' ? undefined : { background: connColorVar(sub.swatch) }"
                  />
                  <CodiconIcon
                    v-else-if="sub.icon"
                    :name="sub.icon"
                    :size="13"
                    class="text-muted-foreground"
                  />
                </span>
                <span class="flex-1 overflow-hidden text-ellipsis">{{ sub.label }}</span>
                <DropdownMenuShortcut
                  v-if="sub.type === 'item' && sub.shortcut"
                  :data-testid="`menu-item-${sub.id}-shortcut`"
                  >{{ formatShortcut(sub.shortcut) }}</DropdownMenuShortcut
                >
                <span
                  v-if="sub.type === 'item' && sub.checked"
                  class="flex items-center justify-center shrink-0 size-4"
                >
                  <CodiconIcon name="check" :size="13" />
                </span>
              </DropdownMenuItem>
            </template>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <Tooltip v-else :disabled="!item.hint">
          <TooltipTrigger as-child>
            <DropdownMenuItem
              :disabled="!!item.disabled"
              :variant="item.danger ? 'destructive' : 'default'"
              :data-testid="`menu-item-${item.id}`"
              @select="onItemClick(item)"
            >
              <span class="flex items-center justify-center shrink-0 size-4">
                <span
                  v-if="item.swatch"
                  class="w-2.5 h-2.5 rounded-full shrink-0"
                  :class="{ 'border-[1.5px] border-disabled': item.swatch === 'none' }"
                  :style="item.swatch === 'none' ? undefined : { background: connColorVar(item.swatch) }"
                />
                <CodiconIcon v-else-if="item.icon" :name="item.icon" :size="13" class="text-muted-foreground" />
              </span>
              <span class="flex-1 overflow-hidden text-ellipsis">{{ item.label }}</span>
              <DropdownMenuShortcut v-if="item.shortcut" :data-testid="`menu-item-${item.id}-shortcut`">{{
                formatShortcut(item.shortcut)
              }}</DropdownMenuShortcut>
              <span v-if="item.checked" class="flex items-center justify-center shrink-0 size-4">
                <CodiconIcon name="check" :size="13" />
              </span>
            </DropdownMenuItem>
          </TooltipTrigger>
          <TooltipContent v-if="item.hint">{{ item.hint }}</TooltipContent>
        </Tooltip>
      </template>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
