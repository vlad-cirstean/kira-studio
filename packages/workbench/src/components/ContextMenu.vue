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
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@theme/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@theme/components/ui/tooltip';
import VarText from '@theme/components/VarText.vue';
import { connBgClass } from '@theme/connColor';
import type { TextPart } from '@theme/varText';
import { formatShortcut } from '../shortcuts/keys';
import { type MenuItem, useContextMenuStore } from '../state/contextMenu';

// A disabled item takes no pointer events, so its hint needs them back to show on hover.
const HINT_WHEN_DISABLED = 'data-disabled:pointer-events-auto';

const contextMenuStore = useContextMenuStore();

function onUpdateOpen(open: boolean): void {
  if (!open) contextMenuStore.closeContextMenu();
}

function hintParts(hint: string | readonly TextPart[] | undefined): readonly TextPart[] {
  return typeof hint === 'string' ? [hint] : (hint ?? []);
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
        :key="item.type === 'separator' || item.type === 'label' ? `${item.type}-${idx}` : item.id"
      >
        <DropdownMenuSeparator v-if="item.type === 'separator'" />

        <DropdownMenuLabel v-else-if="item.type === 'label'">{{ item.label }}</DropdownMenuLabel>

        <DropdownMenuSub v-else-if="item.type === 'submenu'">
          <DropdownMenuSubTrigger :data-testid="`menu-item-${item.id}`">
            <span class="flex items-center justify-center shrink-0 size-4">
              <CodiconIcon v-if="item.icon" :name="item.icon" :size="13" class="text-muted-foreground" />
            </span>
            <span class="flex-1 overflow-hidden text-ellipsis">{{ item.label }}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent data-testid="context-submenu">
              <template
                v-for="(sub, subIdx) in item.items"
                :key="sub.type === 'separator' || sub.type === 'label' ? `${sub.type}-${subIdx}` : sub.id"
              >
                <DropdownMenuSeparator v-if="sub.type === 'separator'" />
                <DropdownMenuLabel v-else-if="sub.type === 'label'">{{ sub.label }}</DropdownMenuLabel>
                <Tooltip v-else :disabled="sub.type !== 'item' || !sub.hint">
                  <TooltipTrigger as-child>
                    <DropdownMenuItem
                      :disabled="sub.type === 'item' && !!sub.disabled"
                      :variant="sub.type === 'item' && sub.danger ? 'destructive' : 'default'"
                      :class="sub.type === 'item' && sub.hint && HINT_WHEN_DISABLED"
                      :data-testid="`menu-item-${sub.id}`"
                      @select="sub.type === 'item' && onItemClick(sub)"
                    >
                      <span class="flex items-center justify-center shrink-0 size-4">
                        <span
                          v-if="sub.type === 'item' && sub.swatch"
                          class="w-2.5 h-2.5 rounded-full shrink-0"
                          :class="sub.swatch === 'none' ? 'border border-disabled' : connBgClass(sub.swatch)"
                        />
                        <CodiconIcon
                          v-else-if="sub.icon"
                          :name="sub.icon"
                          :size="13"
                          :class="(sub.type === 'item' && sub.iconClass) || 'text-muted-foreground'"
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
                  </TooltipTrigger>
                  <TooltipContent v-if="sub.type === 'item' && sub.hint" class="whitespace-pre-line"
                    ><VarText :parts="hintParts(sub.hint)"
                  /></TooltipContent>
                </Tooltip>
              </template>
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>

        <Tooltip v-else :disabled="!item.hint">
          <TooltipTrigger as-child>
            <DropdownMenuItem
              :disabled="!!item.disabled"
              :variant="item.danger ? 'destructive' : 'default'"
              :class="item.hint && HINT_WHEN_DISABLED"
              :data-testid="`menu-item-${item.id}`"
              @select="onItemClick(item)"
            >
              <span class="flex items-center justify-center shrink-0 size-4">
                <span
                  v-if="item.swatch"
                  class="w-2.5 h-2.5 rounded-full shrink-0"
                  :class="item.swatch === 'none' ? 'border border-disabled' : connBgClass(item.swatch)"
                />
                <CodiconIcon v-else-if="item.icon" :name="item.icon" :size="13" :class="item.iconClass ?? 'text-muted-foreground'" />
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
          <TooltipContent v-if="item.hint" class="whitespace-pre-line"
            ><VarText :parts="hintParts(item.hint)"
          /></TooltipContent>
        </Tooltip>
      </template>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
