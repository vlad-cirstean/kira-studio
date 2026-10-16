import type { BridgeClient } from '../bridge/client.ts';
import { OpsState } from './ops.ts';
import { PrState } from './pr.ts';
import { RefsState } from './refs.ts';
import { RepoSettingsState } from './repoSettings.ts';
import { StackState } from './stack.ts';

/** App.vue's repo-scoped state cluster. One construction site, so a test exercises the same
 *  wiring (OpsState reads `repoSettingsState`) production uses. */
export function createRepoStates(bridge: BridgeClient) {
  const refsState = new RefsState(bridge);
  const prState = new PrState(bridge);
  const stackState = new StackState(bridge, prState);
  const repoSettingsState = new RepoSettingsState(bridge);
  const opsState = new OpsState(bridge, refsState, repoSettingsState, stackState);
  return { refsState, prState, stackState, repoSettingsState, opsState };
}
