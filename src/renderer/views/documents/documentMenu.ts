import type { MenuItem } from '../../workbench/state/contextMenu';
import { deleteDocument } from './documentMutations';
import { parseIdLabel, toShellText } from './ejson';
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
      // P27 D12: the shell form (ObjectId(...), ISODate(...), ...) — what the tree already shows,
      // and what saveDocumentEdit/parseDocumentLiteral already accept back.
      run: () => void navigator.clipboard.writeText(toShellText(body)),
    },
    {
      type: 'item',
      id: 'copy-id',
      label: 'Copy _id',
      // The shell form is also what turns *Copy _id* into a working filter (F14, D12/D15): paste
      // it as `{ _id: ObjectId("...") }` and resolveEjsonWrappers/the shell constructor resolve it
      // to the same value either way.
      run: () => void navigator.clipboard.writeText(parseIdLabel(id).text),
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
