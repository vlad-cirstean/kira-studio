import type { QueryClient } from '@tanstack/vue-query';
import { control } from '../bridge/control';
import { useGitCredentialStore } from '../state/gitCredential';
import { boardKey, prsKey } from './v2/queries';

/** Called once from `main.ts`, app lifetime, no teardown. Every board push re-reads the board and
 *  PR facts; a credential prompt joins the shared queue and is answered through the v2 broker. */
export function installAdeSignals(queryClient: QueryClient): void {
  control.onAdeTaskBoard(() => {
    void queryClient.invalidateQueries({ queryKey: boardKey, exact: true });
    void queryClient.invalidateQueries({ queryKey: prsKey, exact: true });
  });
  control.onAdeTaskCredential((request) => {
    useGitCredentialStore().enqueueCredentialRequest({
      codeRepoId: request.codeRepoId,
      prompt: request.prompt,
      masked: request.masked,
      answer: (secret: string | null) => {
        void control
          .adeTaskProvideCredential({ requestId: request.requestId, secret })
          .catch(() => {
            /* the broker's own bound already ended the wait. */
          });
      },
    });
  });
}
