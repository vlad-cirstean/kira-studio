import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import { useDocumentVisibility } from '@vueuse/core';
import { computed, onScopeDispose, type Ref, reactive, watch } from 'vue';
import { useDocker } from './context';
import type { DockerStatus, InspectKind, ResourceKind } from './wire';

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
