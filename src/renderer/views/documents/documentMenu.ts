import type { MenuItem } from '../../workbench/state/contextMenu';
import { deleteDocument } from './documentMutations';
import { setAllExpanded, toggleExpanded } from './state';

// §8.10's "Document" row: Expand all, Collapse all, Copy document, Copy _id, Edit, Delete —
// shared by the per-row context menu and (expand/collapse all only) the toolbar.
export function documentMenu(
  tabId: string,
  id: string,
  body: string,
  allIds: string[],
  onEdit: () => void,
): MenuItem[] {
  return [
    {
      type: 'item',
      id: 'expand-all',
      label: 'Expand all',
      run: () => setAllExpanded(tabId, allIds, true),
    },
    {
      type: 'item',
      id: 'collapse-all',
      label: 'Collapse all',
      run: () => setAllExpanded(tabId, allIds, false),
    },
    { type: 'separator' },
    {
      type: 'item',
      id: 'toggle-expanded',
      label: 'Expand/collapse',
      run: () => toggleExpanded(tabId, id),
    },
    { type: 'separator' },
    {
      type: 'item',
      id: 'copy-document',
      label: 'Copy document',
      run: () => void navigator.clipboard.writeText(body),
    },
    {
      type: 'item',
      id: 'copy-id',
      label: 'Copy _id',
      run: () => void navigator.clipboard.writeText(id),
    },
    { type: 'separator' },
    { type: 'item', id: 'edit-document', label: 'Edit', run: onEdit },
    {
      type: 'item',
      id: 'delete-document',
      label: 'Delete',
      danger: true,
      run: () => {
        if (!window.confirm(`Delete this document (_id: ${id})?`)) return;
        void deleteDocument(tabId, id);
      },
    },
  ];
}
