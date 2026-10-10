import type { GitCredentialPrompt } from '@shared/domain/git';
import { hydrateThenSubscribe } from '@workbench/state/hydrateThenSubscribe';
import { defineStore } from 'pinia';
import { reactive, toRaw, toRefs } from 'vue';
import { control } from '../bridge/control';

// P67e (docs/v1.6/plans/P67e-git-relax-read-only.md D9) — the native counterpart to git's own
// askpass prompt, relayed here for the first time now that the native mount can push a remote op
// that needs it (a pull/push/fetch against an HTTPS remote with no credential helper configured).
// Mirrors state/confirmDialog.ts's own shape (reactive state + a settle function) — the existing
// mechanism for exactly this job, not a new one.
//
// Why a queue at all: RunRemote (gitsession/remote.go) claims one shared slot per repository, so a
// single repository can have at most one prompt outstanding — but each open repo workspace has its
// own gitsession.Conn and its own op slot, so two can prompt at once. One modal at a time, FIFO, is
// the honest answer; two stacked modals is not.
//
// No client-side timer: the Go-side askpass broker already bounds the wait at 120s
// (gitaskpass/broker.go), and answering a requestId the server has already given up on is a no-op,
// never an error (packages/git-ipc/src/contract.ts's own documented rule) — a second timer here
// would only be a second thing to get wrong.
//
// Never logged, never persisted, never stored anywhere beyond this one in-flight prompt: the typed
// secret lives only in the dialog's own TextField ref and the argument to `answer()`, both cleared
// on settle. The prompt text gets the same treatment — it can itself contain a username the user
// just typed (gitaskpass/prompt.go's own stated reason).
export interface PendingCredential {
  /** For the repo label, and for dropping this workspace's own entries on close. */
  readonly codeRepoId: string;
  /** git's own text, rendered verbatim — never reformatted, never parsed. */
  readonly prompt: string;
  readonly masked: boolean;
  /** Set for a prompt the Go relay holds (the ADE board's, P178): its
   *  server-side request id. Such an entry has no code repo (`codeRepoId` ''). */
  readonly relayId?: string;
  /** Shown instead of the code repo's name: "<source> · <repo folder>". */
  readonly label?: string;
  /** `null` for a dismissal — an absence the server would have to infer is explicitly not the
   *  wire's own contract. Closes over this request's id and this workspace's own transport. */
  readonly answer: (secret: string | null) => void;
}

export const useGitCredentialStore = defineStore('gitCredential', () => {
  const state = reactive({
    active: null as PendingCredential | null,
  });

  /** Module-private FIFO for everything queued behind `active`. */
  const queue: PendingCredential[] = [];

  /** Becomes `active` immediately if nothing is showing, else queues behind whatever is. */
  function enqueueCredentialRequest(pending: PendingCredential): void {
    if (state.active === null) {
      state.active = pending;
    } else {
      queue.push(pending);
    }
  }

  /** Settles `pending` if it is still `active` (never a queued entry) and pumps the next one in. A
   *  stale `pending` (already settled, or dropped) is a no-op — a duplicate close event must never
   *  answer the next prompt, which was never shown. */
  function answerCredential(pending: PendingCredential, secret: string | null): void {
    const current = state.active;
    if (!current || toRaw(current) !== toRaw(pending)) return;
    state.active = null;
    current.answer(secret);
    const next = queue.shift();
    if (next) state.active = next;
  }

  /** Called from disposeGitTransport when a repo workspace closes. Removes that workspace's own
   *  entries, active included — but never answers them: the transport is gone, so there is nothing
   *  to send credential.provide on. The Go broker's own 120s bound and the op's own cancellation end
   *  the server-side wait. */
  function dropCredentialRequests(codeRepoId: string): void {
    for (let i = queue.length - 1; i >= 0; i -= 1) {
      if (queue[i]?.codeRepoId === codeRepoId) queue.splice(i, 1);
    }
    if (state.active?.codeRepoId === codeRepoId) {
      state.active = queue.shift() ?? null;
    }
  }

  // Relay ids answered here; a snapshot already in flight must not re-add them. Pruned on each sync.
  const answeredRelayIds = new Set<string>();

  function relayEntry(prompt: GitCredentialPrompt): PendingCredential {
    return {
      codeRepoId: '',
      relayId: prompt.requestId,
      label: `${prompt.source} · ${prompt.repoLabel}`,
      prompt: prompt.prompt,
      masked: prompt.masked,
      answer: (secret) => {
        answeredRelayIds.add(prompt.requestId);
        void control.gitCredentialProvide(prompt.requestId, secret).catch(() => {
          /* the broker's own 120s bound already ended the wait — nothing to log or recover. */
        });
      },
    };
  }

  /** Applies the relay's full snapshot: queues unseen prompts in order and drops the ones the
   *  server withdrew (answered in another window, op cancelled, timed out). A dropped active entry
   *  pumps the next. Idempotent. */
  function syncRelayPrompts(list: readonly GitCredentialPrompt[]): void {
    const live = new Set(list.map((p) => p.requestId));
    for (const id of answeredRelayIds) if (!live.has(id)) answeredRelayIds.delete(id);
    for (let i = queue.length - 1; i >= 0; i -= 1) {
      const id = queue[i]?.relayId;
      if (id !== undefined && !live.has(id)) queue.splice(i, 1);
    }
    const activeId = state.active?.relayId;
    if (activeId !== undefined && !live.has(activeId)) state.active = queue.shift() ?? null;
    const held = new Set<string>(answeredRelayIds);
    if (state.active?.relayId) held.add(state.active.relayId);
    for (const queued of queue) if (queued.relayId) held.add(queued.relayId);
    for (const prompt of list) {
      if (!held.has(prompt.requestId)) enqueueCredentialRequest(relayEntry(prompt));
    }
  }

  let unsubscribeRelay: (() => void) | null = null;

  async function hydrateRelayPrompts(): Promise<void> {
    unsubscribeRelay?.();
    unsubscribeRelay = null;
    unsubscribeRelay = await hydrateThenSubscribe({
      snapshot: () => control.gitCredentialPending(),
      subscribe: (cb) => control.onGitCredentialChanged(cb),
      apply: syncRelayPrompts,
    });
  }

  return {
    ...toRefs(state),
    enqueueCredentialRequest,
    answerCredential,
    dropCredentialRequests,
    syncRelayPrompts,
    hydrateRelayPrompts,
  };
});
