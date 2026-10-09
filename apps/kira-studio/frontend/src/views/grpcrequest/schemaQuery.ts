import { loadDynamicGenerator } from '@kira/api-core';
import type { GrpcMetadataState, GrpcMetaPairWire, GrpcSchemaWire } from '@shared/domain/grpc';
import { useQuery } from '@tanstack/vue-query';
import { refDebounced } from '@vueuse/core';
import { queryClient } from '@workbench/state/queryClient';
import { computed, type MaybeRefOrGetter, toValue } from 'vue';
import { loadVariableRows } from '../../api/state/apiQueries';
import { useCollectionsStore } from '../../api/state/collections';
import { mergeVariableRows, useVariablesStore } from '../../api/state/variables';
import { control } from '../../bridge/control';
import type { GrpcRequestTabRecord } from '../../state/tabDomain';
import { resolveGrpcTabState } from './resolve';

// P175 D4 (P11 D4's schema browser runtime, as server state): the resolved schema for a request's
// *source* — never for a tab. Reflection keys carry the raw `target` template (never a resolved
// value, so no secret enters a cache key) plus the owner ids that give the template its meaning;
// Go's descriptor cache (grpcclient/descriptors.go cacheKey) hashes the resolved target instead, so
// a variables change invalidates every reflection key (apiQueries.ts handleApiDataChange). Metadata
// *values* are read at fetch time, because Go ignores them on a non-reload Describe.

const SCHEMA_DEBOUNCE_MS = 150;

export interface GrpcSchemaSource {
  mode: 'reflection' | 'proto';
  target: string;
  tlsEnabled: boolean;
  caFile: string;
  serverName: string;
  protoPath: string;
  importPaths: string[];
  metadata: GrpcMetadataState[];
  collectionId: string;
  environmentId: string;
  /** False while a saved tab's collection id is unknown (tree not loaded): fetching then would key
   *  on '' and refetch the moment the tree lands. */
  ready: boolean;
}

export function grpcSchemaSourceFor(tab: GrpcRequestTabRecord): GrpcSchemaSource {
  const { state } = tab;
  const collections = useCollectionsStore();
  return {
    mode: state.descriptorMode,
    target: state.target,
    tlsEnabled: state.tlsMode === 'tls',
    caFile: state.caFile,
    serverName: state.serverName,
    protoPath: state.protoPath,
    importPaths: state.importPaths,
    metadata: state.metadata,
    collectionId: collections.collectionIdFor(state),
    environmentId: useVariablesStore().environmentIdForTab(tab.id),
    ready: state.itemId === null || collections.loaded,
  };
}

export function grpcSchemaKey(source: GrpcSchemaSource) {
  if (source.mode === 'proto') {
    return ['grpcSchema', 'proto', source.protoPath, source.importPaths.join('\0')] as const;
  }
  const names = source.metadata
    .filter((m) => m.enabled && m.name.trim() !== '')
    .map((m) => m.name)
    .join('\0');
  return [
    'grpcSchema',
    'reflection',
    source.target,
    source.tlsEnabled,
    source.caFile,
    source.serverName,
    names,
    source.collectionId,
    source.environmentId,
  ] as const;
}

function isComplete(source: GrpcSchemaSource): boolean {
  return source.mode === 'reflection' ? source.target !== '' : source.protoPath !== '';
}

/** Describe has no message field, so only target and metadata are resolved (stage 1, as send()). */
async function describeSchema(
  source: GrpcSchemaSource,
  reload: boolean,
  signal?: AbortSignal,
): Promise<GrpcSchemaWire> {
  let target = source.target;
  let metadata: GrpcMetaPairWire[] = [];
  if (source.mode === 'reflection') {
    const [collectionRows, environmentRows] = await Promise.all([
      loadVariableRows('collection', source.collectionId),
      loadVariableRows('environment', source.environmentId),
    ]);
    const { values, secretNames } = mergeVariableRows(collectionRows, environmentRows);
    const fields = { target: source.target, metadata: source.metadata, message: '' };
    const first = resolveGrpcTabState(fields, values, secretNames);
    const resolved = first.refs.some((r) => r.kind === 'dynamic')
      ? resolveGrpcTabState(fields, values, secretNames, await loadDynamicGenerator())
      : first;
    target = resolved.target;
    metadata = resolved.metadata;
  }
  const opId = crypto.randomUUID();
  signal?.addEventListener('abort', () => void control.opsCancel(opId), { once: true });
  return control.grpcDescribe({
    descriptorMode: source.mode,
    target,
    tls: { enabled: source.tlsEnabled, caFile: source.caFile, serverName: source.serverName },
    metadata,
    protoPath: source.protoPath,
    importPaths: source.importPaths,
    collectionId: source.collectionId,
    environmentId: source.environmentId,
    reload,
    opId,
  });
}

/** The tab's schema, fetched once its source is complete; debounced like a fast typist (the
 *  schema watcher this replaces). A source change is a new query — nothing to supersede. */
export function useGrpcSchema(tab: MaybeRefOrGetter<GrpcRequestTabRecord>) {
  const source = computed(() => grpcSchemaSourceFor(toValue(tab)));
  const debounced = refDebounced(source, SCHEMA_DEBOUNCE_MS);
  const query = useQuery(() => {
    const s = debounced.value;
    return {
      queryKey: grpcSchemaKey(s),
      queryFn: ({ signal }) => describeSchema(s, false, signal),
      enabled: s.ready && isComplete(s),
      staleTime: Number.POSITIVE_INFINITY,
    };
  }, queryClient);

  /** Go invalidates its own descriptor cache on `reload`; the reply replaces this key's data. A
   *  failure lands in the query's own error state. */
  async function reload(): Promise<void> {
    const s = debounced.value;
    await queryClient
      .fetchQuery({
        queryKey: grpcSchemaKey(s),
        queryFn: ({ signal }) => describeSchema(s, true, signal),
        staleTime: 0,
      })
      .catch(() => {});
  }

  return {
    schema: computed(() => query.data.value ?? null),
    loading: computed(() => query.isFetching.value),
    error: computed(() => query.error.value?.message ?? null),
    reload,
  };
}
