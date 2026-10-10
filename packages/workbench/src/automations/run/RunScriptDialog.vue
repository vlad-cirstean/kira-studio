<script setup lang="ts">
import type { ScriptRunArgs } from '@shared/domain/scriptRuns';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/vue-query';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@theme/components/ui/dialog';
import { Field, FieldDescription, FieldLabel } from '@theme/components/ui/field';
import { Textarea } from '@theme/components/ui/textarea';
import VarText from '@theme/components/VarText.vue';
import type { TextPart } from '@theme/varText';
import { refDebounced } from '@vueuse/core';
import { queryClient } from '@workbench/state/queryClient';
import { computed, ref } from 'vue';
import { useAutomationsModule } from '../module';
import SmartBadge from '../smart/SmartBadge.vue';
import AdeContextFields from './AdeContextFields.vue';
import ParamsForm from './ParamsForm.vue';
import RunPreview from './RunPreview.vue';

const props = defineProps<{
  scriptId: string;
  prefill?: Record<string, string[]>;
  taskId?: string;
  branchId?: string;
  from?: 'automations' | 'ade';
}>();
const emit = defineEmits<{ close: [] }>();
const ctx = useAutomationsModule();

const script = computed(() => ctx.scripts.records().find((s) => s.id === props.scriptId) ?? null);
const isSmart = computed(() => script.value?.kind === 'smart');

const values = ref<Record<string, string[]>>(
  Object.fromEntries(
    (script.value?.params ?? []).map((p) => [p.name, props.prefill?.[p.name] ?? [...p.default]]),
  ),
);
// null: use the saved prompt. A string is this run's own prompt; never saved.
const oneOff = ref<string | null>(null);
const taskId = ref(props.taskId ?? '');
const branchId = ref(props.branchId ?? '');

const args = computed<ScriptRunArgs>(() => ({
  scriptId: props.scriptId,
  params: values.value,
  prompt: oneOff.value,
  taskId: taskId.value,
  branchId: branchId.value,
}));
const debounced = refDebounced(args, 250);

const preview = useQuery(
  {
    queryKey: ['scriptRuns', 'preview', debounced],
    queryFn: () => ctx.runs.preview(debounced.value),
    placeholderData: keepPreviousData,
    staleTime: 0,
    retry: false,
  },
  queryClient,
);
const pv = computed(() => preview.data.value ?? null);
const settled = computed(
  () => JSON.stringify(debounced.value) === JSON.stringify(args.value) && !preview.isFetching.value,
);

const startError = ref<string | null>(null);
const start = useMutation(
  {
    mutationKey: ['scriptRuns', 'start'],
    mutationFn: async () => {
      const current = pv.value;
      if (!current) throw new Error('Nothing to run yet.');
      return ctx.runs.start(args.value, current.hash);
    },
    onSuccess: (started) => {
      const s = script.value;
      if (!s) return;
      if (started.terminal) {
        if (props.from === 'ade') ctx.showAutomations();
        ctx.openTerminalTab({
          cwd: started.terminal.cwd,
          launch: {
            command: s.command,
            label: s.name,
            color: s.color,
            kind: 'script',
            scriptId: s.id,
            launchToken: started.terminal.token,
          },
        });
      } else {
        ctx.openRunTab(started.runId, s.name);
      }
      emit('close');
    },
    onError: (err) => {
      startError.value = err instanceof Error ? err.message : String(err);
      void preview.refetch();
    },
  },
  queryClient,
);

const canRun = computed(
  () =>
    pv.value !== null &&
    settled.value &&
    pv.value.missing.length === 0 &&
    pv.value.blocker === '' &&
    !start.isPending.value,
);

const promptParts = computed<TextPart[]>(() =>
  (pv.value?.prompt ?? []).map((p) => (p.var === '' ? p.text : { name: p.var, value: p.value })),
);

function editPrompt(): void {
  oneOff.value = pv.value?.body ?? '';
}

function run(): void {
  if (!canRun.value) return;
  startError.value = null;
  start.mutate();
}
</script>

<template>
  <Dialog :open="true" @update:open="(v) => !v && emit('close')">
    <DialogContent
      :show-close-button="false"
      data-testid="run-dialog"
      class="flex flex-col gap-0 p-0 w-150 max-w-[90vw] max-h-4/5"
      @keydown.meta.enter.prevent="run"
      @keydown.ctrl.enter.prevent="run"
    >
      <DialogHeader>
        <DialogTitle>Run {{ script?.name ?? 'script' }}</DialogTitle>
        <SmartBadge v-if="isSmart" />
        <DialogClose as-child>
          <Button variant="ghost" size="icon-sm" class="ml-auto" aria-label="Close">
            <CodiconIcon name="close" :size="13" />
          </Button>
        </DialogClose>
      </DialogHeader>

      <div class="flex flex-col gap-3 overflow-auto p-3">
        <Alert v-if="!script" variant="destructive" class="w-auto">
          <AlertDescription>This script no longer exists.</AlertDescription>
        </Alert>
        <template v-else>
          <ParamsForm v-if="script.params.length > 0" v-model="values" :params="script.params" />

          <Field v-if="isSmart && pv" data-testid="run-prompt">
            <FieldLabel>Prompt</FieldLabel>
            <template v-if="oneOff === null">
              <div class="rounded-kira-sm border border-border p-2 font-data text-kira-sm" data-testid="run-prompt-text">
                <VarText :parts="promptParts" />
              </div>
              <Button variant="dialog" size="kira-lg" class="self-start" data-testid="run-prompt-edit" @click="editPrompt">
                Edit for this run
              </Button>
            </template>
            <template v-else>
              <Textarea
                :model-value="oneOff"
                rows="6"
                spellcheck="false"
                class="field-sizing-fixed min-h-32 resize-y font-data leading-normal"
                data-testid="run-prompt-input"
                @update:model-value="(v) => (oneOff = String(v))"
              />
              <div class="flex items-center gap-2">
                <Button variant="dialog" size="kira-lg" data-testid="run-prompt-reset" @click="oneOff = null">Reset</Button>
                <FieldDescription>Not saved to the script</FieldDescription>
              </div>
            </template>
            <FieldLabel class="mt-1 text-muted-foreground">Added by Kira</FieldLabel>
            <div class="font-data text-kira-sm text-muted-foreground" data-testid="run-suffix">{{ pv.suffix }}</div>
          </Field>

          <AdeContextFields
            v-if="pv && (pv.needs.tasks.length > 0 || pv.needs.branches.length > 0 || pv.ade)"
            v-model:task-id="taskId"
            v-model:branch-id="branchId"
            :needs="pv.needs"
            :ade="pv.ade"
          />

          <RunPreview v-if="pv" :preview="pv" />
          <Alert v-if="preview.isError.value" variant="destructive" class="w-auto" data-testid="run-preview-error">
            <AlertDescription>{{ preview.error.value?.message }}</AlertDescription>
          </Alert>
          <span v-if="pv && pv.missing.length > 0" class="text-kira-sm text-error" data-testid="run-missing">
            Fill in: {{ pv.missing.join(', ') }}
          </span>
          <span v-if="pv?.blocker" class="text-kira-sm text-error" data-testid="run-blocker">{{ pv.blocker }}</span>
          <Alert v-if="startError" variant="destructive" class="w-auto" data-testid="run-error">
            <AlertDescription>{{ startError }}</AlertDescription>
          </Alert>
        </template>
      </div>

      <DialogFooter class="justify-end">
        <DialogClose as-child>
          <Button variant="dialog" size="kira-lg" data-testid="run-cancel">Cancel</Button>
        </DialogClose>
        <Button variant="dialog-primary" size="kira-lg" :disabled="!canRun" data-testid="run-start" @click="run">
          Run
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
