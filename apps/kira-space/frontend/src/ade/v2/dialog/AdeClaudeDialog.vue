<script setup lang="ts">
import { Alert, AlertDescription } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@theme/components/ui/dialog';
import { Switch } from '@theme/components/ui/switch';
import { Textarea } from '@theme/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@theme/components/ui/toggle-group';
import { computed, ref } from 'vue';
import AdeActivityIcon from '../AdeActivityIcon.vue';
import AdeRepoTag from '../AdeRepoTag.vue';
import AdeTip from '../AdeTip.vue';
import AdeSetupProgress from '../panel/AdeSetupProgress.vue';
import { useAdeDialogsStore } from '../state/adeDialogs';
import { ACTION_CLASS } from '../tones';
import { composeDialog } from './compose';

// The one Claude dialog every opener shares (mockup `dlg`): kind-specific title, busy alert, targets,
// editable message, push switch and archive risk, then Cancel and the kind's send button.
const dialogs = useAdeDialogsStore();
const sending = ref(false);
// The chosen target chip wears the Claude tone, as the mockup's `chipStyle`. The hover and state
// variants repeat the colours: the toggle's own variant classes outrank the plain ones.
const CHIP_ON_CLASS =
  'border-claude bg-claude/16 text-claude hover:bg-claude/16 hover:text-claude data-[state=on]:bg-claude/16';

const view = computed(() => {
  const c = dialogs.ctx;
  const s = dialogs.spec;
  if (!c || !s) return null;
  return composeDialog(c, s, { msg: dialogs.msg, push: dialogs.push, override: dialogs.override });
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
    <DialogContent :show-close-button="false" class="flex max-h-4/5 w-140 flex-col gap-0 p-0" data-testid="ade-dialog">
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
          <span class="text-kira-lg font-bold" data-testid="ade-dialog-title">{{ view.title }}</span>
        </DialogTitle>
      </DialogHeader>

      <div class="flex min-h-0 flex-col gap-3 overflow-auto px-3 py-2 text-kira-md">
        <Alert v-if="view.headless" variant="destructive" data-testid="ade-dialog-headless">
          <AlertDescription>{{ view.headless }}</AlertDescription>
        </Alert>
        <Alert v-else-if="view.busyShown" variant="destructive" data-testid="ade-dialog-busy">
          <AlertDescription>
            <div class="flex items-start gap-2.5">
              <div class="flex min-w-0 flex-1 flex-col gap-1">
                <span class="font-bold">{{ view.busyTitle }}</span>
                <div v-for="row in view.busy" :key="row.text" class="flex items-center gap-1.5 text-kira-sm" data-testid="ade-dialog-busy-row">
                  <AdeActivityIcon :kind="row.kind" />
                  <span>{{ row.text }}</span>
                </div>
              </div>
              <Button
                variant="dialog-danger"
                size="sm"
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

        <div v-if="view.isArchive" class="text-kira-md text-tone-amber" data-testid="ade-dialog-risk">
          {{ view.riskText }}. Tell Claude what to do with it, or delete the worktrees anyway.
        </div>

        <div v-for="(tg, i) in view.targets" :key="tg.branchId" class="flex flex-col gap-1.5" data-testid="ade-dialog-target">
          <div class="flex items-center gap-2">
            <AdeRepoTag :code-repo-id="tg.repoId" :label="tg.repo" />
            <span class="min-w-0 flex-1 truncate font-data text-kira-sm">{{ tg.branch }}</span>
          </div>
          <ToggleGroup
            type="single"
            size="kira-lg"
            class="flex-wrap justify-start gap-1.5"
            :model-value="tg.options.find((o) => o.on)?.value"
            :data-testid="`ade-dialog-target-${i}`"
            @update:model-value="(v) => v && dialogs.pick(tg.branchId, String(v))"
          >
            <ToggleGroupItem
              v-for="opt in tg.options"
              :key="opt.value"
              :value="opt.value"
              class="border font-data text-kira-sm"
              :class="opt.on && CHIP_ON_CLASS"
            >
              {{ opt.label }}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <label v-if="view.canPush" for="ade-dialog-push" class="flex items-center gap-2 text-kira-sm">
          <Switch id="ade-dialog-push" v-model="dialogs.push" data-testid="ade-dialog-push" />
          <span>
            <span data-testid="ade-dialog-push-label">{{ view.pushLabel }}</span>
            <span v-if="!dialogs.push" class="text-subtle"> (off: stays local, push it yourself later)</span>
          </span>
        </label>

        <div class="flex flex-col gap-1">
          <div class="flex items-center gap-2">
            <label for="ade-dialog-message" class="flex-1 text-muted-foreground">Message to Claude</label>
            <Button
              v-if="view.edited"
              variant="ghost"
              size="xs"
              class="px-2 text-muted-foreground"
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
        </div>

        <Alert v-if="dialogs.error" variant="destructive" data-testid="ade-dialog-error">
          <AlertDescription>{{ dialogs.error }}</AlertDescription>
        </Alert>
      </div>

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
