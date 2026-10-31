import {
  type KibanaConsoleState,
  type KibanaDataView,
  type KibanaDiscoverRequest,
  kibanaConsoleStateSchema,
  kibanaDiscoverRequestSchema,
} from '@shared/domain/kibana';
import { useQuery } from '@tanstack/vue-query';
import { fireAndForget } from '@workbench/bridge/fireAndForget';
import { computed, type Ref, ref, watch } from 'vue';
import { control } from '../../../bridge/control';
import type { ConsoleTabRecord } from '../../../state/tabDomain';
import { setKibana, setText, useConsoleViewStore } from '../state';
import { createKqlCompletion } from './kqlCompletion';
import { browserTimeZone, resolveTime } from './time';

export const dataViewQueryKey = (connectionId: string, id: string) =>
  ['kibana', 'dataView', connectionId, id] as const;

const SAMPLE_SIZES = [100, 500, 1000, 5000, 10000] as const;
const SUGGEST_LIMIT = 100;

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Discover state of one console tab and the requests it sends; the query text is the tab's own. */
export function useDiscover(tab: Ref<ConsoleTabRecord>, connected: Ref<boolean>) {
  const consoleViewStore = useConsoleViewStore();
  const connectionId = computed(() => tab.value.connectionId ?? '');

  const state = computed<KibanaConsoleState>(
    () => tab.value.state.kibana ?? kibanaConsoleStateSchema.parse({}),
  );

  function patch(change: Partial<KibanaConsoleState>): void {
    setKibana(tab.value.id, { ...state.value, ...change });
  }

  const dataViewQuery = useQuery(() => ({
    queryKey: dataViewQueryKey(connectionId.value, state.value.dataViewId ?? ''),
    queryFn: () =>
      control.kibanaDataView(connectionId.value, crypto.randomUUID(), state.value.dataViewId ?? ''),
    enabled: connected.value && !!connectionId.value && !!state.value.dataViewId,
    staleTime: 5 * 60_000,
  }));
  const dataView = computed<KibanaDataView | null>(() => dataViewQuery.data.value ?? null);
  const fields = computed(() => dataView.value?.fields ?? []);
  const timeField = computed(() => dataView.value?.timeFieldName ?? null);
  const timeZone = browserTimeZone();

  function buildRequest(query = tab.value.state.text): KibanaDiscoverRequest {
    const s = state.value;
    return {
      dataView: s.dataViewId ?? '',
      query,
      language: s.language,
      timeRange: timeField.value ? resolveTime(s.time) : null,
      filters: s.filters,
      sort: s.sort,
      size: s.sampleSize,
      timeZone,
    };
  }

  // The request of the latest run: hits and histogram both send exactly it, so they never disagree.
  const lastRequest = ref<KibanaDiscoverRequest | null>(null);
  const runSeq = ref(0);
  let lastOwn = '';
  const runtime = computed(() => consoleViewStore.runtime[tab.value.id]);
  const running = computed(() => runtime.value?.status === 'running');
  const canRun = computed(() => !!state.value.dataViewId && !running.value);

  async function run(): Promise<void> {
    if (!canRun.value) return;
    const request = buildRequest();
    lastRequest.value = request;
    runSeq.value++;
    lastOwn = JSON.stringify(request);
    await consoleViewStore.run(tab.value.id, [lastOwn]);
  }

  function stop(): void {
    consoleViewStore.stop(tab.value.id);
  }

  const histogramQuery = useQuery(() => ({
    queryKey: ['kibana', 'histogram', tab.value.id, runSeq.value, state.value.interval] as const,
    queryFn: ({ signal }: { signal: AbortSignal }) => {
      const opId = crypto.randomUUID();
      signal.addEventListener(
        'abort',
        () => fireAndForget(control.opsCancel(opId), 'kibana.histogram'),
        { once: true },
      );
      return control.kibanaHistogram({
        connectionId: connectionId.value,
        opId,
        tabId: tab.value.id,
        request: lastRequest.value as KibanaDiscoverRequest,
        interval: state.value.interval,
      });
    },
    enabled: connected.value && lastRequest.value !== null,
    gcTime: 30_000,
  }));

  function applyRequest(req: KibanaDiscoverRequest): void {
    setText(tab.value.id, req.query);
    patch({
      dataViewId: req.dataView,
      language: req.language,
      time: req.timeRange
        ? { mode: 'absolute', from: req.timeRange.from, to: req.timeRange.to }
        : state.value.time,
      filters: req.filters,
      sort: req.sort,
      sampleSize: SAMPLE_SIZES.find((s) => s === req.size) ?? state.value.sampleSize,
    });
    lastRequest.value = req;
    runSeq.value++;
  }

  // A run started elsewhere (Operations re-run) hydrates the controls from its statement.
  watch(
    () => runtime.value?.lastStatements,
    (statements) => {
      const text = statements?.[0];
      if (!text || text === lastOwn) return;
      const parsed = kibanaDiscoverRequestSchema.safeParse(safeJson(text));
      if (parsed.success) {
        lastOwn = text;
        applyRequest(parsed.data);
      }
    },
    { immediate: true },
  );

  // A new data view drops sort and filters on fields it lacks, then reruns once its fields arrive.
  let rerunOnLoad = false;
  function selectDataView(view: { id: string; name: string }): void {
    if (view.id === state.value.dataViewId) return;
    patch({ dataViewId: view.id, dataViewName: view.name, sort: [] });
    rerunOnLoad = true;
  }
  watch(dataView, (view) => {
    if (!view || view.id !== state.value.dataViewId) return;
    const names = new Set(view.fields.map((f) => f.name));
    const filters = state.value.filters.filter((f) => names.has(f.field));
    const sort = state.value.sort.filter((s) => names.has(s.field));
    if (filters.length !== state.value.filters.length || sort.length !== state.value.sort.length) {
      patch({ filters, sort });
    }
    if (rerunOnLoad) {
      rerunOnLoad = false;
      void run();
    }
  });

  const completion = createKqlCompletion({
    connectionId: () => connectionId.value,
    dataView: () => dataView.value,
    language: () => state.value.language,
    request: (query) => ({ ...buildRequest(query), size: 0 }),
    scopeKey: () => JSON.stringify([state.value.time, state.value.filters]),
  });

  async function suggestValues(field: string): Promise<string[]> {
    const r = await control.kibanaSuggest({
      connectionId: connectionId.value,
      opId: crypto.randomUUID(),
      tabId: tab.value.id,
      request: { ...buildRequest(''), size: SUGGEST_LIMIT },
      field,
      prefix: '',
    });
    return r.values;
  }

  return {
    state,
    patch,
    dataView,
    dataViewQuery,
    fields,
    timeField,
    timeZone,
    buildRequest,
    run,
    stop,
    canRun,
    running,
    runtime,
    histogramQuery,
    selectDataView,
    completion,
    suggestValues,
  };
}
