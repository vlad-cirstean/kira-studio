import type { HttpCodeLanguage } from '@shared/domain/http';
import { reactive } from 'vue';
import { openHttpRequestTab, patchHttpRequestTabState } from '../../state/tabs';
import { type ParsedCurl, parseCurl } from '../curl/parse';
import type { CurlWarning } from '../curl/tokenize';

// P7 D12: the Import-from-curl dialog's own state — mirrors http/state/dynamicValues.ts's shape
// (one `open` flag, nothing tab-scoped). The pasted text itself is deliberately not stored here:
// nothing outside ImportCurlDialog.vue needs to read it, so it stays a local ref there, the same
// way SaveRequestDialog.vue keeps its own name/target refs local rather than in saveDialogState.

export const importCurlDialogState = reactive({ open: false });

export function openImportCurlDialog(): void {
  importCurlDialogState.open = true;
}

export function closeImportCurlDialog(): void {
  importCurlDialogState.open = false;
}

const CODE_LABEL: Readonly<Record<HttpCodeLanguage, string>> = {
  javascript: 'JavaScript',
  json: 'JSON',
  html: 'HTML',
  xml: 'XML',
};

function bodySummary(state: ParsedCurl['state']): string | null {
  switch (state.bodyMode) {
    case 'none':
      return null;
    case 'raw':
      return 'raw body';
    case 'code':
      return `${CODE_LABEL[state.codeLanguage]} body`;
    case 'urlencoded':
      return 'form body';
    case 'formdata':
      return 'multipart body';
    case 'file':
      return 'binary body';
  }
}

/** A URL that still carries an unresolved `{{var}}` fails `new URL()` — this is a live preview
 *  over untrusted pasted text, so the summary falls back to the raw string rather than throwing. */
function urlSummary(url: string): string {
  if (url === '') return '(no URL)';
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return url;
  }
}

/** D12: the live one-line summary — "POST · api.example.com/v1/orders · 3 headers · JSON body". */
export function summarizeParsed(state: ParsedCurl['state']): string {
  const parts = [state.method, urlSummary(state.url)];
  if (state.headers.length > 0) {
    parts.push(`${state.headers.length} header${state.headers.length === 1 ? '' : 's'}`);
  }
  const body = bodySummary(state);
  if (body) parts.push(body);
  return parts.join(' · ');
}

export interface CurlPreview {
  summary: string;
  warnings: CurlWarning[];
  error: string | null;
}

/** D12: recomputed on every keystroke — parseCurl is pure and synchronous, so there is nothing to
 *  debounce or cache. An empty paste is neither an error nor a preview: the dialog just shows
 *  nothing yet. */
export function previewCurl(text: string): CurlPreview {
  if (text.trim() === '') return { summary: '', warnings: [], error: null };
  const parsed = parseCurl(text);
  if ('error' in parsed) return { summary: '', warnings: [], error: parsed.error };
  return { summary: summarizeParsed(parsed.state), warnings: parsed.warnings, error: null };
}

/** D12/F14: opens a fresh 'http-request' tab and patches it — never the tab the user might already
 *  be mid-edit on. Returns false (and leaves the dialog open) only for a parse error the Import
 *  button should already have disabled against. */
export function submitImportCurl(text: string): boolean {
  const parsed = parseCurl(text);
  if ('error' in parsed) return false;
  const id = openHttpRequestTab();
  patchHttpRequestTabState(id, parsed.state);
  closeImportCurlDialog();
  return true;
}
