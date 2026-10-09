<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
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
import VarText from '@theme/components/VarText.vue';
import type { TextPart } from '@theme/varText';
import { computed, ref } from 'vue';
import AdeTip from './AdeTip.vue';
import { useRepoBranches } from './queries';
import type { BaseChoice, BasePick } from './wire';

// The base of a branch: main, a planner branch, or any branch of the repo. `modelValue` null = the
// current base, shown as `current`.
const props = defineProps<{
  codeRepoId: string;
  /** The branch whose base is picked: it and its descendants are listed but disabled. */
  branchId?: string;
  modelValue: BaseChoice | null;
  /** Name shown while `modelValue` is null. */
  current?: string;
}>();
const emit = defineEmits<{ 'update:modelValue': [choice: BaseChoice] }>();

const open = ref(false);
const branches = useRepoBranches(() =>
  open.value || props.modelValue !== null ? { codeRepoId: props.codeRepoId, branchId: props.branchId ?? '' } : null,
);
const data = computed(() => branches.data.value);

const MAIN: BaseChoice = { ref: '', branchId: '' };
const planner = computed(() => (data.value?.branches ?? []).filter((b) => b.branchId !== ''));
const plain = computed(() =>
  (data.value?.branches ?? []).filter((b) => b.branchId === '' && b.name !== data.value?.mainName),
);

const shown = computed(() => {
  const m = props.modelValue;
  if (m === null) return props.current ?? data.value?.mainName ?? 'main';
  if (m.branchId) return data.value?.branches.find((b) => b.branchId === m.branchId)?.name || m.branchId;
  return m.ref || data.value?.mainName || 'main';
});
const parts = computed((): TextPart[] => [{ name: 'base', value: shown.value }]);

function label(b: BasePick): string {
  return b.name || b.taskTitle;
}
function choose(c: BaseChoice): void {
  emit('update:modelValue', c);
  open.value = false;
}
const pickOf = (b: BasePick): BaseChoice =>
  b.branchId ? { ref: '', branchId: b.branchId } : { ref: b.name, branchId: '' };
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <Button variant="dialog" size="kira" class="max-w-full justify-start gap-1.5" data-testid="ade-base-picker">
        <CodiconIcon name="git-branch" :size="12" />
        <VarText :parts="parts" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" class="w-80 gap-0 p-0" data-testid="ade-base-popover">
      <Command>
        <CommandInput placeholder="Search branches…" data-testid="ade-base-search" />
        <CommandList class="max-h-72">
          <CommandEmpty>{{ branches.isPending.value ? 'Loading…' : 'No branches' }}</CommandEmpty>
          <CommandGroup v-if="data?.previous" heading="Previous base">
            <CommandItem
              :value="`previous ${data.previous}`"
              data-testid="ade-base-option-previous"
              @select="choose({ ref: data.previous, branchId: '' })"
            >
              <VarText :parts="[{ name: 'base', value: data.previous }]" />
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading="Main">
            <CommandItem
              :value="`main ${data?.mainName ?? 'main'}`"
              :data-testid="`ade-base-option-${data?.mainName ?? 'main'}`"
              @select="choose(MAIN)"
            >
              <VarText :parts="[{ name: 'base', value: data?.mainName ?? 'main' }]" />
            </CommandItem>
          </CommandGroup>
          <CommandGroup v-if="planner.length" heading="Planner branches">
            <AdeTip v-for="b in planner" :key="b.branchId" :text="b.excluded">
              <CommandItem
                :value="`${b.taskTitle} ${label(b)}`"
                :disabled="b.excluded !== ''"
                :data-testid="`ade-base-option-${label(b)}`"
                @select="choose(pickOf(b))"
              >
                <span class="min-w-0 flex-1 truncate">
                  {{ b.taskTitle }} ·
                  <VarText v-if="b.name" :parts="[{ name: 'base', value: b.name }]" />
                  <span v-else class="text-subtle">not created</span>
                </span>
              </CommandItem>
            </AdeTip>
          </CommandGroup>
          <CommandGroup v-if="plain.length" heading="Branches">
            <AdeTip v-for="b in plain" :key="b.name" :text="b.excluded">
              <CommandItem
                :value="b.name"
                :disabled="b.excluded !== ''"
                :data-testid="`ade-base-option-${b.name}`"
                @select="choose(pickOf(b))"
              >
                <VarText :parts="[{ name: 'base', value: b.name }]" />
                <span v-if="!b.local" class="ml-auto text-kira-sm text-subtle">remote</span>
              </CommandItem>
            </AdeTip>
          </CommandGroup>
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>
</template>
