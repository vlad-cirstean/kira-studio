<script setup lang="ts">
import SecondaryTabs from '@theme/components/SecondaryTabs.vue';
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@theme/components/ui/dialog';
import { FieldLabel } from '@theme/components/ui/field';
import { Label } from '@theme/components/ui/label';
import { Switch } from '@theme/components/ui/switch';
import { Textarea } from '@theme/components/ui/textarea';
import { computed, ref } from 'vue';
import AdeActivityIcon from '../AdeActivityIcon.vue';
import AdeBasePicker from '../AdeBasePicker.vue';
import AdeRepoTag from '../AdeRepoTag.vue';
import AdeTip from '../AdeTip.vue';
import { baseOf } from '../board/rebaseActions';
import AdeSetupProgress from '../panel/AdeSetupProgress.vue';
import { useRebasePreview } from '../queries';
import { useAdeDialogsStore } from '../state/adeDialogs';
import { ACTION_CLASS } from '../tones';
import { composeDialog, isRebaseKind } from './compose';

// The one Claude dialog every opener shares (mockup `dlg`): kind-specific title, busy alert, targets,
// editable message, push switch and archive risk, then Cancel and the kind's send button.
const dialogs = useAdeDialogsStore();
const sending = ref(false);
// The rebase kinds show the server's own prompt; a pick or a switch asks for it again.
const previewArgs = computed(() => {
  const s = dialogs.spec;
  if (!s || !isRebaseKind(s) || s.draft) return null;
  return {
    branchId: s.branchId ?? '',
    onto: s.onto ?? null,
    queueWith: s.queueWith ?? '',
    push: dialogs.push,
    autostash: dialogs.autostash,
  };
});
const preview = useRebasePreview(previewArgs);

const view = computed(() => {
  const c = dialogs.ctx;
  const s = dialogs.spec;
  if (!c || !s) return null;
  return composeDialog(c, s, {
    msg: dialogs.msg,
    push: dialogs.push,
    override: dialogs.override,
    autostash: dialogs.autostash,
    preview: preview.data.value ?? null,
  });
});

const previewError = computed(() => {
  const e = preview.error.value;
  return e ? (e instanceof Error ? e.message : String(e)) : '';
});

// Change base: the branch being rebased, for the picker's repo and the base it shows now.
const baseBranch = computed(() => {
  const s = dialogs.spec;
  return s?.kind === 'changeBase' ? dialogs.ctx?.graph.byBranch.get(s.branchId ?? '') : undefined;
});
const currentBase = computed(() => {
  const c = dialogs.ctx;
  const b = baseBranch.value;
  return c && b ? baseOf(b, c.graph, c.repoState(b.codeRepoId).mainName) : '';
});

// The launch waits behind a prepare script: show each branch's, and why it is held or refused.
// A stage launch covers the whole task; the other kinds cover their targets.
const setups = computed(() => {
  const c = dialogs.ctx;
  const v = view.value;
  const spec = dialogs.spec;
  if (!c || !v || !spec || v.isArchive) return [];
  const ids =
    spec.kind === 'stage'
      ? [...c.graph.byBranch.values()].filter((b) => b.taskId === spec.taskId).map((b) => b.id)
      : v.targets.map((tg) => tg.branchId);
  return ids.flatMap((id) => {
    const b = c.graph.byBranch.get(id);
    const state = b?.setup?.state;
    return b && b.kind === 'mine' && b.name !== '' && (state === 'running' || state === 'failed')
      ? [{ branch: b, repo: c.repo(b.codeRepoId).nick }]
      : [];
  });
});

async function send(): Promise<void> {
  sending.value = true;
  try {
    await dialogs.send();
  } finally {
    sending.value = false;
  }
}

async function discard(): Promise<void> {
  sending.value = true;
  try {
    await dialogs.discardAnyway();
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <Dialog v-if="view" :open="true" @update:open="(v) => !v && dialogs.close()">
    <DialogContent size="lg" data-testid="ade-dialog">
      <DialogHeader closable>
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
          <span class="text-kira-lg font-medium" data-testid="ade-dialog-title">{{ view.title }}</span>
        </DialogTitle>
      </DialogHeader>

      <DialogBody>
        <Alert v-if="view.headless" variant="destructive" data-testid="ade-dialog-headless">
          <AlertDescription>{{ view.headless }}</AlertDescription>
        </Alert>
        <Alert v-else-if="view.busyShown" variant="destructive" data-testid="ade-dialog-busy">
          <AlertDescription>
            <div class="flex items-start gap-2.5">
              <div class="flex min-w-0 flex-1 flex-col gap-1">
                <span class="font-medium">{{ view.busyTitle }}</span>
                <div v-for="row in view.busy" :key="row.text" class="flex items-center gap-1.5 text-kira-sm" data-testid="ade-dialog-busy-row">
                  <AdeActivityIcon :kind="row.kind" />
                  <span>{{ row.text }}</span>
                </div>
              </div>
              <Button
                variant="dialog-danger"
                size="kira-lg"
                class="shrink-0"
                data-testid="ade-dialog-override"
                @click="dialogs.override = !dialogs.override"
              >
                {{ view.overrideLabel }}
              </Button>
            </div>
          </AlertDescription>
        </Alert>

        <AdeSetupProgress
          v-for="s in setups"
          :key="s.branch.id"
          :branch="s.branch"
          :repo="s.repo"
          :compact="setups.length > 1"
          data-testid="ade-dialog-setup"
        />

        <div v-if="baseBranch" class="flex items-center gap-2" data-testid="ade-dialog-base">
          <span class="text-muted-foreground">Base</span>
          <AdeBasePicker
            :code-repo-id="baseBranch.codeRepoId"
            :branch-id="baseBranch.id"
            :model-value="dialogs.spec?.onto ?? null"
            :current="currentBase"
            @update:model-value="dialogs.pickBase"
          />
        </div>

        <Alert v-for="b in view.blockers" :key="b.branchId + b.kind" variant="destructive" data-testid="ade-dialog-blocker" :data-kind="b.kind">
          <AlertDescription>{{ b.text }}</AlertDescription>
        </Alert>
        <Label v-if="view.canAutostash" for="ade-dialog-autostash" class="text-kira-sm font-normal">
          <Switch id="ade-dialog-autostash" v-model="dialogs.autostash" data-testid="ade-dialog-autostash" />
          <span>Autostash: stash the uncommitted changes, rebase, then restore them</span>
        </Label>
        <p v-if="view.noOp" class="m-0 text-kira-sm text-muted-foreground" data-testid="ade-dialog-noop">
          The branch already sits on this base: saving only records it.
        </p>

        <div v-if="view.isArchive" class="text-kira-md text-tone-amber" data-testid="ade-dialog-risk">
          {{ view.riskText }}. Tell Claude what to do with it, or delete the worktrees anyway.
        </div>

        <div v-for="(tg, i) in view.targets" :key="tg.branchId" class="flex flex-col gap-1.5" data-testid="ade-dialog-target">
          <div class="flex items-center gap-2">
            <AdeRepoTag :code-repo-id="tg.repoId" :label="tg.repo" />
            <span class="min-w-0 flex-1 truncate font-data text-kira-sm">{{ tg.branch }}</span>
          </div>
          <SecondaryTabs
            variant="segmented"
            size="kira-lg"
            :model-value="tg.options.find((o) => o.on)?.value ?? ''"
            :items="tg.options"
            :data-testid="`ade-dialog-target-${i}`"
            @update:model-value="(v) => dialogs.pick(tg.branchId, v)"
          />
        </div>

        <Label v-if="view.canPush" for="ade-dialog-push" class="text-kira-sm font-normal">
          <Switch id="ade-dialog-push" v-model="dialogs.push" data-testid="ade-dialog-push" />
          <span>
            <span data-testid="ade-dialog-push-label">{{ view.pushLabel }}</span>
            <span v-if="!dialogs.push" class="text-subtle"> (off: stays local, push it yourself later)</span>
          </span>
        </Label>

        <div v-if="view.showMessage" class="flex flex-col gap-1">
          <div class="flex items-center gap-2">
            <FieldLabel for="ade-dialog-message" class="flex-1">Message to Claude</FieldLabel>
            <Button
              v-if="view.edited"
              variant="toolbar"
              size="kira"
              class="text-muted-foreground"
              data-testid="ade-dialog-reset"
              @click="dialogs.msg = null"
            >
              Reset
            </Button>
          </div>
          <Textarea
            id="ade-dialog-message"
            :model-value="view.message"
            class="max-h-90 resize-y"
            data-testid="ade-dialog-message"
            @update:model-value="(v) => (dialogs.msg = String(v))"
          />
          <pre
            v-if="view.suffix"
            class="m-0 whitespace-pre-wrap rounded-kira border border-border bg-bg px-2 py-1.5 font-data text-kira-sm text-muted-foreground"
            data-testid="ade-dialog-suffix"
            >{{ view.suffix }}</pre
          >
        </div>

        <Alert v-if="previewError" variant="destructive" data-testid="ade-dialog-preview-error">
          <AlertDescription>{{ previewError }}</AlertDescription>
        </Alert>

        <Alert v-if="dialogs.error" variant="destructive" data-testid="ade-dialog-error">
          <AlertDescription>{{ dialogs.error }}</AlertDescription>
        </Alert>
      </DialogBody>

      <DialogFooter>
        <Button variant="dialog" size="kira-lg" data-testid="ade-dialog-cancel" @click="dialogs.close()">Cancel</Button>
        <AdeTip v-if="view.isArchive" text="Skip Claude: delete the worktrees now; uncommitted changes are lost">
          <Button
            variant="dialog"
            size="kira-lg"
            class="border-tone-red-solid bg-transparent text-tone-red"
            :disabled="sending"
            data-testid="ade-dialog-delete"
            @click="discard"
          >
            Delete anyway
          </Button>
        </AdeTip>
        <Button
          variant="dialog-primary"
          size="kira-lg"
          :class="ACTION_CLASS[view.overridden ? 'red' : 'claude']"
          :disabled="view.blocked || view.sendDisabled || sending || dialogs.waitingSetup"
          data-testid="ade-dialog-send"
          @click="send"
        >
          {{ dialogs.waitingSetup ? 'Starts when ready…' : view.sendLabel }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
