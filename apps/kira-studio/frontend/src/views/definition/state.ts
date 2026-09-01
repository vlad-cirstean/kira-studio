import type { ObjectDefinition } from '@shared/domain/definition';
import type { ObjectMeta } from '@shared/domain/tree';
import { control } from '../../bridge/control';
import { connectionsState } from '../../state/connections';
import { registerTabRuntimeCleanup } from '../../state/tabRuntime';
import { tabsState } from '../../state/tabs';
import { createRuntimeStore } from '../shared/viewOp';

export interface DefinitionViewRuntime {
  status: 'idle' | 'loading' | 'error';
  error: string | null; // the raw IPC message, '[CODE] text' and all (§0 note 13)
  source: 'cache' | 'server' | null;
  definition: ObjectDefinition | null;
  // D8: Structure's columns/indexes come from the same describe() the grid already calls — an
  // independently-cached second load, not a field ObjectDefinition duplicates.
  meta: ObjectMeta | null;
}

function defaultRuntime(): DefinitionViewRuntime {
  return { status: 'idle', error: null, source: null, definition: null, meta: null };
}

const { runtime, ensureRuntime } = createRuntimeStore<DefinitionViewRuntime>(defaultRuntime);

export { runtime };

// D4: closeTab has no way to import this leaf module directly (reality 18) — registers here.
registerTabRuntimeCleanup((tabId) => {
  delete runtime[tabId];
});

function findTab(tabId: string) {
  return tabsState.tabs.find((t) => t.id === tabId && t.kind === 'definition') ?? null;
}

// Deliberately simpler than the grid's load(): there is no op-id bookkeeping and no supersession
// guard. The only two callers are the view's onMounted and the toolbar's Refresh — no pager, no
// filter to race against.
export async function load(tabId: string, opts?: { refresh?: boolean }): Promise<void> {
  const tab = findTab(tabId);
  if (!tab?.connectionId) return;
  const rt = ensureRuntime(tabId);
  rt.status = 'loading';
  rt.error = null;

  // P31 D2/D4: caps.describe gates the second load — kafka/sqs/redis/s3 always throw
  // E_UNSUPPORTED from describe() (P31 F5), so calling it for them only ever produces the error
  // this phase exists to stop. `meta` stays null exactly as it did after that failure, so the
  // Structure body renders identically either way (P23 D8's own `meta: null` state, unchanged).
  const canDescribe = connectionsState.states[tab.connectionId]?.caps?.describe === true;

  // P23 D8: describe() is allowed to fail independently — the definition load's own describe
  // this view never required for its Structure body's PropertiesSection rows; a failed describe
  // now just leaves `meta` null, same as if the adapter had nothing to say. Promise.allSettled
  // stays even though only the definition promise can still reject in the common case — a
  // describe() that is supported can still fail on its own (a denied query, a dropped
  // connection), and the settled shape is what keeps that from blanking the tab.
  const [definitionResult, describeResult] = await Promise.allSettled([
    control.treeDefinition(tab.connectionId, tab.path, opts?.refresh, tabId),
    canDescribe
      ? control.treeDescribe(tab.connectionId, tab.path, opts?.refresh, tabId)
      : Promise.resolve(null),
  ]);

  if (definitionResult.status === 'rejected') {
    // On error this stores the message and nothing else (§0 note 13). It does not parse the
    // [CODE] prefix and does not call unmarkHydrated: the reconnect gate is computed from
    // connectionsState.states[…].status, which the engine's own connection:state event already
    // flips when a connection dies (§0 note 14), so the disconnected case corrects itself here.
    const err = definitionResult.reason;
    rt.status = 'error';
    rt.error = err instanceof Error ? err.message : String(err);
    return;
  }
  rt.definition = definitionResult.value.definition;
  rt.source = definitionResult.value.source;
  rt.meta = describeResult.status === 'fulfilled' ? (describeResult.value?.meta ?? null) : null;
  rt.status = 'idle';
}
