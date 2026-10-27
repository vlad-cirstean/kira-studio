<script setup lang="ts">
import type { ScriptRunAde, ScriptRunPreview } from '@shared/domain/scriptRuns';
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
import { Field, FieldDescription, FieldLabel } from '@theme/components/ui/field';
import { Label } from '@theme/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@theme/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@theme/components/ui/radio-group';
import VarText from '@theme/components/VarText.vue';
import { t } from '@theme/i18n';
import CatalogText from '@theme/i18n/CatalogText.vue';
import { computed, ref, useId } from 'vue';

const props = defineProps<{ needs: ScriptRunPreview['needs']; ade: ScriptRunAde | null }>();
const taskId = defineModel<string>('taskId', { required: true });
const branchId = defineModel<string>('branchId', { required: true });
const idBase = useId();
const taskOpen = ref(false);

const taskTitle = computed(
  () =>
    props.needs.tasks.find((task) => task.id === taskId.value)?.title ?? props.ade?.taskTitle ?? '',
);

function pickTask(id: string): void {
  if (id !== taskId.value) branchId.value = '';
  taskId.value = id;
  taskOpen.value = false;
}
</script>

<template>
  <div class="flex flex-col gap-3" data-testid="run-ade">
    <Field v-if="needs.tasks.length > 0">
      <FieldLabel :for="`${idBase}-task`"
        >{{ t('common.task.label') }} <span class="text-error">*</span></FieldLabel
      >
      <Popover v-model:open="taskOpen">
        <PopoverTrigger as-child>
          <Button
            :id="`${idBase}-task`"
            variant="dialog"
            size="kira-lg"
            class="justify-between"
            data-testid="run-task"
          >
            <span class="truncate">{{
              taskTitle || t('automations.run.chooseTask.placeholder')
            }}</span>
            <CodiconIcon name="chevron-down" :size="12" />
          </Button>
        </PopoverTrigger>
        <PopoverContent class="w-96 p-0">
          <Command :model-value="taskId" @update:model-value="(v) => pickTask(String(v))">
            <CommandInput :placeholder="t('automations.run.findTask.placeholder')" />
            <CommandList>
              <CommandEmpty>{{ t('automations.run.noTasks.empty') }}</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  v-for="task in needs.tasks"
                  :key="task.id"
                  :value="task.id"
                  :keywords="[task.title]"
                  :data-testid="`run-task-option-${task.id}`"
                >
                  {{ task.title }}
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </Field>

    <Field v-if="needs.branches.length > 0">
      <FieldLabel
        >{{ t('common.field.branch.label') }} <span class="text-error">*</span></FieldLabel
      >
      <RadioGroup
        :model-value="branchId"
        class="gap-1.5"
        data-testid="run-branch"
        @update:model-value="(v) => (branchId = String(v))"
      >
        <div v-for="b in needs.branches" :key="b.id" class="flex flex-col gap-0.5">
          <div class="flex items-center gap-2">
            <RadioGroupItem
              :id="`${idBase}-${b.id}`"
              :value="b.id"
              :disabled="b.disabled"
              :data-testid="`run-branch-${b.id}`"
            />
            <Label :for="`${idBase}-${b.id}`" :class="b.disabled && 'text-muted-foreground'">{{
              b.label
            }}</Label>
          </div>
          <FieldDescription
            v-if="b.disabled"
            class="pl-6"
            :data-testid="`run-branch-why-${b.id}`"
            >{{
              b.why
            }}</FieldDescription
          >
        </div>
      </RadioGroup>
    </Field>

    <div v-if="ade" class="text-kira-sm text-muted-foreground" data-testid="run-ade-context">
      <CatalogText
        :k="ade.branchLabel ? 'automations.run.taskOnBranch.label' : 'automations.run.taskOnly.label'"
      >
        <template #task><VarText :parts="[{ name: 'task', value: ade.taskTitle }]" /></template>
        <template #branch
          ><VarText
            :parts="[{ name: 'branch', value: ade.branchLabel ?? '', kind: 'branch' }]"
          /></template
        >
      </CatalogText>
    </div>
  </div>
</template>
