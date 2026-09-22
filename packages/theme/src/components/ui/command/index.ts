import { createContext } from 'reka-ui';
import type { Ref } from 'vue';

export { default as Command } from '@theme/components/ui/command/Command.vue';
export { default as CommandDialog } from '@theme/components/ui/command/CommandDialog.vue';
export { default as CommandEmpty } from '@theme/components/ui/command/CommandEmpty.vue';
export { default as CommandGroup } from '@theme/components/ui/command/CommandGroup.vue';
export { default as CommandInput } from '@theme/components/ui/command/CommandInput.vue';
export { default as CommandItem } from '@theme/components/ui/command/CommandItem.vue';
export { default as CommandList } from '@theme/components/ui/command/CommandList.vue';
export { default as CommandSeparator } from '@theme/components/ui/command/CommandSeparator.vue';
export { default as CommandShortcut } from '@theme/components/ui/command/CommandShortcut.vue';

export const [useCommand, provideCommandContext] = createContext<{
  allItems: Ref<Map<string, string>>;
  allGroups: Ref<Map<string, Set<string>>>;
  filterState: {
    search: string;
    filtered: { count: number; items: Map<string, number>; groups: Set<string> };
  };
}>('Command');

export const [useCommandGroup, provideCommandGroupContext] = createContext<{
  id?: string;
}>('CommandGroup');
