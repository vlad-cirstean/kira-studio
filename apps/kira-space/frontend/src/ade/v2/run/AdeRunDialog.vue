<script setup lang="ts">
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@theme/components/ui/dialog';
import { Input } from '@theme/components/ui/input';
import { Textarea } from '@theme/components/ui/textarea';
import { computed, ref, watch } from 'vue';
import AdeRepoTag from '../AdeRepoTag.vue';
import { branchSlug, defaultRunMessage, FINISH_STEP_SUFFIX } from '../board/runMessage';
import AdeSetupProgress from '../panel/AdeSetupProgress.vue';
import { usePlanModel } from '../plan/usePlanModel';
import { useSpaceTools, useStartRun } from '../queries';
import { useAdeBoardUiStore } from '../state/adeBoardUi';
import { actionStyle } from '../tones';

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
const error = ref('');
const busy = ref(false);
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
    error.value = '';
  },
);

async function send(): Promise<void> {
  if (!card.value) return;
  busy.value = true;
  error.value = '';
  try {
    const branchNames: Record<string, string> = {};
    for (const r of named.value) branchNames[r.id] = (names.value[r.id] ?? '').trim();
    await start.mutateAsync({
      taskId: card.value.task.id,
      branchNames,
      message: edited.value ? message.value : '',
    });
    close();
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="(v) => !v && close()">
    <DialogContent :show-close-button="false" class="w-135" data-testid="ade-run-dialog">
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
            :style="{ stroke: actionStyle('claude').background }"
          >
            <rect x="3" y="4" width="18" height="16" rx="3" />
            <path d="M7 10l3 2-3 2M12 15h5" />
          </svg>
          Run {{ stage?.name ?? '' }} in the background
        </DialogTitle>
      </DialogHeader>
      <div class="flex flex-col gap-3 px-3 py-2 text-kira-md">
        <div v-if="named.length" class="flex flex-col gap-1.5" data-testid="ade-run-branches">
          <div v-for="r in named" :key="r.id" class="flex items-center gap-2.5">
            <AdeRepoTag :code-repo-id="r.branch.codeRepoId" :label="r.repo" />
            <label :for="`ade-run-branch-${r.id}`" class="whitespace-nowrap text-muted-foreground">branch</label>
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
        <div class="flex flex-col gap-1">
          <div class="flex items-center gap-2">
            <label for="ade-run-message" class="flex-1 text-muted-foreground">Message to Claude</label>
            <Button
              v-if="edited"
              variant="ghost"
              size="xs"
              class="px-2 text-muted-foreground"
              data-testid="ade-run-reset"
              @click="message = initial"
            >
              Reset
            </Button>
          </div>
          <div class="overflow-hidden rounded-kira border border-border bg-field">
            <Textarea
              id="ade-run-message"
              v-model="message"
              class="max-h-90 resize-y rounded-none border-0"
              data-testid="ade-run-message"
            />
            <p
              class="m-0 border-t border-border px-3 py-2 text-kira-sm text-subtle"
              data-testid="ade-run-suffix"
            >
              {{ FINISH_STEP_SUFFIX }}
            </p>
          </div>
        </div>
        <Alert v-if="error" variant="destructive" data-testid="ade-run-error">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>
      </div>
      <DialogFooter>
        <Button variant="dialog" size="kira-lg" data-testid="ade-run-cancel" @click="close">Cancel</Button>
        <Button
          variant="dialog-primary"
          size="kira-lg"
          :style="actionStyle('claude')"
          :disabled="busy"
          data-testid="ade-run-send"
          @click="send"
        >
          Run in background
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
