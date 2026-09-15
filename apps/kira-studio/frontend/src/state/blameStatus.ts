/**
 * P76 §5.1 — the status bar's git-blame readout. Cross-view state: written by `RepoFileView.vue`,
 * read by `workbench/StatusBar.vue`, neither importing the other (the same direction
 * `state/tabs.ts:68`-`70` already documents for cross-view state).
 *
 * Owner token: `MainView.vue`'s active-view switch mounts an incoming file tab's view around the
 * outgoing one's teardown (P72 §3), so without a token the departing tab's `releaseBlameStatus`
 * could blank a readout the arriving tab had already published. One owner at a time, last claim
 * wins.
 */
import { reactive } from 'vue';
import type { BlameLineState } from '../views/repo/blameLine';

export const blameStatusState = reactive({
  status: { kind: 'none' } as BlameLineState,
  /** Set by whoever currently owns the readout; `StatusBar.vue` calls it with the shown sha. Held
   *  as-is (no `markRaw`) — Vue's `reactive` proxies plain objects and arrays, not functions. */
  reveal: null as ((sha: string) => void) | null,
});

let owner: symbol | undefined;

/** Called once per mount that wants to own the readout. Returns the token every later
 *  publish/release call must present. */
export function claimBlameStatus(reveal: (sha: string) => void): symbol {
  const token = Symbol('blameStatusOwner');
  owner = token;
  blameStatusState.reveal = reveal;
  return token;
}

export function publishBlameStatus(token: symbol, status: BlameLineState): void {
  if (token !== owner) return;
  blameStatusState.status = status;
}

/** No-ops unless `token` still owns the readout — a later claim (the incoming tab) must not be
 *  blanked by the outgoing tab's own teardown running after it. */
export function releaseBlameStatus(token: symbol): void {
  if (token !== owner) return;
  owner = undefined;
  blameStatusState.status = { kind: 'none' };
  blameStatusState.reveal = null;
}
