import type { GitCredentialPrompt } from '@shared/domain/git';
import { hydrateThenSubscribe } from '@workbench/state/hydrateThenSubscribe';
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { control } from '../bridge/control';

// The Go relay's snapshot of open git credential prompts (native git ops and the ADE board). The
// prompt router (P246) picks the window and the order; GitCredentialDialog renders the entry whose
// ref is a request id here. Never logged or persisted: the typed secret lives only in the dialog
// and the argument to `answer`. Answering an id the server already gave up on is a no-op.
export const useGitCredentialStore = defineStore('gitCredential', () => {
  const prompts = ref<GitCredentialPrompt[]>([]);

  let unsubscribe: (() => void) | null = null;

  async function hydrateRelayPrompts(): Promise<void> {
    unsubscribe?.();
    unsubscribe = null;
    unsubscribe = await hydrateThenSubscribe({
      snapshot: () => control.gitCredentialPending(),
      subscribe: (cb) => control.onGitCredentialChanged(cb),
      apply: (list) => {
        prompts.value = [...list];
      },
    });
  }

  /** `null` is a dismissal. */
  async function answer(requestId: string, secret: string | null): Promise<void> {
    try {
      await control.gitCredentialProvide(requestId, secret);
    } catch {
      // the relay's own bound already ended the wait — nothing to log or recover.
    }
  }

  return { prompts, hydrateRelayPrompts, answer };
});
