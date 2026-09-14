import { reactive } from 'vue';

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
  /** `null` for a dismissal — an absence the server would have to infer is explicitly not the
   *  wire's own contract. Closes over this request's id and this workspace's own transport. */
  readonly answer: (secret: string | null) => void;
}

interface GitCredentialState {
  active: PendingCredential | null;
}

export const gitCredentialState: GitCredentialState = reactive({
  active: null,
});

/** Module-private FIFO for everything queued behind `active`. */
const queue: PendingCredential[] = [];

/** Becomes `active` immediately if nothing is showing, else queues behind whatever is. */
export function enqueueCredentialRequest(pending: PendingCredential): void {
  if (gitCredentialState.active === null) {
    gitCredentialState.active = pending;
  } else {
    queue.push(pending);
  }
}

/** Settles `active` (never a queued entry) and pumps the next one in, if any. A call with nothing
 *  active is a no-op — answering twice must never double-pump the queue. */
export function answerCredential(secret: string | null): void {
  const current = gitCredentialState.active;
  if (!current) return;
  gitCredentialState.active = null;
  current.answer(secret);
  const next = queue.shift();
  if (next) gitCredentialState.active = next;
}

/** Called from disposeGitTransport when a repo workspace closes. Removes that workspace's own
 *  entries, active included — but never answers them: the transport is gone, so there is nothing
 *  to send credential.provide on. The Go broker's own 120s bound and the op's own cancellation end
 *  the server-side wait. */
export function dropCredentialRequests(codeRepoId: string): void {
  for (let i = queue.length - 1; i >= 0; i -= 1) {
    if (queue[i]?.codeRepoId === codeRepoId) queue.splice(i, 1);
  }
  if (gitCredentialState.active?.codeRepoId === codeRepoId) {
    gitCredentialState.active = queue.shift() ?? null;
  }
}
