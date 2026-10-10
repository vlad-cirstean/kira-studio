<script setup lang="ts">
import { useMutation, useQuery } from '@tanstack/vue-query';
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
import { Field, FieldLabel } from '@theme/components/ui/field';
import VarText from '@theme/components/VarText.vue';
import type { TextPart } from '@theme/varText';
import { refDebounced } from '@vueuse/core';
import { queryClient } from '@workbench/state/queryClient';
import { computed, ref, watch } from 'vue';
import { useAutomationsModule } from '../module';
import ParamsForm from '../run/ParamsForm.vue';
import RunPreview from '../run/RunPreview.vue';
import { useScriptRuns } from '../runs/runsQueries';
import SmartBadge from '../smart/SmartBadge.vue';
import { clockText } from './scheduleText';

// Asks before a scheduled run: a waiting run (`runId`) or a Run now request. Shows the resolved run
// (every variable through VarText) and the secret params the schedule never stores.
const props = defineProps<{ scriptId: string; runId: string | null; more: number }>();
const emit = defineEmits<{ close: [] }>();
const ctx = useAutomationsModule();

const script = computed(() => ctx.scripts.records().find((s) => s.id === props.scriptId) ?? null);
const secretParams = computed(() => (script.value?.params ?? []).filter((p) => p.secret));
const secrets = ref<Record<string, string[]>>({});
const debounced = refDebounced(secrets, 250);

// Secret values stay out of the query key; a change refetches by hand.
const preview = useQuery(
  {
    queryKey: ['scriptRuns', 'schedulePreview', props.scriptId, props.runId ?? 'now'],
    queryFn: () => ctx.runs.schedulePreview(props.scriptId, secrets.value),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  },
  queryClient,
);
watch(debounced, () => void preview.refetch());
const pv = computed(() => preview.data.value ?? null);
const settled = computed(
  () => JSON.stringify(debounced.value) === JSON.stringify(secrets.value) && !preview.isFetching.value,
);

const { data: runs } = useScriptRuns();
const waitingRun = computed(() => runs.value?.find((r) => r.id === props.runId) ?? null);
const due = computed(() => {
  const at = waitingRun.value?.createdAt;
  const tz = script.value?.schedule?.timezone ?? 'UTC';
  return at === undefined ? 'Now' : `Due ${clockText(at, tz)}`;
});

const error = ref<string | null>(null);
const accept = useMutation(
  {
    mutationKey: ['scriptRuns', 'confirmAccept'],
    mutationFn: async () => {
      const current = pv.value;
      if (!current) throw new Error('Nothing to run yet.');
      return props.runId
        ? ctx.runs.confirmAccept(props.runId, current.hash, secrets.value)
        : ctx.runs.runScheduleNow(props.scriptId, current.hash, secrets.value);
    },
    onSuccess: (started) => {
      ctx.openRunTab(started.runId, script.value?.name ?? 'Script');
      emit('close');
    },
    onError: (err) => {
      error.value = err instanceof Error ? err.message : String(err);
      void preview.refetch();
    },
  },
  queryClient,
);
const decline = useMutation(
  {
    mutationKey: ['scriptRuns', 'confirmDecline'],
    mutationFn: async () => {
      if (props.runId) await ctx.runs.confirmDecline(props.runId);
    },
    onSuccess: () => emit('close'),
    onError: (err) => {
      error.value = err instanceof Error ? err.message : String(err);
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
    !accept.isPending.value,
);

const promptParts = computed<TextPart[]>(() =>
  (pv.value?.prompt ?? []).map((p) => (p.var === '' ? p.text : { name: p.var, value: p.value })),
);
const adeParts = computed<TextPart[]>(() => {
  const a = pv.value?.ade;
  if (!a || a.taskId === '') return [];
  const parts: TextPart[] = ['Task ', { name: 'task', value: a.taskTitle }];
  if (a.branchLabel) parts.push(' on ', { name: 'branch', value: a.branchLabel });
  return parts;
});

function run(): void {
  if (!canRun.value) return;
  error.value = null;
  accept.mutate();
}
</script>

<template>
  <Dialog :open="true" @update:open="(v) => !v && emit('close')">
    <DialogContent
      :show-close-button="false"
      data-testid="schedule-confirm"
      class="flex flex-col gap-0 p-0 w-150 max-w-[90vw] max-h-4/5"
      @keydown.meta.enter.prevent="run"
      @keydown.ctrl.enter.prevent="run"
    >
      <DialogHeader>
        <DialogTitle>Run {{ script?.name ?? 'script' }}?</DialogTitle>
        <SmartBadge v-if="script?.kind === 'smart'" />
        <span class="text-kira-sm text-muted-foreground" data-testid="schedule-confirm-due">{{ due }}</span>
        <DialogClose as-child>
          <Button variant="ghost" size="icon-sm" class="ml-auto" aria-label="Close" data-testid="schedule-confirm-close">
            <CodiconIcon name="close" :size="13" />
          </Button>
        </DialogClose>
      </DialogHeader>

      <div class="flex flex-col gap-3 overflow-auto p-3">
        <Alert v-if="!script" variant="destructive" class="w-auto">
          <AlertDescription>This script no longer exists.</AlertDescription>
        </Alert>
        <template v-else>
          <div v-if="adeParts.length > 0" class="text-kira-sm text-muted-foreground" data-testid="schedule-confirm-ade">
            <VarText :parts="adeParts" />
          </div>
          <Field v-if="script.kind === 'smart' && pv" data-testid="schedule-confirm-prompt">
            <FieldLabel>Prompt</FieldLabel>
            <div class="rounded-kira-sm border border-border p-2 font-data text-kira-sm">
              <VarText :parts="promptParts" />
            </div>
            <div class="font-data text-kira-sm text-muted-foreground">{{ pv.suffix }}</div>
          </Field>
          <ParamsForm v-if="secretParams.length > 0" v-model="secrets" :params="secretParams" />
          <RunPreview v-if="pv" :preview="pv" />
          <Alert v-if="preview.isError.value" variant="destructive" class="w-auto" data-testid="schedule-confirm-preview-error">
            <AlertDescription>{{ preview.error.value?.message }}</AlertDescription>
          </Alert>
          <span v-if="pv && pv.missing.length > 0" class="text-kira-sm text-error" data-testid="schedule-confirm-missing">
            Fill in: {{ pv.missing.join(', ') }}
          </span>
          <span v-if="pv?.blocker" class="text-kira-sm text-error" data-testid="schedule-confirm-blocker">{{ pv.blocker }}</span>
          <Alert v-if="error" variant="destructive" class="w-auto" data-testid="schedule-confirm-error">
            <AlertDescription>{{ error }}</AlertDescription>
          </Alert>
        </template>
      </div>

      <DialogFooter class="justify-end">
        <span v-if="more > 0" class="mr-auto text-kira-sm text-muted-foreground" data-testid="schedule-confirm-more">
          {{ more }} more waiting
        </span>
        <Button
          variant="dialog"
          size="kira-lg"
          :disabled="decline.isPending.value"
          data-testid="schedule-confirm-decline"
          @click="runId ? decline.mutate() : emit('close')"
        >
          Not now
        </Button>
        <Button variant="dialog-primary" size="kira-lg" :disabled="!canRun" data-testid="schedule-confirm-run" @click="run">
          Run
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
