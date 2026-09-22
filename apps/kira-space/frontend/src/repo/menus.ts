import type { MenuItem } from '@workbench/state/contextMenu';
import { copyText } from '@workbench/util/clipboard';
import { openRepoDiffTab, openRepoFileTab } from '../state/repoTabs';
import { type RepoTreeRowVm, useFileTreeStore } from './state/fileTree';

// C5 §7.2: one row's own context menu — deliberately small (this workspace is read-only, §11: no
// rename/delete/new-file affordance belongs here).
export function menuForRepoRow(repoId: string, row: RepoTreeRowVm): MenuItem[] {
  const fileTreeStore = useFileTreeStore();
  if (row.isDir) {
    return [
      {
        type: 'item',
        id: 'toggle',
        label: row.expanded ? 'Collapse' : 'Expand',
        run: () => fileTreeStore.toggleRepoDir(repoId, row.path),
      },
      {
        type: 'item',
        id: 'copy-path',
        label: 'Copy path',
        icon: 'copy',
        run: () => copyText(row.path),
      },
    ];
  }
  return [
    {
      type: 'item',
      id: 'open',
      label: 'Open',
      run: () => void openRepoFileTab(repoId, row.path, { preview: false }),
    },
    // C6 §8.4: gated on the same status map C5's tree already colors from — an unchanged file has
    // nothing to compare. All four codes qualify, untracked ('?') included: its diff against an
    // absent HEAD is exactly "everything here is new", the same thing VS Code shows. A 'D' row
    // still exists in the tree (a deleted-but-tracked path) and diffs as a full removal.
    ...(row.status
      ? [
          {
            type: 'item' as const,
            id: 'open-changes',
            label: 'Open changes',
            icon: 'git-compare',
            run: () => void openRepoDiffTab(repoId, row.path),
          },
        ]
      : []),
    {
      type: 'item',
      id: 'copy-path',
      label: 'Copy path',
      icon: 'copy',
      run: () => copyText(row.path),
    },
  ];
}
