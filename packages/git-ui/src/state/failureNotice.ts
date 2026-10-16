import type { OpErrorKind } from '@kira/git-ipc';
import { type MessageKey, t } from '@theme/i18n';
import { errorText } from '@workbench/bridge/codedError';
import {
  composeOpFailureParts,
  firstLine,
  type OpAction,
  type OpFailureError,
} from './liveAnnouncements.ts';

export interface FailureNotice {
  readonly title: string;
  readonly detail: string | undefined;
  readonly hint: string;
  /** True when Kira Space's Operations log recorded this failure. */
  readonly logged: boolean;
  /** True for a graph stream failure: the banner offers Retry (a read, safe to repeat). */
  readonly retryGraph: boolean;
}

const RETRY_HINT: Partial<Record<OpErrorKind, MessageKey>> = {
  NonFastForward: 'git.failure.nonFastForward.hint',
  AuthFailed: 'git.failure.authFailed.hint',
  NetworkFailed: 'git.failure.networkFailed.hint',
  DirtyWorktree: 'git.failure.dirtyWorktree.hint',
  UntrackedWouldBeOverwritten: 'git.failure.dirtyWorktree.hint',
  LockHeld: 'git.failure.lockHeld.hint',
  HookRejected: 'git.failure.hookRejected.hint',
  ProtectedBranch: 'git.failure.protectedBranch.hint',
  RemoteNotFound: 'git.failure.remoteNotFound.hint',
};

export function composeFailureNotice(
  action: OpAction,
  error: OpFailureError | undefined,
  logged: boolean,
): FailureNotice {
  const { title, detail } = composeOpFailureParts(action, error);
  return {
    title,
    detail,
    hint: t((error && RETRY_HINT[error.kind]) ?? 'common.action.retry.label'),
    logged,
    retryGraph: false,
  };
}

/** A rejected fire-and-forget call outside the op executors; never in the Operations log. */
export function composeAsyncFailureNotice(title: string, error: unknown): FailureNotice {
  return {
    title,
    detail: firstLine(errorText(error)),
    hint: t('common.action.retry.label'),
    logged: false,
    retryGraph: false,
  };
}

export function composeGraphFailureNotice(
  title: string,
  detail: string | undefined,
  logged: boolean,
): FailureNotice {
  return { title, detail, hint: t('git.failure.retryGraph.hint'), logged, retryGraph: true };
}
