import type { HttpBodyMode } from '@shared/domain/http';
import { reactive } from 'vue';
import { patchHttpRequestTabState } from '../../state/tabs';
import type { RawWarning } from '../raw/parse';
import { parseRawRequest } from '../raw/parse';

// P9 D8: the raw editor's own state — mirrors http/state/curl.ts's importCurlDialogState shape
// (one `open` flag plus what the dialog needs to seed itself and to Apply). The pasted/generated
// text itself is deliberately not stored here, the same reasoning ImportCurlDialog.vue's own
// comment states: nothing outside EditRawRequestDialog.vue needs to read it, so it stays a local
// ref there, seeded from `initialText` on open.
interface EditRawDialogState {
  open: boolean;
  tabId: string;
  initialText: string;
  originalBodyMode: HttpBodyMode;
  originalUrl: string;
}

export const editRawDialogState = reactive<EditRawDialogState>({
  open: false,
  tabId: '',
  initialText: '',
  originalBodyMode: 'none',
  originalUrl: '',
});

export function openEditRawDialog(
  tabId: string,
  initialText: string,
  originalBodyMode: HttpBodyMode,
  originalUrl: string,
): void {
  editRawDialogState.open = true;
  editRawDialogState.tabId = tabId;
  editRawDialogState.initialText = initialText;
  editRawDialogState.originalBodyMode = originalBodyMode;
  editRawDialogState.originalUrl = originalUrl;
}

export function closeEditRawDialog(): void {
  editRawDialogState.open = false;
}

export interface RawPreview {
  error: string | null;
  warnings: RawWarning[];
  /** D10's own stated consequence, generalised: whenever the parsed body's mode differs from the
   *  tab's own mode before this edit — most commonly a `urlencoded` body folding into `raw` (raw
   *  HTTP has no `urlencoded` representation), but any Content-Type edit that changes which of
   *  D10's table rows the body lands in produces the same warning. The bytes and headers that
   *  will actually be sent are unaffected either way — only which editor renders them changes. */
  modeChanged: { from: HttpBodyMode; to: HttpBodyMode } | null;
}

/** D12/C6's own reasoning: parseRawRequest is pure and synchronous, so there is nothing to
 *  debounce or cache — recomputed on every keystroke, exactly like previewCurl. */
export function previewRaw(text: string): RawPreview {
  const result = parseRawRequest(text, editRawDialogState.originalUrl);
  if ('error' in result) {
    return { error: result.error, warnings: [], modeChanged: null };
  }
  const modeChanged =
    result.state.bodyMode !== editRawDialogState.originalBodyMode
      ? { from: editRawDialogState.originalBodyMode, to: result.state.bodyMode }
      : null;
  return { error: null, warnings: result.warnings, modeChanged };
}

/** D8/D9: Apply patches the *current* tab — never a fresh one (submitImportCurl's own
 *  openHttpRequestTab is deliberately not called here), because this is the current request being
 *  re-authored, not a new one. Substitution still applies at send, unchanged: after this, the tab
 *  is an ordinary tab, and send() runs its usual two-stage resolution over whatever `{{name}}`
 *  references the hand-edited text carried (D9's whole point of parsing back into the model rather
 *  than sending the buffer verbatim). Returns false (leaving the dialog open) only for a parse
 *  error the Apply button should already have disabled against. */
export function applyEditRaw(text: string): boolean {
  const result = parseRawRequest(text, editRawDialogState.originalUrl);
  if ('error' in result) return false;
  patchHttpRequestTabState(editRawDialogState.tabId, result.state);
  closeEditRawDialog();
  return true;
}
