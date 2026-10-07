import { useLocalStorage } from '@vueuse/core';
import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { ResourceKind } from '../wire';

export type DockerSection = 'containers' | 'images' | 'volumes' | 'networks';
export type DockerDetailTab = 'overview' | 'logs' | 'terminal' | 'stats' | 'inspect';

export interface DockerSelection {
  kind: ResourceKind;
  id: string;
}

export const useDockerUiStore = defineStore('dockerUi', () => {
  const section = ref<DockerSection>('containers');
  const selection = ref<DockerSelection | null>(null);
  const detailTab = ref<DockerDetailTab>('overview');
  const search = ref('');
  const showStopped = ref(true);
  const collapsedGroups = useLocalStorage<string[]>('kira.docker.collapsedGroups', []);

  function select(next: DockerSelection | null, tab: DockerDetailTab = 'overview'): void {
    selection.value = next;
    detailTab.value = tab;
  }

  function setSection(next: DockerSection): void {
    section.value = next;
    search.value = '';
  }

  function toggleGroup(name: string): void {
    collapsedGroups.value = collapsedGroups.value.includes(name)
      ? collapsedGroups.value.filter((n) => n !== name)
      : [...collapsedGroups.value, name];
  }

  return {
    section,
    selection,
    detailTab,
    search,
    showStopped,
    collapsedGroups,
    select,
    setSection,
    toggleGroup,
  };
});
