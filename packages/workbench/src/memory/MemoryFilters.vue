<script setup lang="ts">
import type { MemoryOrigin, MemoryScope } from '@shared/domain/memory';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Badge } from '@theme/components/ui/badge';
import { Button } from '@theme/components/ui/button';
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@theme/components/ui/command';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@theme/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@theme/components/ui/popover';
import { t } from '@theme/i18n';
import { computed, ref } from 'vue';
import { ORIGIN_LABEL, SCOPE_LABEL } from './labels';
import { useMemoryProjects } from './queries';

// P275: search narrowing (scope and origin checkboxes) and the project whose facts rank first.
// Every box checked and an empty list both mean "all".
const scopes = defineModel<MemoryScope[]>('scopes', { required: true });
const origins = defineModel<MemoryOrigin[]>('origins', { required: true });
const project = defineModel<string>('project', { required: true });

const SCOPES: readonly MemoryScope[] = ['company', 'project', 'personal'];
const ORIGINS: readonly MemoryOrigin[] = ['user', 'agent', 'external'];

function toggle<T extends string>(all: readonly T[], current: T[], value: T): T[] {
  const set = new Set(current.length === 0 ? all : current);
  if (set.has(value)) set.delete(value);
  else set.add(value);
  const next = all.filter((v) => set.has(v));
  return next.length === all.length || next.length === 0 ? [] : next;
}

const checked = <T extends string>(current: T[], value: T): boolean =>
  current.length === 0 || current.includes(value);

const active = computed(
  () => (scopes.value.length > 0 ? 1 : 0) + (origins.value.length > 0 ? 1 : 0),
);

const projects = useMemoryProjects();
const pickerOpen = ref(false);
const search = ref('');
const known = computed(() => projects.data.value ?? []);
const typed = computed(() => search.value.trim());

function pick(key: string): void {
  project.value = key;
  pickerOpen.value = false;
  search.value = '';
}
</script>

<template>
  <div class="flex items-center gap-1">
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button variant="toolbar" size="status" data-testid="memory-filter">
          <CodiconIcon name="filter" :size="13" />
          {{ t('memory.panel.filter.label') }}
          <Badge v-if="active > 0" data-testid="memory-filter-count">{{ active }}</Badge>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>{{ t('common.field.scope.label') }}</DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          v-for="scope in SCOPES"
          :key="scope"
          :model-value="checked(scopes, scope)"
          :data-testid="`memory-filter-scope-${scope}`"
          @select.prevent
          @update:model-value="scopes = toggle(SCOPES, scopes, scope)"
        >
          {{ t(SCOPE_LABEL[scope]) }}
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{{ t('memory.import.confirm.origin.label') }}</DropdownMenuLabel>
        <DropdownMenuCheckboxItem
          v-for="origin in ORIGINS"
          :key="origin"
          :model-value="checked(origins, origin)"
          :data-testid="`memory-filter-origin-${origin}`"
          @select.prevent
          @update:model-value="origins = toggle(ORIGINS, origins, origin)"
        >
          {{ t(ORIGIN_LABEL[origin]) }}
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <Popover v-model:open="pickerOpen">
      <PopoverTrigger as-child>
        <Button
          variant="toolbar"
          size="status"
          class="min-w-0 max-w-48 justify-between"
          data-testid="memory-boost-project"
        >
          <span class="truncate font-data">{{
            project || t('memory.panel.boostProject.label')
          }}</span>
          <CodiconIcon name="chevron-down" :size="12" />
        </Button>
      </PopoverTrigger>
      <PopoverContent class="w-96 p-0">
        <Command :model-value="project" @update:model-value="(v) => pick(String(v))">
          <CommandInput
            v-model="search"
            :placeholder="t('memory.add.findProject.placeholder')"
            data-testid="memory-boost-project-search"
          />
          <CommandList>
            <CommandGroup>
              <CommandItem
                v-if="typed !== '' && !known.includes(typed)"
                :value="typed"
                data-testid="memory-boost-project-custom"
              >
                {{ t('common.picker.useValue.label', { value: typed }) }}
              </CommandItem>
              <CommandItem
                v-for="key in known"
                :key="key"
                :value="key"
                :data-testid="`memory-boost-project-option-${key}`"
              >
                <span class="font-data">{{ key }}</span>
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
        <Button
          v-if="project"
          variant="toolbar"
          size="status"
          class="w-full"
          data-testid="memory-boost-project-clear"
          @click="pick('')"
        >
          {{ t('memory.panel.boostProject.clear.label') }}
        </Button>
      </PopoverContent>
    </Popover>
  </div>
</template>
