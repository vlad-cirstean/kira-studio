import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { useCodeReposStore } from '../../state/coderepos';
import { useRepoLinksStore } from './repoLinks';

// One concern: which repos the Git panel lists. A hidden repo stays imported and usable; Show
// hidden is session-only, so it resets on reload.
export const useRepoVisibilityStore = defineStore('repoVisibility', () => {
  const codeRepos = useCodeReposStore();
  const links = useRepoLinksStore();

  const showHidden = ref(false);

  const topLevel = computed(() => codeRepos.records.filter((r) => !links.worktreeParentId(r.id)));
  const hasHidden = computed(() => topLevel.value.some((r) => r.hidden));
  const listed = computed(() =>
    showHidden.value ? topLevel.value : topLevel.value.filter((r) => !r.hidden),
  );
  const listedIds = computed(() => listed.value.map((r) => r.id));

  return { showHidden, hasHidden, listed, listedIds };
});
