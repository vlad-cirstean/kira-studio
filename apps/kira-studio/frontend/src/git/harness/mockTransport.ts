import type {
  EventKey,
  EventPayload,
  ParamsOf,
  RequestKey,
  ResultOf,
  StreamChunkOf,
  StreamKey,
  StreamParamsOf,
  Transport,
} from '@kira/git-ipc';
import { DEFAULT_SCENARIO, SCENARIOS } from './scenarios';

/**
 * D5's mock-Transport harness — a hand-written `Transport`, ~50 lines given the contract's own
 * small request set, proving `mount()`'s host seam is real by satisfying it with nothing Wails-
 * shaped behind it at all (no Stream, no bound call, no `/wails/*` request of any kind). Every
 * request answers from one named `Scenario` (scenarios.ts); `graph.stream` always ends with zero
 * chunks, matching what P1's own Go host actually does today (no porcelain walk exists yet, §0.2).
 */
export function createHarnessTransport(scenarioName: string): Transport {
  const scenario = SCENARIOS[scenarioName] ?? SCENARIOS[DEFAULT_SCENARIO];

  async function request<K extends RequestKey>(
    method: K,
    params: ParamsOf<K>,
  ): Promise<ResultOf<K>> {
    switch (method) {
      case 'app.init':
        return scenario.init as ResultOf<K>;
      case 'repo.list':
        return { candidates: scenario.candidates ?? [], activeRepoId: null } as ResultOf<K>;
      case 'repo.pick':
        return { path: null } as ResultOf<K>;
      case 'repo.open':
        return (scenario.repoOpen ?? {
          kind: 'notARepository',
          path: (params as ParamsOf<'repo.open'>).path,
        }) as ResultOf<K>;
      case 'repo.close':
        return {} as ResultOf<K>;
      case 'graph.status':
        return { loaded: 0, remaining: 0, exhausted: true } as ResultOf<K>;
      case 'graph.loadMore':
        return { started: false } as ResultOf<K>;
      case 'graph.refresh':
        return { restarted: false } as ResultOf<K>;
      default:
        throw new Error(`harness Transport: unhandled request method '${method satisfies never}'`);
    }
  }

  return {
    request,
    on<K extends EventKey>(_method: K, _handler: (payload: EventPayload<K>) => void): () => void {
      return () => {};
    },
    async stream<K extends StreamKey>(
      _method: K,
      _params: StreamParamsOf<K>,
      _onChunk: (chunk: StreamChunkOf<K>) => void,
    ): Promise<void> {
      // Zero chunks, then done — the honest harness equivalent of Go's own graph.stream handler
      // in P1 (bridge/gitstream.go), which has no commits to walk yet either.
    },
    dispose(): void {},
  };
}
