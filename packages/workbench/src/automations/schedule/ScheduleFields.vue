<script setup lang="ts">
import type { ScriptKind, ScriptParam, ScriptSchedule } from '@shared/domain/scripts';
import { keepPreviousData, useQuery } from '@tanstack/vue-query';
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
import { Field, FieldDescription, FieldError, FieldLabel } from '@theme/components/ui/field';
import { Input } from '@theme/components/ui/input';
import { Label } from '@theme/components/ui/label';
import { NativeSelect } from '@theme/components/ui/native-select';
import { Popover, PopoverContent, PopoverTrigger } from '@theme/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@theme/components/ui/radio-group';
import { Switch } from '@theme/components/ui/switch';
import { refDebounced } from '@vueuse/core';
import { queryClient } from '@workbench/state/queryClient';
import { computed, ref, useId, watch } from 'vue';
import { useAutomationsModule } from '../module';
import AdeContextFields from '../run/AdeContextFields.vue';
import ParamsForm from '../run/ParamsForm.vue';
import { useNextFires } from './scheduleQueries';
import { fireText, SCHEDULE_PRESETS, timezones } from './scheduleText';

// The recurring-script part of the script editor: when, where and how a scheduled run starts.
// `scriptId` is null for a script not saved yet; the ADE task picker needs a saved script.
const props = defineProps<{
  scriptId: string | null;
  kind: ScriptKind;
  params: readonly ScriptParam[];
}>();
const schedule = defineModel<ScriptSchedule>({ required: true });
const ctx = useAutomationsModule();
const idBase = useId();

function patch(change: Partial<ScriptSchedule>): void {
  schedule.value = { ...schedule.value, ...change };
}

const cronNow = computed(() => schedule.value.cron);
const cron = refDebounced(cronNow, 250);
const fires = useNextFires(cron, () => schedule.value.timezone, 3);
const nextText = computed(() =>
  (fires.data.value ?? []).map((ms) => fireText(ms, schedule.value.timezone)).join(', '),
);
const cronError = computed(() => {
  if (!fires.isError.value) return null;
  const e = fires.error.value;
  return e instanceof Error ? e.message : String(e);
});

const zoneOpen = ref(false);
const zones = timezones();
function pickZone(zone: string): void {
  patch({ timezone: zone });
  zoneOpen.value = false;
}

const secrets = computed(() => props.params.filter((p) => p.secret));
const plain = computed(() => props.params.filter((p) => !p.secret));
const values = computed({
  get: () =>
    Object.fromEntries(plain.value.map((p) => [p.name, schedule.value.params[p.name] ?? [...p.default]])),
  set: (v: Record<string, string[]>) => patch({ params: v }),
});

// "Run without asking" cannot hold a secret: a schedule never stores one.
const askLocked = computed(() => secrets.value.length > 0);
watch(
  askLocked,
  (locked) => {
    if (locked && !schedule.value.confirm) patch({ confirm: true });
  },
  { immediate: true },
);

const where = ref<'folder' | 'task'>(schedule.value.taskId === '' ? 'folder' : 'task');
function setWhere(w: 'folder' | 'task'): void {
  where.value = w;
  if (w === 'folder') patch({ taskId: '', branchId: '' });
}

const tasks = useQuery(
  {
    queryKey: computed(() => [
      'scriptRuns',
      'scheduleTasks',
      props.scriptId,
      schedule.value.taskId,
      schedule.value.branchId,
    ]),
    queryFn: () =>
      ctx.runs.preview({
        scriptId: props.scriptId ?? '',
        params: {},
        prompt: null,
        taskId: schedule.value.taskId,
        branchId: schedule.value.branchId,
        listTasks: true,
      }),
    enabled: computed(() => ctx.ade && where.value === 'task' && props.scriptId !== null),
    placeholderData: keepPreviousData,
    staleTime: 0,
    retry: false,
  },
  queryClient,
);
const taskId = computed({
  get: () => schedule.value.taskId,
  set: (v: string) => patch({ taskId: v }),
});
const branchId = computed({
  get: () => schedule.value.branchId,
  set: (v: string) => patch({ branchId: v }),
});
const appName = computed(() => (ctx.ade ? 'Kira Space' : 'Kira Studio'));
</script>

<template>
  <div class="flex flex-col gap-3 rounded-kira-sm border border-border p-3" data-testid="schedule-fields">
    <Field>
      <FieldLabel :for="`${idBase}-cron`">Repeat</FieldLabel>
      <div class="flex items-center gap-1.5">
        <Input
          :id="`${idBase}-cron`"
          :model-value="schedule.cron"
          spellcheck="false"
          class="font-data"
          placeholder="0 9 * * 1-5"
          data-testid="schedule-cron"
          @update:model-value="(v) => patch({ cron: String(v) })"
        />
        <NativeSelect
          model-value=""
          variant="bordered"
          size="kira-lg"
          aria-label="Presets"
          data-testid="schedule-preset"
          @update:model-value="(v) => v !== '' && patch({ cron: String(v) })"
        >
          <option value="">Presets…</option>
          <option v-for="p in SCHEDULE_PRESETS" :key="p.cron" :value="p.cron">{{ p.label }}</option>
        </NativeSelect>
      </div>
      <FieldError v-if="cronError" data-testid="schedule-cron-error">{{ cronError }}</FieldError>
      <FieldDescription v-else-if="nextText" data-testid="schedule-next">Next: {{ nextText }}</FieldDescription>
      <FieldDescription v-else>Minute hour day month weekday.</FieldDescription>
    </Field>

    <Field>
      <FieldLabel :for="`${idBase}-zone`">Timezone</FieldLabel>
      <Popover v-model:open="zoneOpen">
        <PopoverTrigger as-child>
          <Button
            :id="`${idBase}-zone`"
            variant="dialog"
            size="kira-lg"
            class="justify-between"
            data-testid="schedule-timezone"
          >
            <span class="truncate">{{ schedule.timezone }}</span>
            <CodiconIcon name="chevron-down" :size="12" />
          </Button>
        </PopoverTrigger>
        <PopoverContent class="w-96 max-w-[80vw] p-0">
          <Command :model-value="schedule.timezone" @update:model-value="(v) => pickZone(String(v))">
            <CommandInput placeholder="Find a timezone…" />
            <CommandList>
              <CommandEmpty>No timezone.</CommandEmpty>
              <CommandGroup>
                <CommandItem v-for="z in zones" :key="z" :value="z" :data-testid="`schedule-zone-${z}`">{{ z }}</CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </Field>

    <Field orientation="horizontal">
      <Switch
        :id="`${idBase}-enabled`"
        :model-value="schedule.enabled"
        data-testid="schedule-enabled"
        @update:model-value="(v) => patch({ enabled: Boolean(v) })"
      />
      <Label :for="`${idBase}-enabled`">Enabled</Label>
    </Field>

    <Field>
      <div class="flex items-center gap-2">
        <Switch
          :id="`${idBase}-quiet`"
          :model-value="!schedule.confirm"
          :disabled="askLocked"
          data-testid="schedule-quiet"
          @update:model-value="(v) => patch({ confirm: !v })"
        />
        <Label :for="`${idBase}-quiet`">Run without asking</Label>
      </div>
      <FieldDescription v-if="askLocked" data-testid="schedule-quiet-why">
        Needs your answer each time: this script has a secret parameter, and a schedule never stores one.
      </FieldDescription>
      <FieldDescription v-else-if="schedule.confirm">A popup asks before each run.</FieldDescription>
      <FieldDescription v-else>Runs as soon as it is due, with no popup.</FieldDescription>
    </Field>

    <Field v-if="kind === 'script'">
      <FieldLabel :for="`${idBase}-timeout`">Timeout</FieldLabel>
      <Input
        :id="`${idBase}-timeout`"
        :model-value="schedule.timeout"
        placeholder="30m"
        class="w-32 font-data"
        data-testid="schedule-timeout"
        @update:model-value="(v) => patch({ timeout: String(v) })"
      />
      <FieldDescription>Between 1m and 24h. A run still going at the limit is stopped.</FieldDescription>
    </Field>

    <ParamsForm v-if="plain.length > 0" v-model="values" :params="plain" />

    <Field v-if="ctx.ade">
      <FieldLabel>Where</FieldLabel>
      <RadioGroup
        :model-value="where"
        class="gap-1.5"
        data-testid="schedule-where"
        @update:model-value="(v) => setWhere(v === 'task' ? 'task' : 'folder')"
      >
        <div class="flex items-center gap-2">
          <RadioGroupItem :id="`${idBase}-folder`" value="folder" data-testid="schedule-where-folder" />
          <Label :for="`${idBase}-folder`">Script folder</Label>
        </div>
        <div class="flex items-center gap-2">
          <RadioGroupItem :id="`${idBase}-task`" value="task" data-testid="schedule-where-task" />
          <Label :for="`${idBase}-task`">An ADE task</Label>
        </div>
      </RadioGroup>
      <template v-if="where === 'task'">
        <FieldDescription v-if="scriptId === null" data-testid="schedule-task-save">
          Save the script, then edit it to pick a task.
        </FieldDescription>
        <AdeContextFields
          v-else-if="tasks.data.value"
          v-model:task-id="taskId"
          v-model:branch-id="branchId"
          :needs="tasks.data.value.needs"
          :ade="tasks.data.value.ade"
        />
        <FieldError v-if="tasks.isError.value" data-testid="schedule-task-error">
          {{ tasks.error.value?.message }}
        </FieldError>
      </template>
    </Field>

    <FieldDescription data-testid="schedule-note">
      Runs only while {{ appName }} is open. Missed runs are skipped. A run still going, or still
      waiting for your answer, makes the next one skip.
    </FieldDescription>
  </div>
</template>
