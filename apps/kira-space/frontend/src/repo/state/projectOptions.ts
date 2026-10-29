import { errorText } from '@workbench/bridge/codedError';
import type { PickerOption } from '@workbench/lib/pickerOptions';
import { computed, type MaybeRefOrGetter, toValue } from 'vue';
import { repoText } from '../../state/coderepos';
import { useRepoLinksStore } from './repoLinks';
import { useRepos } from './reposQueries';

/** The code repos as project picker options, minus `exclude` (repo ids). */
export function useProjectOptions(exclude?: MaybeRefOrGetter<readonly string[]>) {
  const repos = useRepos();
  const links = useRepoLinksStore();
  const options = computed<PickerOption[]>(() => {
    const skip = new Set(toValue(exclude) ?? []);
    return (repos.data.value?.repos ?? [])
      .filter((r) => !skip.has(r.codeRepoId))
      .map((r) => {
        const tint = repoText(links.repoColorOf(r.codeRepoId));
        const coloured = Object.keys(tint.style).length > 0;
        return {
          value: r.codeRepoId,
          label: r.nickname || r.name,
          detail: r.nickname ? r.name : r.path,
          labelClass: coloured ? tint.class : undefined,
          labelStyle: coloured ? tint.style : undefined,
        };
      });
  });
  return {
    options,
    isPending: repos.isPending,
    error: computed(() => (repos.error.value ? errorText(repos.error.value) : null)),
  };
}
