<script setup lang="ts">
import { useIsMutating } from '@tanstack/vue-query';
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Alert, AlertDescription, AlertTitle } from '@theme/components/ui/alert';
import { Button } from '@theme/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@theme/components/ui/dialog';
import { Input } from '@theme/components/ui/input';
import { Switch } from '@theme/components/ui/switch';
import { Textarea } from '@theme/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@theme/components/ui/toggle-group';
import { computed } from 'vue';
import AdeActivityIcon from './AdeActivityIcon.vue';
import { composeDialog, type DialogCtx } from './dialogCompose';
import { useAdeActionsStore } from './state/adeActions';
import { useAdeUiStore } from './state/adeUi';
import { useAgentSessionsStore } from './state/agentSessions';

// P129 Part 4 §2.7: the one dialog every opener shares (mockup lines 472-543's own markup order) —
// archive's own risk `Alert` and `Just delete` button land in this file's own §0.16 commit; nothing
// in Part 4's shipped UI opens an archive dialog yet (§0.8), so `view.isArchive` is always `false`
// here for now. `ctx` is `null` while the repo's own snapshot hasn't loaded — the dialog can't have
// been opened from a `null` view either, but the guard keeps this component's own typing honest.
const props = defineProps<{ codeRepoId: string; ctx: DialogCtx | null }>();

const adeUiStore = useAdeUiStore();
const adeActionsStore = useAdeActionsStore();
const agentSessionsStore = useAgentSessionsStore();

const view = computed(() => {
  const dialog = adeUiStore.dialog;
  const ctx = props.ctx;
  if (!dialog || !ctx) return null;
  return composeDialog(
    ctx,
    dialog.spec,
    {
      msg: dialog.msg,
      push: dialog.push,
      override: dialog.override,
      branchName: dialog.branchName,
    },
    agentSessionsStore.activity,
  );
});

// §2.4: one shared pending state across every delivery mutation this repo's dialog can trigger
// (`useIsMutating`'s own fuzzy prefix match on `['ade','deliver',repo]`), so the Send button stays
// disabled for the whole multi-root sequential loop, not just its first RPC.
const pendingCount = useIsMutating(() => ({ mutationKey: ['ade', 'deliver', props.codeRepoId] }));
const sending = computed(() => pendingCount.value > 0);

function onCancel(): void {
  adeUiStore.closeDialog();
}

function onSend(): void {
  if (!props.ctx) return;
  void adeActionsStore.sendDialog(props.codeRepoId, props.ctx);
}

function onReset(): void {
  adeUiStore.setMsg(null);
}

function onMessageInput(v: string | number): void {
  adeUiStore.setMsg(String(v));
}

function onBranchNameInput(v: string | number): void {
  adeUiStore.setBranchName(String(v));
}

function onTogglePush(): void {
  adeUiStore.togglePush();
}

function onToggleOverride(): void {
  adeUiStore.toggleOverride();
}

function onPickTarget(index: number, choice: string): void {
  adeUiStore.pickTarget(index, choice);
}

function onPickWorktree(wt: string): void {
  if (wt === 'same' || wt === 'new') adeUiStore.pickWorktree(wt);
}
</script>

<template>
  <Dialog v-if="view" :open="true" @update:open="(v) => !v && onCancel()">
    <DialogContent
      :show-close-button="false"
      data-testid="ade-dialog"
      class="flex w-140 max-h-4/5 flex-col gap-0 p-0"
    >
      <DialogHeader>
        <span class="flex items-center gap-2">
          <CodiconIcon name="robot" :size="16" class="text-[#d97757]" />
          <DialogTitle>{{ view.title }}</DialogTitle>
        </span>
      </DialogHeader>

      <div class="flex flex-col gap-3 overflow-auto px-3 py-2">
        <Alert v-if="view.busyShown" variant="destructive" data-testid="ade-dialog-busy">
          <AlertTitle>{{ view.busyTitle }}</AlertTitle>
          <AlertDescription>
            <div class="flex flex-col gap-1">
              <div v-for="(row, i) in view.busy" :key="i" class="flex items-center gap-1.5">
                <AdeActivityIcon :kind="row.kind" />
                <span>{{ row.text }}</span>
              </div>
              <Button
                variant="dialog-danger"
                size="sm"
                class="mt-1 self-start"
                data-testid="ade-dialog-override"
                @click="onToggleOverride"
              >
                {{ view.overrideLabel }}
              </Button>
            </div>
          </AlertDescription>
        </Alert>

        <Input
          v-if="view.isDraft"
          :model-value="adeUiStore.dialog?.branchName ?? ''"
          placeholder="optional, Claude picks one if empty"
          data-testid="ade-dialog-branch"
          @update:model-value="onBranchNameInput"
        />

        <div v-for="(tg, i) in view.targets" :key="i" class="flex flex-col gap-1">
          <div class="flex items-baseline gap-2">
            <span class="text-kira-sm text-muted-foreground">{{ tg.title }}</span>
            <span v-if="tg.branch" class="font-data text-kira-sm">{{ tg.branch }}</span>
          </div>
          <ToggleGroup
            type="single"
            size="kira"
            :model-value="tg.options.find((o) => o.on)?.value"
            :data-testid="`ade-dialog-target-${i}`"
            @update:model-value="(v) => v && onPickTarget(i, v as string)"
          >
            <ToggleGroupItem v-for="opt in tg.options" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <ToggleGroup
          v-if="view.askWt"
          type="single"
          size="kira"
          :model-value="adeUiStore.dialog?.spec.wt"
          data-testid="ade-dialog-worktree"
          @update:model-value="(v) => v && onPickWorktree(v as string)"
        >
          <ToggleGroupItem v-for="opt in view.wtOptions" :key="opt.value" :value="opt.value">
            {{ opt.label }}
          </ToggleGroupItem>
        </ToggleGroup>

        <label v-if="view.canPush" for="ade-dialog-push" class="flex items-center gap-2 text-kira-sm">
          <Switch
            id="ade-dialog-push"
            :model-value="view.pushOn"
            data-testid="ade-dialog-push"
            @update:model-value="onTogglePush"
          />
          Also force-push after rebasing (off: stays local, push it yourself later)
        </label>

        <div class="flex flex-col gap-1">
          <Textarea
            :model-value="view.message"
            rows="10"
            class="font-data"
            data-testid="ade-dialog-message"
            @update:model-value="onMessageInput"
          />
          <Button
            v-if="view.edited"
            variant="link"
            size="sm"
            class="self-start"
            data-testid="ade-dialog-reset"
            @click="onReset"
          >
            Reset
          </Button>
        </div>

        <Alert v-if="adeUiStore.dialog?.error" variant="destructive" data-testid="ade-dialog-error">
          <AlertDescription>{{ adeUiStore.dialog?.error }}</AlertDescription>
        </Alert>
      </div>

      <DialogFooter>
        <span class="ml-auto flex items-center gap-1">
          <Button variant="dialog" size="kira-lg" data-testid="ade-dialog-cancel" @click="onCancel">
            Cancel
          </Button>
          <Button
            :variant="view.overridden ? 'dialog-danger' : 'dialog-primary'"
            size="kira-lg"
            :disabled="view.blocked || view.sendDisabled || sending"
            data-testid="ade-dialog-send"
            @click="onSend"
          >
            {{ view.sendLabel }}
          </Button>
        </span>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
