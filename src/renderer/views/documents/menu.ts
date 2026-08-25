import type { MenuItem } from '../../state/contextMenu';
import { parseIdLabel, toShellText } from '../shared/document/ejson';
import { deleteDocument } from './mutations';
import { setActionError, setAllExpanded, toggleExpanded } from './state';

// §8.10's "Document" row: Expand all, Collapse all, Copy document, Copy _id, Edit, Delete —
// shared by the per-row context menu and (expand/collapse all only) the toolbar.
export function rowMenu(
  tabId: string,
  id: string,
  body: string,
  allIds: string[],
  onEdit: () => void,
  // Edit is shown but disabled — with a label saying why — rather than omitted, mirroring
  // keyvalue/menu.ts's own `editable`/label pair: a row's own Edit icon and this menu entry must
  // agree, or right-clicking would offer an action the toolbar button already refused.
  editGate: { editable: boolean; label: string },
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
    {
      type: 'item',
      id: 'edit-document',
      label: editGate.editable ? 'Edit' : editGate.label,
      disabled: !editGate.editable,
      run: onEdit,
    },
    {
      type: 'item',
      id: 'delete-document',
      label: 'Delete',
      danger: true,
      // P43 F6/D8: this runs inside contextMenu.ts's own `void item.run()` — an unhandled
      // rejection there is guaranteed, not merely possible, so the catch belongs here.
      run: async () => {
        if (!window.confirm(`Delete this document (_id: ${id})?`)) return;
        try {
          await deleteDocument(tabId, id);
          setActionError(tabId, null);
        } catch (err) {
          setActionError(tabId, err instanceof Error ? err.message : String(err));
        }
      },
    },
  ];
}
