<script setup lang="ts">
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Card } from '@theme/components/ui/card';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@theme/components/ui/dialog';
import { FieldError } from '@theme/components/ui/field';
import { Input } from '@theme/components/ui/input';
import { Label } from '@theme/components/ui/label';
import { Textarea } from '@theme/components/ui/textarea';
import VarText from '@theme/components/VarText.vue';
import { t } from '@theme/i18n';
import SmartBadge from '@workbench/automations/smart/SmartBadge.vue';
import { useAsyncAction } from '@workbench/behaviour/asyncAction';
import { computed, ref, watch } from 'vue';
import { useCustomScriptsStore } from '../../../state/customScripts';
import AdeRepoTag from '../AdeRepoTag.vue';
import { smartBodyParts } from '../automation/smartStepBody';
import { branchSlug, defaultRunMessage, finishStepSuffix } from '../board/runMessage';
import AdeSetupProgress from '../panel/AdeSetupProgress.vue';
import { usePlanModel } from '../plan/usePlanModel';
import { useSpaceTools, useStartRun } from '../queries';
import { useAdeBoardUiStore } from '../state/adeBoardUi';
import { ACTION_CLASS } from '../tones';

// Agent stage Run dialog (SPEC2 section 5, R24): per-branch names for branches not created yet, the
// editable message and the read-only finish_step suffix the server always appends.
const ui = useAdeBoardUiStore();
const { model } = usePlanModel();
const start = useStartRun();
const card = computed(() => (ui.runTaskId ? (model.value?.cardFor(ui.runTaskId) ?? null) : null));
const open = computed(() => card.value !== null);
const close = (): void => {
  ui.runTaskId = null;
};
const stage = computed(() => card.value?.progress.stage ?? null);
const initial = computed(() =>
  card.value && stage.value
    ? defaultRunMessage({ title: card.value.title, jira: card.value.task.jira, stage: stage.value })
    : '',
);
// A smart first step runs its script's body: shown read-only, and no message is sent.
const scripts = useCustomScriptsStore();
const smartStep = computed(() => {
  const first = stage.value?.steps[0];
  return first && first.smartScript !== '' ? first : null;
});
const smartBody = computed(() => {
  const step = smartStep.value;
  const c = card.value;
  const script = step ? scripts.records.find((r) => r.name === step.smartScript) : undefined;
  if (!step || !c || !script) return null;
  return smartBodyParts(script.command, step.params, { task: c.title, jira: c.task.jira?.key ?? '' });
});
// The finish instruction the first step ends with, as its results declare it.
const suffix = computed(() => finishStepSuffix(stage.value?.steps[0]?.results ?? []));
const spaceTools = useSpaceTools(() => card.value?.task.workflowId ?? '');
const pending = computed(() => card.value?.rows.filter((r) => r.branch.kind === 'mine' && r.branch.name === '') ?? []);
// With the Kira Space tools on the agent names its branches (request_branch), so no name is asked.
const named = computed(() => (spaceTools.value ? [] : pending.value));
const slug = computed(() => `feat/${branchSlug(card.value?.title ?? '')}`);

// Setups of the task's branches still running or failed: the runs queue behind them after Start.
const setups = computed(() =>
  (card.value?.rows ?? []).filter(
    (r) => r.branch.kind === 'mine' && r.branch.name !== '' && ['running', 'failed'].includes(r.branch.setup?.state ?? ''),
  ),
);

const message = ref('');
const names = ref<Record<string, string>>({});
// Snapshot at open: a board push that renames the task must not make an untouched message read as edited.
const opening = ref('');
const edited = computed(() => message.value !== opening.value);

watch(
  open,
  (o) => {
    if (!o) return;
    opening.value = initial.value;
    message.value = initial.value;
    names.value = {};
    sending.error.value = null;
  },
);

const sending = useAsyncAction(async () => {
  if (!card.value) return;
  const branchNames: Record<string, string> = {};
  for (const r of named.value) branchNames[r.id] = (names.value[r.id] ?? '').trim();
  await start.mutateAsync({
    taskId: card.value.task.id,
    branchNames,
    message: edited.value && !smartStep.value ? message.value : '',
  });
  close();
});
const { pending: busy, error } = sending;
const send = sending.run;
</script>

<template>
  <Dialog :open="open" @update:open="(v) => !v && close()">
    <DialogContent size="lg" data-testid="ade-run-dialog">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
            class="stroke-claude"
          >
            <rect x="3" y="4" width="18" height="16" rx="3" />
            <path d="M7 10l3 2-3 2M12 15h5" />
          </svg>
          {{ t('space.ade.runDialog.title.title', { stage: stage?.name ?? '' }) }}
        </DialogTitle>
      </DialogHeader>
      <DialogBody class="flex flex-col gap-3 text-kira-md">
        <div v-if="named.length" class="flex flex-col gap-1.5" data-testid="ade-run-branches">
          <div v-for="r in named" :key="r.id" class="flex items-center gap-2.5">
            <AdeRepoTag :code-repo-id="r.branch.codeRepoId" :label="r.repo" />
            <Label :for="`ade-run-branch-${r.id}`" class="whitespace-nowrap text-muted-foreground">{{ t('common.field.branch.label') }}</Label>
            <Input
              :id="`ade-run-branch-${r.id}`"
              v-model="names[r.id]"
              class="flex-1 font-data"
              :placeholder="slug"
              data-testid="ade-run-branch"
            />
          </div>
        </div>
        <AdeSetupProgress
          v-for="r in setups"
          :key="r.id"
          :branch="r.branch"
          :repo="r.repo"
          data-testid="ade-run-setup"
        />
        <div v-if="smartStep" class="flex flex-col gap-1" data-testid="ade-run-smart">
          <div class="flex items-center gap-2 text-muted-foreground">
            <SmartBadge />
            <span>{{ smartStep.smartScript }}</span>
          </div>
          <Card v-if="smartBody" class="whitespace-pre-wrap font-data text-kira-sm" data-testid="ade-run-smart-body">
            <VarText :parts="smartBody" />
          </Card>
          <FieldError v-else data-testid="ade-run-smart-missing">{{ t('space.ade.runDialog.smartMissing.error') }}</FieldError>
          <p class="m-0 text-kira-sm text-subtle" data-testid="ade-run-suffix">{{ suffix }}</p>
        </div>
        <div v-else class="flex flex-col gap-1">
          <div class="flex items-center gap-2">
            <Label for="ade-run-message" class="flex-1 text-muted-foreground">{{ t('space.ade.claudeDialog.message.label') }}</Label>
            <Button
              v-if="edited"
              variant="toolbar"
              size="kira"
              data-testid="ade-run-reset"
              @click="message = initial"
            >
              {{ t('common.action.reset.label') }}
            </Button>
          </div>
          <div class="flex flex-col gap-1">
            <Textarea
              id="ade-run-message"
              v-model="message"
              class="max-h-90 resize-y"
              data-testid="ade-run-message"
            />
            <p
              class="m-0 text-kira-sm text-subtle"
              data-testid="ade-run-suffix"
            >
              {{ suffix }}
            </p>
          </div>
        </div>
        <Alert v-if="error" variant="error" data-testid="ade-run-error">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>
      </DialogBody>
      <DialogFooter>
        <Button variant="dialog" size="kira-lg" data-testid="ade-run-cancel" @click="close">{{ t('common.action.cancel.label') }}</Button>
        <Button
          variant="dialog-primary"
          size="kira-lg"
          :class="ACTION_CLASS.claude"
          :disabled="busy"
          data-testid="ade-run-send"
          @click="send"
        >
          {{ t('space.ade.claudeDialog.runInBackground.label') }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
