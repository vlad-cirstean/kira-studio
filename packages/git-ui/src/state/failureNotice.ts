import type { OpErrorKind } from '@kira/git-ipc';
import { composeOpFailureParts, type OpFailureError } from './liveAnnouncements.ts';

export interface FailureNotice {
  readonly title: string;
  readonly detail: string | undefined;
  readonly hint: string;
  /** True when Kira Space's Operations log recorded this failure. */
  readonly logged: boolean;
  /** True for a graph stream failure: the banner offers Retry (a read, safe to repeat). */
  readonly retryGraph: boolean;
}

const RETRY_HINT: Partial<Record<OpErrorKind, string>> = {
  NonFastForward: 'Pull, then push again.',
  AuthFailed: 'Check your credentials, then try again.',
  NetworkFailed: 'Check the network, then try again.',
  DirtyWorktree: 'Commit or stash your changes first.',
  UntrackedWouldBeOverwritten: 'Commit or stash your changes first.',
  LockHeld: 'Wait for the other git process to finish, then try again.',
  HookRejected: 'Fix what the hook reported, then push again.',
  ProtectedBranch: 'Type the branch name to confirm.',
  RemoteNotFound: "Check the remote's URL.",
};

const DEFAULT_HINT = 'Try again.';

export function composeFailureNotice(
  action: string,
  error: OpFailureError | undefined,
  logged: boolean,
): FailureNotice {
  const { title, detail } = composeOpFailureParts(action, error);
  return {
    title,
    detail,
    hint: (error && RETRY_HINT[error.kind]) ?? DEFAULT_HINT,
    logged,
    retryGraph: false,
  };
}

/** A rejected fire-and-forget call outside the op executors: no hint beyond "Try again", and never
 *  in the Operations log. */
export function composeAsyncFailureNotice(prefix: string, error: unknown): FailureNotice {
  const message = error instanceof Error ? error.message : String(error);
  const { detail } = composeOpFailureParts(prefix, { kind: 'Unknown', message });
  return { title: `${prefix}.`, detail, hint: DEFAULT_HINT, logged: false, retryGraph: false };
}

export function composeGraphFailureNotice(
  title: string,
  detail: string | undefined,
  logged: boolean,
): FailureNotice {
  return { title, detail, hint: 'Retry reloads the graph.', logged, retryGraph: true };
}
