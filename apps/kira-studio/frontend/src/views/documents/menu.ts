import { beautifyJson } from '../../beautify';
import { copyText } from '../../clipboard';
import { confirmDialog } from '../../state/confirmDialog';
import type { MenuItem } from '../../state/contextMenu';
import { parseIdLabel, toPlainJson, toRelaxedText, toShellText } from '../shared/document/ejson';
import { deleteDocument } from './mutations';
import { setActionError, setAllExpanded, toggleExpanded } from './state';

// P19 D6 (parity half): the row's body is already canonical extended JSON (ejson.ts's own
// header rule) — re-indented through beautify.ts's JSON scanner, falling back to the raw body if
// it does not scan (a truncated body, say).
function prettyJson(text: string): string {
  const r = beautifyJson(text, 'indented');
  return r.ok ? r.text : text;
}

// A rejected clipboard write (denied permission, an unfocused window) must not vanish the same
// way an unhandled promise rejection would — ContextMenu.vue's `onItemClick` is never awaited by
// its own `@click` binding, so with nothing here to catch it, Copy would fail with zero visible
// feedback (P43 F6/D7's own `actionError` exists for exactly this).
async function copyOrReportError(tabId: string, text: string): Promise<void> {
  try {
    await copyText(text);
    setActionError(tabId, null);
  } catch (err) {
    setActionError(tabId, err instanceof Error ? err.message : String(err));
  }
}

// §8.10's "Document" row: Expand all, Collapse all, Copy document, Copy _id, Edit, Delete —
// shared by the per-row context menu and (expand/collapse all only) the toolbar.
export function rowMenu(
  tabId: string,
  id: string,
  body: string,
  // P21 round 2 performance finding 2: a thunk, not an already-decoded array — right-click used
  // to decode every row's `_id` (idsOf, a full page walk through the page store's cached/
  // cachedView) up front regardless of whether Expand/Collapse all is ever picked, undoing the
  // visible-window pruning in one click. setAllExpanded's own `true` branch doesn't even read its
  // ids argument, so Expand all now costs nothing at all.
  allIds: () => string[],
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
      // setAllExpanded's own `true` branch never reads its ids argument — no reason to force
      // allIds()'s whole-page decode just to hand it a value it drops.
      run: () => setAllExpanded(tabId, [], true),
    },
    {
      type: 'item',
      id: 'collapse-all',
      label: 'Collapse all',
      run: () => setAllExpanded(tabId, allIds(), false),
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
      // P22b D11: one named-format submenu, mirroring the SQL grid's own `Copy row(s) ▸`
      // shape (resultMenu.ts's tabularRowMenu) — a user choosing between mongosh syntax and
      // `{"$oid": …}` has to be told which is which, not read two unlabelled sibling items.
      // Leaf ids preserved (`copy-document`/`copy-as-json`) so existing specs keep passing.
      //
      // Real-interaction fix (reported bug — the normal/default copy button still produced
      // `$oid`/`$date`-wrapped JSON): Plain JSON is new and listed first — none of the three
      // existing formats could become it. Canonical Extended JSON must keep every wrapper intact
      // (interaction.spec.ts/autocomplete.spec.ts lock in that `copy-as-json` round-trips through
      // mongoimport/mongosh, and still contains `"$oid"`); Relaxed Extended JSON is still Extended
      // JSON per spec (autocomplete.spec.ts locks in that it keeps `$oid` wrapped too — "no relaxed
      // variant for ObjectId"); Shell mode is mongosh syntax, not JSON at all. ejson.ts's own
      // `toPlainJson` strips every `$`-prefixed wrapper down to its plain-JSON equivalent instead.
      type: 'submenu',
      id: 'copy-document-submenu',
      label: 'Copy document',
      items: [
        {
          type: 'item',
          id: 'copy-plain-json',
          label: 'Plain JSON',
          run: () => copyOrReportError(tabId, toPlainJson(body)),
        },
        {
          type: 'item',
          id: 'copy-document',
          label: 'Shell mode',
          // P27 D12: the shell form (ObjectId(...), ISODate(...), ...) — what the tree already
          // shows, and what saveDocumentEdit/parseDocumentLiteral already accept back.
          run: () => copyOrReportError(tabId, toShellText(body)),
        },
        {
          type: 'item',
          id: 'copy-as-json',
          label: 'Canonical Extended JSON',
          // P19 D6: canonical extended JSON, not relaxed and not shell — it's what the app
          // already has in hand (no re-encode) and what mongoimport/mongosh accept.
          run: () => copyOrReportError(tabId, prettyJson(body)),
        },
        {
          type: 'item',
          id: 'copy-relaxed-json',
          label: 'Relaxed Extended JSON',
          run: () => copyOrReportError(tabId, toRelaxedText(body)),
        },
      ],
    },
    {
      type: 'item',
      id: 'copy-id',
      label: 'Copy _id',
      // The shell form is also what turns *Copy _id* into a working filter (F14, D12/D15): paste
      // it as `{ _id: ObjectId("...") }` and resolveEjsonWrappers/the shell constructor resolve it
      // to the same value either way.
      run: () => copyOrReportError(tabId, parseIdLabel(id).text),
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
        if (!(await confirmDialog(`Delete this document (_id: ${id})?`))) return;
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
