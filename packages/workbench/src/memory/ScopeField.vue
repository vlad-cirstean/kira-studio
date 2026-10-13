<script setup lang="ts">
import type { MemoryScope } from '@shared/domain/memory';
import CodiconIcon from '@theme/CodiconIcon.vue';
import SecondaryTabs from '@theme/components/SecondaryTabs.vue';
import { Button } from '@theme/components/ui/button';
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@theme/components/ui/command';
import { Label } from '@theme/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@theme/components/ui/popover';
import { t } from '@theme/i18n';
import { computed, ref } from 'vue';
import { SCOPE_LABEL } from './labels';
import { useMemoryProjects } from './queries';

// Scope tabs plus, for scope project, the project combobox. Test ids are `<prefix>-scope-*` and `<prefix>-project-*`.
const props = defineProps<{ prefix: string; scopes: readonly MemoryScope[] }>();
const scope = defineModel<MemoryScope>('scope', { required: true });
const project = defineModel<string>('project', { required: true });

const projects = useMemoryProjects();
const open = ref(false);
const search = ref('');
const known = computed(() => projects.data.value ?? []);
const typed = computed(() => search.value.trim());
const scopeItems = computed(() =>
  props.scopes.map((value) => ({
    value,
    label: t(SCOPE_LABEL[value]),
    testid: `${props.prefix}-scope-${value}`,
  })),
);

function pick(key: string): void {
  project.value = key;
  open.value = false;
  search.value = '';
}
</script>

<template>
  <div class="flex flex-col gap-1">
    <Label>{{ t('common.field.scope.label') }}</Label>
    <SecondaryTabs
      :model-value="scope"
      :items="scopeItems"
      variant="segmented"
      size="kira-lg"
      :aria-label="t('common.field.scope.label')"
      :data-testid="`${prefix}-scope`"
      @update:model-value="(v) => (scope = v as MemoryScope)"
    />
  </div>
  <div v-if="scope === 'project'" class="flex flex-col gap-1">
    <Label :for="`${prefix}-project`">{{ t('memory.common.project.label') }}</Label>
    <Popover v-model:open="open">
      <PopoverTrigger as-child>
        <Button
          :id="`${prefix}-project`"
          variant="dialog"
          size="kira-lg"
          class="justify-between"
          :data-testid="`${prefix}-project`"
        >
          <span class="truncate font-data">{{
            project || t('memory.add.project.placeholder')
          }}</span>
          <CodiconIcon name="chevron-down" :size="12" />
        </Button>
      </PopoverTrigger>
      <PopoverContent class="w-96 p-0">
        <Command :model-value="project" @update:model-value="(v) => pick(String(v))">
          <CommandInput
            v-model="search"
            :placeholder="t('memory.add.findProject.placeholder')"
            :data-testid="`${prefix}-project-search`"
          />
          <CommandList>
            <CommandGroup>
              <CommandItem
                v-if="typed !== '' && !known.includes(typed)"
                :value="typed"
                :data-testid="`${prefix}-project-custom`"
              >
                {{ t('memory.add.useProject.label', { project: typed }) }}
              </CommandItem>
              <CommandItem
                v-for="key in known"
                :key="key"
                :value="key"
                :data-testid="`${prefix}-project-option-${key}`"
              >
                <span class="font-data">{{ key }}</span>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  </div>
</template>
