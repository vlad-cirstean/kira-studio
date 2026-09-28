<script setup lang="ts">
import { Badge } from '@theme/components/ui/badge';
import { Button } from '@theme/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@theme/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@theme/components/ui/popover';
import { ref } from 'vue';
import { useAdeSetBlocker } from './mutations';
import { useAdeUiStore } from './state/adeUi';
import type { QueuePanel } from './useQueue';

// P135 §4.7: the mirror of `AdeDependencyDetails`'s own Blocks list, mounted on a blocked item's own
// panel — chips for `panel.blockers`, red when late, plus a Link popover over `panel.blockerOptions`
// (live dependencies not yet linked). Direct mutation use, `AdeDetailsTab`'s own `useAdeBindNewWork`
// precedent.
const props = defineProps<{
  panel: QueuePanel;
  codeRepoId: string;
}>();

const adeUiStore = useAdeUiStore();
const setBlocker = useAdeSetBlocker(() => props.codeRepoId);
const linkOpen = ref(false);

function selectDependency(id: string): void {
  adeUiStore.select(props.codeRepoId, id);
}

function unlink(id: string): void {
  void setBlocker.mutateAsync({
    codeRepoId: props.codeRepoId,
    dependency: id,
    item: props.panel.id,
    linked: false,
  });
}

function link(id: string): void {
  linkOpen.value = false;
  void setBlocker.mutateAsync({
    codeRepoId: props.codeRepoId,
    dependency: id,
    item: props.panel.id,
    linked: true,
  });
}
</script>

<template>
  <div
    v-if="panel.blockers.length || panel.blockerOptions.length"
    class="flex flex-col gap-1"
    data-testid="ade-blocker-row"
  >
    <span class="text-kira-sm text-[#9a9ca5]">Blocked by</span>
    <div class="flex flex-wrap items-center gap-1.5">
      <Badge
        v-for="b in panel.blockers"
        :key="b.id"
        :variant="b.late ? 'err' : 'default'"
        class="cursor-pointer gap-1"
        :data-testid="`ade-blocker-chip-${b.id}`"
        @click="selectDependency(b.id)"
      >
        {{ b.title }}
        <Button
          type="button"
          size="xs"
          variant="ghost"
          class="size-4 p-0"
          :data-testid="`ade-blocker-unlink-${b.id}`"
          @click.stop="unlink(b.id)"
          >×</Button
        >
      </Badge>
      <Popover v-if="panel.blockerOptions.length" v-model:open="linkOpen">
        <PopoverTrigger as-child>
          <Button type="button" size="xs" variant="outline" data-testid="ade-blocker-link-open"
            >Link</Button
          >
        </PopoverTrigger>
        <PopoverContent align="start" class="w-64 p-0">
          <Command>
            <CommandInput placeholder="Search dependencies…" data-testid="ade-blocker-link-search" />
            <CommandList class="max-h-56">
              <CommandEmpty data-testid="ade-blocker-link-empty">No dependencies</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  v-for="opt in panel.blockerOptions"
                  :key="opt.id"
                  :value="opt.title"
                  :data-testid="`ade-blocker-link-option-${opt.id}`"
                  @select="link(opt.id)"
                >
                  {{ opt.title }}
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  </div>
</template>
