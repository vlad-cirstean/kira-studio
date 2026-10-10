import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { useDocumentVisibility, useLocalStorage } from '@vueuse/core';
import {
  computed,
  type MaybeRefOrGetter,
  onScopeDispose,
  type Ref,
  reactive,
  ref,
  toValue,
  watch,
} from 'vue';
import { useDocker } from './context';
import type { DockerDiskUsage, DockerStatus, InspectKind, ResourceKind } from './wire';

const STATUS_KEY = ['docker', 'status'] as const;
const UNAVAILABLE_POLL_MS = 5000;

export function useDockerStatus() {
  const { control } = useDocker();
  return useQuery({
    queryKey: STATUS_KEY,
    queryFn: () => control.status(false),
    refetchInterval: (query) => (query.state.data?.state === 'ok' ? false : UNAVAILABLE_POLL_MS),
    staleTime: 0,
  });
}

/** Forces a fresh engine probe and publishes the result to the status cache. */
export function useRetryStatus() {
  const { control } = useDocker();
  const qc = useQueryClient();
  const retrying = ref(false);
  async function retry(): Promise<void> {
    retrying.value = true;
    try {
      qc.setQueryData<DockerStatus>(STATUS_KEY, await control.status(true));
    } finally {
      retrying.value = false;
    }
  }
  return { retrying, retry };
}

/** Scope for every resource query: a context switch must not serve the old engine's cache. */
function useScope() {
  const status = useDockerStatus();
  const scope = computed(() => {
    const ep = status.data.value?.endpoint;
    return ep ? `${ep.context}|${ep.host}` : '';
  });
  const ready = computed(() => status.data.value?.state === 'ok');
  return { status, scope, ready };
}

export function useContainers() {
  const { control } = useDocker();
  const { scope, ready } = useScope();
  return useQuery({
    queryKey: computed(() => ['docker', scope.value, 'containers'] as const),
    queryFn: () => control.containers(true),
    enabled: ready,
  });
}

export function useImages() {
  const { control } = useDocker();
  const { scope, ready } = useScope();
  return useQuery({
    queryKey: computed(() => ['docker', scope.value, 'images'] as const),
    queryFn: () => control.images(),
    enabled: ready,
  });
}

export function useVolumes() {
  const { control } = useDocker();
  const { scope, ready } = useScope();
  return useQuery({
    queryKey: computed(() => ['docker', scope.value, 'volumes'] as const),
    queryFn: () => control.volumes(),
    enabled: ready,
  });
}

export function useNetworks() {
  const { control } = useDocker();
  const { scope, ready } = useScope();
  return useQuery({
    queryKey: computed(() => ['docker', scope.value, 'networks'] as const),
    queryFn: () => control.networks(),
    enabled: ready,
  });
}

export function useContainerDetail(id: Ref<string>) {
  const { control } = useDocker();
  const { scope, ready } = useScope();
  return useQuery({
    queryKey: computed(() => ['docker', scope.value, 'container', id.value] as const),
    queryFn: () => control.inspectContainer(id.value),
    enabled: computed(() => ready.value && id.value !== ''),
  });
}

export function useInspect(kind: Ref<InspectKind>, id: Ref<string>) {
  const { control } = useDocker();
  const { scope, ready } = useScope();
  return useQuery({
    queryKey: computed(() => ['docker', scope.value, 'inspect', kind.value, id.value] as const),
    queryFn: () => control.inspect(kind.value, id.value),
    enabled: computed(() => ready.value && id.value !== ''),
  });
}

const storedDisk = useLocalStorage<Record<string, DockerDiskUsage>>('kira.docker.diskUsage', {});

/**
 * Engine-wide disk usage, measured only on `refresh()`. Keys sit outside the `['docker']` prefix so
 * no refresh, container action or live-sync invalidation ever triggers a df walk. The last result
 * per engine persists in localStorage with its own timestamp.
 */
export function useEngineDiskUsage() {
  const { control } = useDocker();
  const { scope } = useScope();
  const query = useQuery({
    queryKey: computed(() => ['docker-disk', scope.value, 'engine'] as const),
    queryFn: () => control.diskUsage(),
    enabled: false,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    initialData: () => storedDisk.value[scope.value],
    initialDataUpdatedAt: () => {
      const at = Date.parse(storedDisk.value[scope.value]?.takenAt ?? '');
      return Number.isNaN(at) ? 0 : at;
    },
  });
  watch(query.data, (d) => {
    if (d && storedDisk.value[scope.value]?.takenAt !== d.takenAt) {
      storedDisk.value = { ...storedDisk.value, [scope.value]: d };
    }
  });
  return { query, refresh: () => query.refetch() };
}

/** One container's size, measured only on `refresh()` and kept for the session, never persisted. */
export function useContainerSize(id: MaybeRefOrGetter<string>) {
  const { control } = useDocker();
  const { scope } = useScope();
  const query = useQuery({
    queryKey: computed(() => ['docker-disk', scope.value, 'container', toValue(id)] as const),
    queryFn: () => control.containerSize(toValue(id)),
    enabled: false,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
  return { query, refresh: () => query.refetch() };
}

export type ContainerAction = 'start' | 'stop' | 'restart';

export function useContainerAction() {
  const { control } = useDocker();
  const qc = useQueryClient();
  const busy = reactive(new Set<string>());
  const mutation = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: ContainerAction }) => {
      busy.add(id);
      try {
        await control[action](id);
      } finally {
        busy.delete(id);
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['docker'] }),
  });
  return {
    run: (id: string, action: ContainerAction) => mutation.mutateAsync({ id, action }),
    isBusy: (id: string) => busy.has(id),
    error: mutation.error,
    reset: mutation.reset,
  };
}

function invalidateKinds(qc: ReturnType<typeof useQueryClient>, kinds: readonly ResourceKind[]) {
  const wanted = new Set<string>();
  for (const k of kinds) {
    if (k === 'container') {
      for (const w of ['containers', 'container', 'images', 'volumes', 'networks']) wanted.add(w);
    } else {
      wanted.add(`${k}s`);
      wanted.add('inspect');
    }
  }
  void qc.invalidateQueries({
    predicate: (q) => q.queryKey[0] === 'docker' && wanted.has(String(q.queryKey[2])),
  });
}

/** While mounted and the document is visible: engine events invalidate lists, status pushes land
 *  in the cache. Hidden or unmounted: the Go watcher is released. */
export function useDockerLiveSync() {
  const { control } = useDocker();
  const qc = useQueryClient();
  const visibility = useDocumentVisibility();
  let offs: Array<() => void> = [];
  let wasHidden = false;

  function start(): void {
    if (offs.length > 0) return;
    offs = [
      control.onChanged((e) => invalidateKinds(qc, e.kinds)),
      control.onStatus((s) => qc.setQueryData<DockerStatus>(STATUS_KEY, s)),
    ];
    void control.watch().catch(() => undefined);
  }

  function stop(): void {
    if (offs.length === 0) return;
    for (const off of offs) off();
    offs = [];
    void control.unwatch().catch(() => undefined);
  }

  watch(
    visibility,
    (v) => {
      if (v === 'visible') {
        start();
        if (wasHidden) void qc.invalidateQueries({ queryKey: ['docker'] });
        wasHidden = false;
      } else {
        wasHidden = true;
        stop();
      }
    },
    { immediate: true },
  );
  onScopeDispose(stop);
}
