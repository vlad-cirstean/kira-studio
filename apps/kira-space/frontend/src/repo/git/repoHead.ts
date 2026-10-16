import type { RepoHead } from '@kira/git-ui';
import type { RepoSummary } from '@shared/domain/repo';

/** View-head identity for a repo record: name, dimmed parent dir, palette colour. */
export function repoHeadOf(repo: RepoSummary | undefined): RepoHead | undefined {
  if (!repo) return undefined;
  const root = repo.root.replace(/[\\/]+$/, '');
  const cut = Math.max(root.lastIndexOf('/'), root.lastIndexOf('\\'));
  const dir =
    cut > 0 ? `${root.slice(Math.max(0, root.lastIndexOf('/', cut - 1) + 1), cut + 1)}` : undefined;
  return { name: repo.name, dir, color: repo.color };
}
