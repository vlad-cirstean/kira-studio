import { describe, expect, test } from 'bun:test';
import {
  answerCredential,
  dropCredentialRequests,
  enqueueCredentialRequest,
  gitCredentialState,
  type PendingCredential,
} from '../../frontend/src/state/gitCredential';

// P67e (docs/v1.6/plans/P67e-git-relax-read-only.md §5) — this queue is the one new piece of state
// this phase adds, and the only one that clears CLAUDE.md's narrow unit-test bar: three interacting
// ordering/cancellation rules whose failure mode is a silently stuck modal.

function pending(codeRepoId: string, onAnswer: (secret: string | null) => void): PendingCredential {
  return { codeRepoId, prompt: `Password for ${codeRepoId}`, masked: true, answer: onAnswer };
}

describe('state/gitCredential — the FIFO queue', () => {
  test('1. two enqueues while none is active: the second becomes active only after the first is answered', () => {
    const answers: string[] = [];
    enqueueCredentialRequest(pending('r1', () => answers.push('r1')));
    expect(gitCredentialState.active?.codeRepoId).toBe('r1');

    enqueueCredentialRequest(pending('r2', () => answers.push('r2')));
    // Still r1 — the second entry queues behind it rather than replacing or stacking.
    expect(gitCredentialState.active?.codeRepoId).toBe('r1');

    answerCredential('secret-1');
    expect(answers).toEqual(['r1']);
    expect(gitCredentialState.active?.codeRepoId).toBe('r2');

    answerCredential('secret-2');
    expect(answers).toEqual(['r1', 'r2']);
    expect(gitCredentialState.active).toBeNull();
  });

  test('2. answerCredential twice in a row with nothing queued behind: the second call is a no-op', () => {
    const answers: (string | null)[] = [];
    enqueueCredentialRequest(pending('solo', (secret) => answers.push(secret)));

    answerCredential('once');
    expect(answers).toEqual(['once']);
    expect(gitCredentialState.active).toBeNull();

    // Nothing is active any more (no second entry to pump in) — a further call (a duplicate
    // submit/dismiss event racing the first) must not throw, must not call 'solo's answer again,
    // and must not resurrect it as active.
    answerCredential('twice');
    expect(answers).toEqual(['once']);
    expect(gitCredentialState.active).toBeNull();
  });

  test('3. dropCredentialRequests(codeRepoId) with that workspace active: removed, the next workspace becomes active, and its own answer never fires', () => {
    const answers: string[] = [];
    enqueueCredentialRequest(pending('dropped', () => answers.push('dropped')));
    enqueueCredentialRequest(pending('other', () => answers.push('other')));
    // A second entry for the dropped workspace, queued behind 'other' — must be purged too, not
    // just the active one.
    enqueueCredentialRequest(pending('dropped', () => answers.push('dropped-2')));
    expect(gitCredentialState.active?.codeRepoId).toBe('dropped');

    dropCredentialRequests('dropped');

    expect(gitCredentialState.active?.codeRepoId).toBe('other');
    expect(answers).toEqual([]); // the dropped entry's own answer callback never fired.

    answerCredential('secret-other');
    expect(answers).toEqual(['other']);
    // The second 'dropped' entry was purged from the queue too — nothing left to promote.
    expect(gitCredentialState.active).toBeNull();
  });
});
