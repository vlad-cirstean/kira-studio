import { defineStore } from 'pinia';
import { reactive, shallowReactive } from 'vue';
import type { DockerStatsSample } from '../wire';

const RING = 60;

export const useDockerStatsStore = defineStore('dockerStats', () => {
  const latest = shallowReactive(new Map<string, DockerStatsSample>());
  const history = reactive(new Map<string, DockerStatsSample[]>());

  function ingest(samples: readonly DockerStatsSample[]): void {
    for (const s of samples) {
      latest.set(s.id, s);
      const ring = history.get(s.id) ?? [];
      ring.push(s);
      if (ring.length > RING) ring.shift();
      history.set(s.id, ring);
    }
  }

  function forget(ids: readonly string[]): void {
    for (const id of ids) {
      latest.delete(id);
      history.delete(id);
    }
  }

  function reset(): void {
    latest.clear();
    history.clear();
  }

  return { latest, history, ingest, forget, reset };
});
