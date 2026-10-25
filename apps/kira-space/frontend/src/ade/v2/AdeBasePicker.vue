<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import PickerTrigger from '@theme/components/PickerTrigger.vue';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@theme/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@theme/components/ui/popover';
import { t } from '@theme/i18n';
import { computed, ref } from 'vue';
import AdeTip from './AdeTip.vue';
import { useRepoBranches } from './queries';
import type { BaseChoice, BasePick } from './wire';

// The base of a branch: main, a planner branch, or any branch of the repo. A null model = the
// current base, shown as `current`.
const props = defineProps<{
  codeRepoId: string;
  /** The branch whose base is picked: it and its descendants are listed but disabled. */
  branchId?: string;
  /** Name shown while the model is null. */
  current?: string;
}>();
const modelValue = defineModel<BaseChoice | null>({ required: true });

const open = ref(false);
const branches = useRepoBranches(() =>
  open.value || modelValue.value !== null
    ? { codeRepoId: props.codeRepoId, branchId: props.branchId ?? '' }
    : null,
);
const data = computed(() => branches.data.value);

const MAIN: BaseChoice = { ref: '', branchId: '' };
const planner = computed(() => (data.value?.branches ?? []).filter((b) => b.branchId !== ''));
const plain = computed(() =>
  (data.value?.branches ?? []).filter((b) => b.branchId === '' && b.name !== data.value?.mainName),
);

const shown = computed(() => {
  const m = modelValue.value;
  if (m === null) return props.current ?? data.value?.mainName ?? 'main';
  if (m.branchId)
    return data.value?.branches.find((b) => b.branchId === m.branchId)?.name || m.branchId;
  return m.ref || data.value?.mainName || 'main';
});

function label(b: BasePick): string {
  return b.name || b.taskTitle;
}
function choose(c: BaseChoice): void {
  modelValue.value = c;
  open.value = false;
}
const pickOf = (b: BasePick): BaseChoice =>
  b.branchId ? { ref: '', branchId: b.branchId } : { ref: b.name, branchId: '' };
</script>

<template>
  <Popover v-model:open="open">
    <PopoverTrigger as-child>
      <PickerTrigger size="kira" :label="shown" data-testid="ade-base-picker">
        <template #leading><CodiconIcon name="git-branch" :size="12" /></template>
      </PickerTrigger>
    </PopoverTrigger>
    <PopoverContent align="start" class="w-80 gap-0 p-0" data-testid="ade-base-popover">
      <Command>
        <CommandInput
          :placeholder="t('space.ade.basePicker.search.placeholder')"
          data-testid="ade-base-search"
        />
        <CommandList class="max-h-72">
          <CommandEmpty>{{
            branches.isPending.value ? t('common.state.loading.loading') : t('space.common.noBranches.empty')
          }}</CommandEmpty>
          <CommandGroup v-if="data?.previous" :heading="t('space.ade.basePicker.previous.label')">
            <CommandItem
              :value="`previous ${data.previous}`"
              data-testid="ade-base-option-previous"
              @select="choose({ ref: data.previous, branchId: '' })"
            >
              <span class="min-w-0 truncate font-data">{{ data.previous }}</span>
            </CommandItem>
          </CommandGroup>
          <CommandGroup :heading="t('space.ade.basePicker.main.label')">
            <CommandItem
              :value="`main ${data?.mainName ?? 'main'}`"
              :data-testid="`ade-base-option-${data?.mainName ?? 'main'}`"
              @select="choose(MAIN)"
            >
              <span class="min-w-0 truncate font-data">{{ data?.mainName ?? 'main' }}</span>
            </CommandItem>
          </CommandGroup>
          <CommandGroup v-if="planner.length" :heading="t('space.ade.basePicker.planner.label')">
            <AdeTip v-for="b in planner" :key="b.branchId" :text="b.excluded">
              <CommandItem
                :value="`${b.taskTitle} ${label(b)}`"
                :disabled="b.excluded !== ''"
                :data-testid="`ade-base-option-${label(b)}`"
                @select="choose(pickOf(b))"
              >
                <span class="min-w-0 flex-1 truncate">
                  {{ b.taskTitle }}
                  ·
                  <span v-if="b.name" class="font-data">{{ b.name }}</span>
                  <span v-else class="text-subtle">{{
                    t('space.ade.board.branchTag.notCreated.label')
                  }}</span>
                </span>
              </CommandItem>
            </AdeTip>
          </CommandGroup>
          <CommandGroup v-if="plain.length" :heading="t('common.module.branches.label')">
            <AdeTip v-for="b in plain" :key="b.name" :text="b.excluded">
              <CommandItem
                :value="b.name"
                :disabled="b.excluded !== ''"
                :data-testid="`ade-base-option-${b.name}`"
                @select="choose(pickOf(b))"
              >
                <span class="min-w-0 truncate font-data">{{ b.name }}</span>
                <span v-if="!b.local" class="ml-auto text-kira-sm text-subtle">{{
                  t('space.ade.basePicker.remote.status')
                }}</span>
              </CommandItem>
            </AdeTip>
          </CommandGroup>
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>
</template>
