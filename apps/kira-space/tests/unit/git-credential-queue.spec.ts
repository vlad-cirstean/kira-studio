import { describe, expect, test } from 'bun:test';
import { setActivePinia } from 'pinia';
import { pinia } from '../../frontend/src/state/pinia';

setActivePinia(pinia);

const { useGitCredentialStore } = await import('../../frontend/src/state/gitCredential');
type PendingCredential = import('../../frontend/src/state/gitCredential').PendingCredential;

// P67e (docs/v1.6/plans/P67e-git-relax-read-only.md §5) — this queue is the one new piece of state
// this phase adds, and the only one that clears CLAUDE.md's narrow unit-test bar: three interacting
// ordering/cancellation rules whose failure mode is a silently stuck modal.

function pending(codeRepoId: string, onAnswer: (secret: string | null) => void): PendingCredential {
  return { codeRepoId, prompt: `Password for ${codeRepoId}`, masked: true, answer: onAnswer };
}

describe('state/gitCredential — the FIFO queue', () => {
  test('1. two enqueues while none is active: the second becomes active only after the first is answered', () => {
    const gitCredentialStore = useGitCredentialStore();
    const answers: string[] = [];
    const first = pending('r1', () => answers.push('r1'));
    const second = pending('r2', () => answers.push('r2'));
    gitCredentialStore.enqueueCredentialRequest(first);
    expect(gitCredentialStore.active?.codeRepoId).toBe('r1');

    gitCredentialStore.enqueueCredentialRequest(second);
    // Still r1 — the second entry queues behind it rather than replacing or stacking.
    expect(gitCredentialStore.active?.codeRepoId).toBe('r1');

    gitCredentialStore.answerCredential(first, 'secret-1');
    expect(answers).toEqual(['r1']);
    expect(gitCredentialStore.active?.codeRepoId).toBe('r2');

    gitCredentialStore.answerCredential(second, 'secret-2');
    expect(answers).toEqual(['r1', 'r2']);
    expect(gitCredentialStore.active).toBeNull();
  });

  test('2. answerCredential twice in a row with nothing queued behind: the second call is a no-op', () => {
    const gitCredentialStore = useGitCredentialStore();
    const answers: (string | null)[] = [];
    const solo = pending('solo', (secret) => answers.push(secret));
    gitCredentialStore.enqueueCredentialRequest(solo);

    gitCredentialStore.answerCredential(solo, 'once');
    expect(answers).toEqual(['once']);
    expect(gitCredentialStore.active).toBeNull();

    // Nothing is active any more (no second entry to pump in) — a further call (a duplicate
    // submit/dismiss event racing the first) must not throw, must not call 'solo's answer again,
    // and must not resurrect it as active.
    gitCredentialStore.answerCredential(solo, 'twice');
    expect(answers).toEqual(['once']);
    expect(gitCredentialStore.active).toBeNull();
  });

  test('3. dropCredentialRequests(codeRepoId) with that workspace active: removed, the next workspace becomes active, and its own answer never fires', () => {
    const gitCredentialStore = useGitCredentialStore();
    const answers: string[] = [];
    const other = pending('other', () => answers.push('other'));
    gitCredentialStore.enqueueCredentialRequest(pending('dropped', () => answers.push('dropped')));
    gitCredentialStore.enqueueCredentialRequest(other);
    // A second entry for the dropped workspace, queued behind 'other' — must be purged too, not
    // just the active one.
    gitCredentialStore.enqueueCredentialRequest(
      pending('dropped', () => answers.push('dropped-2')),
    );
    expect(gitCredentialStore.active?.codeRepoId).toBe('dropped');

    gitCredentialStore.dropCredentialRequests('dropped');

    expect(gitCredentialStore.active?.codeRepoId).toBe('other');
    expect(answers).toEqual([]); // the dropped entry's own answer callback never fired.

    gitCredentialStore.answerCredential(other, 'secret-other');
    expect(answers).toEqual(['other']);
    // The second 'dropped' entry was purged from the queue too — nothing left to promote.
    expect(gitCredentialStore.active).toBeNull();
  });

  test('4. answering an already-settled prompt while its successor is active leaves the successor untouched', () => {
    const gitCredentialStore = useGitCredentialStore();
    const answers: string[] = [];
    const a = pending('a', () => answers.push('a'));
    const b = pending('b', () => answers.push('b'));
    gitCredentialStore.enqueueCredentialRequest(a);
    gitCredentialStore.enqueueCredentialRequest(b);

    gitCredentialStore.answerCredential(a, null);
    // The dialog's duplicate close event settles the same, now stale, prompt again.
    gitCredentialStore.answerCredential(a, null);

    expect(answers).toEqual(['a']);
    expect(gitCredentialStore.active?.codeRepoId).toBe('b');
    gitCredentialStore.answerCredential(b, 'x');
  });
});
