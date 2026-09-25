<script setup lang="ts">
import CodiconIcon from '@theme/CodiconIcon.vue';
import { Button } from '@theme/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@theme/components/ui/dialog';
import { Input } from '@theme/components/ui/input';
import { nextTick, ref, watch } from 'vue';
import { useCodeReposStore } from '../state/coderepos';
import { useGitCredentialStore } from '../state/gitCredential';

const gitCredentialStore = useGitCredentialStore();

const codeReposStore = useCodeReposStore();

// P67e (docs/v1.6/plans/P67e-git-relax-read-only.md D10) — the native counterpart to git's own
// askpass prompt (fetch/pull/push against an HTTPS remote with no credential helper configured).
// A separate, always-mounted dialog at App.vue's root, the same precedent GitPairingDialog.vue
// sets: a pull started in the Git module must stay answerable after switching to Studio, so this
// mounts once and self-gates on gitCredentialStore.active rather than living inside whichever
// repo tab happened to trigger the remote op. Renders nothing while active is null.
//
// The typed value never outlives this dialog: it lives only in `value` below, cleared in the same
// statement that settles (submit, cancel, Escape or the frame's own close), and is never logged,
// persisted, or read by anything other than answerCredential's own synchronous call.

const value = ref('');
const inputField = ref<InstanceType<typeof Input> | null>(null);

watch(
  () => gitCredentialStore.active,
  (active) => {
    value.value = '';
    if (active) {
      // Input.vue's own root IS the <input> element, unlike TextField's wrapping <span> --
      // $el already is the real input, no querySelector needed.
      void nextTick(() => (inputField.value?.$el as HTMLInputElement | undefined)?.focus());
    }
  },
);

function onSubmit(): void {
  if (!gitCredentialStore.active) return;
  const secret = value.value;
  value.value = '';
  gitCredentialStore.answerCredential(secret);
}

function onCancel(): void {
  value.value = '';
  gitCredentialStore.answerCredential(null);
}
</script>

<template>
  <Dialog v-if="gitCredentialStore.active" :open="true" @update:open="(v) => !v && onCancel()">
    <DialogContent
      :show-close-button="false"
      data-testid="git-credential-dialog"
      class="flex flex-col p-0 gap-0 w-110 max-h-4/5"
    >
      <DialogHeader>
        <DialogTitle>Git credentials</DialogTitle>
        <DialogClose as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            class="ml-auto"
            aria-label="Close"
            data-testid="git-credential-dialog-close"
            @click="onCancel"
          >
            <CodiconIcon name="close" :size="13" />
          </Button>
        </DialogClose>
      </DialogHeader>

      <div class="flex flex-col gap-1 px-3 py-2 overflow-auto">
        <p class="m-0 text-subtle" data-testid="git-credential-repo">
          {{ codeReposStore.codeRepoRecord(gitCredentialStore.active.codeRepoId)?.name }}
        </p>
        <!-- git's own text, rendered verbatim — never reformatted, never parsed. -->
        <p class="font-data whitespace-pre-wrap mb-0.5" data-testid="git-credential-prompt">
          {{ gitCredentialStore.active.prompt }}
        </p>
        <Input
          ref="inputField"
          v-model="value"
          :type="gitCredentialStore.active.masked ? 'password' : 'text'"
          class="h-control-lg w-full rounded-kira-sm border-border-strong bg-field px-2 font-data"
          data-testid="git-credential-input"
          @keydown.enter="onSubmit"
        />
      </div>

      <DialogFooter>
        <span class="flex items-center gap-1 ml-auto">
          <Button variant="dialog" size="kira-lg" data-testid="git-credential-cancel" @click="onCancel">
            Cancel
          </Button>
          <Button
            variant="dialog-primary"
            size="kira-lg"
            data-testid="git-credential-submit"
            @click="onSubmit"
          >
            Continue
          </Button>
        </span>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
