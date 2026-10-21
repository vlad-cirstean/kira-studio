import type { BridgeClient } from '../bridge/client.ts';
import { ChangeRequestState } from './changeRequests.ts';
import { OpsState } from './ops.ts';
import { RefsState } from './refs.ts';
import { RepoSettingsState } from './repoSettings.ts';
import { StackState } from './stack.ts';

/** App.vue's repo-scoped state cluster. One construction site, so a test exercises the same
 *  wiring (OpsState reads `repoSettingsState`) production uses. */
export function createRepoStates(bridge: BridgeClient) {
  const refsState = new RefsState(bridge);
  const changeRequestState = new ChangeRequestState(bridge);
  const stackState = new StackState(bridge, changeRequestState);
  const repoSettingsState = new RepoSettingsState(bridge);
  const opsState = new OpsState(bridge, refsState, repoSettingsState, stackState);
  return { refsState, changeRequestState, stackState, repoSettingsState, opsState };
}
