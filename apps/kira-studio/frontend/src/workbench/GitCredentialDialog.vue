<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { useCodeReposStore } from '../state/coderepos';
import { useGitCredentialStore } from '../state/gitCredential';
import AppButton from '../theme/primitives/AppButton.vue';
import DialogFrame from '../theme/primitives/DialogFrame.vue';
import TextField from '../theme/primitives/TextField.vue';

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
// Bare $el shape (SearchToolbar.vue's own precedent) — TextField's root is one <span>, its real
// <input> is one query away.
const inputField = ref<{ $el: HTMLElement } | null>(null);

watch(
  () => gitCredentialStore.active,
  (active) => {
    value.value = '';
    if (active) {
      void nextTick(() => inputField.value?.$el.querySelector('input')?.focus());
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
  <DialogFrame
    v-if="gitCredentialStore.active"
    title="Git credentials"
    :width="440"
    test-id="git-credential-dialog"
    close-test-id="git-credential-dialog-close"
    @close="onCancel"
  >
    <div class="credential-form">
      <p class="subtitle" data-testid="git-credential-repo">
        {{ codeReposStore.codeRepoRecord(gitCredentialStore.active.codeRepoId)?.name }}
      </p>
      <!-- git's own text, rendered verbatim — never reformatted, never parsed. -->
      <p class="prompt mono" data-testid="git-credential-prompt">
        {{ gitCredentialStore.active.prompt }}
      </p>
      <TextField
        ref="inputField"
        v-model="value"
        :type="gitCredentialStore.active.masked ? 'password' : 'text'"
        size="md"
        data-testid="git-credential-input"
        @enter="onSubmit"
      />
    </div>

    <template #footer>
      <span class="p-dialog-actions end footer-actions p-push">
        <AppButton kind="dialog" data-testid="git-credential-cancel" @click="onCancel">
          Cancel
        </AppButton>
        <AppButton
          kind="dialog"
          variant="primary"
          data-testid="git-credential-submit"
          @click="onSubmit"
        >
          Continue
        </AppButton>
      </span>
    </template>
  </DialogFrame>
</template>

<style scoped>
.credential-form {
  display: flex;
  flex-direction: column;
  gap: var(--kira-s-2);
  padding: var(--kira-s-4) var(--kira-s-5);
}

.subtitle {
  margin: 0;
  color: var(--kira-fg-subtle);
}

.prompt {
  margin: 0 0 var(--kira-s-1);
  white-space: pre-wrap;
}

.footer-actions {
  gap: var(--kira-s-2);
}
</style>
