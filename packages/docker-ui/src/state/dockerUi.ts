import { usePersistedState } from '@workbench/behaviour/persisted';
import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { ResourceKind } from '../wire';

export type DockerSection = 'containers' | 'images' | 'volumes' | 'networks';
const SECTIONS: readonly string[] = ['containers', 'images', 'volumes', 'networks'];
const sectionSchema = {
  safeParse: (v: unknown) =>
    typeof v === 'string' && SECTIONS.includes(v)
      ? { success: true as const, data: v as DockerSection }
      : { success: false as const },
};
export type DockerDetailTab = 'overview' | 'logs' | 'terminal' | 'stats' | 'inspect' | 'edit';

export interface DockerSelection {
  kind: ResourceKind;
  id: string;
}

export const useDockerUiStore = defineStore('dockerUi', () => {
  const section = usePersistedState<DockerSection>('kira.docker.section', 'containers', {
    schema: sectionSchema,
  });
  const selection = ref<DockerSelection | null>(null);
  const detailTab = ref<DockerDetailTab>('overview');
  const search = ref('');
  const showStopped = usePersistedState('kira.docker.showStopped', true);
  const collapsedGroups = usePersistedState<string[]>('kira.docker.collapsedGroups', []);

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
