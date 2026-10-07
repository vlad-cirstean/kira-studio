import { computed } from 'vue';
import { useRepos } from '../../../repo/state/reposQueries';
import { useBoard } from '../queries';
import type { ReviewWindowTarget } from '../wire';

/** The board facts a review window shows about its target: task, branch, repo nickname. */
export function useReviewContext(target: () => ReviewWindowTarget) {
  const board = useBoard();
  const repos = useRepos();
  const task = computed(() => board.data.value?.tasks.find((t) => t.id === target().taskId));
  const branch = computed(() => board.data.value?.branches.find((b) => b.id === target().branchId));
  const repoLabel = computed(() => {
    const r = repos.data.value?.repos.find((x) => x.codeRepoId === target().codeRepoId);
    return r ? r.nickname || r.name : target().codeRepoId;
  });
  return { task, branch, repoLabel };
}
