import { copyText } from '../clipboard';
import type { MenuItem } from '../state/contextMenu';
import { openRepoFileTab } from '../state/repoTabs';
import type { RepoTreeRowVm } from './state/fileTree';
import { toggleRepoDir } from './state/fileTree';

// C5 §7.2: one row's own context menu — deliberately small (this workspace is read-only, §11: no
// rename/delete/new-file affordance belongs here).
export function menuForRepoRow(repoId: string, row: RepoTreeRowVm): MenuItem[] {
  if (row.isDir) {
    return [
      {
        type: 'item',
        id: 'toggle',
        label: row.expanded ? 'Collapse' : 'Expand',
        run: () => toggleRepoDir(repoId, row.path),
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
    {
      type: 'item',
      id: 'copy-path',
      label: 'Copy path',
      icon: 'copy',
      run: () => copyText(row.path),
    },
  ];
}
