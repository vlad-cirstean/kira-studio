import type { HttpCodeLanguage } from '@shared/domain/http';
import { reactive } from 'vue';
import { copyText } from '../../clipboard';
import { toCurl } from '../curl/generate';
import { type ParsedCurl, parseCurl } from '../curl/parse';
import type { CurlWarning } from '../curl/tokenize';
import { applySecretValues, type ResolvedRequest } from '../substituteRequest';
import { openApiRequestTab, patchHttpRequestTabState } from '../tabs';
import { cachedVariables, revealedValues, revealVariable } from './variables';

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
function summarizeParsed(state: ParsedCurl['state']): string {
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
  const id = openApiRequestTab();
  patchHttpRequestTabState(id, parsed.state);
  closeImportCurlDialog();
  return true;
}

// ---- Copy as curl (D10) — masked by default, one gated reveal, nothing persisted ----
//
// The caller (HttpRequestView.vue) computes the frozen resolution itself, exactly as send() does
// (views/httprequest/state.ts's own resolveForExport — a views/ file may import http/, not the
// reverse, §0.3), and hands the plain result to openCopyAsCurlDialog below. This module never
// reaches into views/** to get it.

interface CopyAsCurlDialogState {
  open: boolean;
  method: string;
  resolved: ResolvedRequest | null;
  defaultContentType: string;
  collectionId: string;
  environmentId: string;
  /** Every distinct secret name stage 1 deferred, in first-encountered order (D10 step 1). */
  deferredNames: string[];
  /** D10 step 3/§0.3: a second transient map with `revealedValues`' identical discipline — dropped
   *  on close, keyed by *name* here (not variable id) since that is what a `{{name}}` span carries. */
  revealedSecretValues: Record<string, string>;
  revealing: boolean;
  /** A reveal failure's message — this dialog's own sink, never `variablesDialogState.error`
   *  (§1.4's "one-line generalization"). */
  error: string | null;
}

export const copyAsCurlDialogState = reactive<CopyAsCurlDialogState>({
  open: false,
  method: 'GET',
  resolved: null,
  defaultContentType: '',
  collectionId: '',
  environmentId: '',
  deferredNames: [],
  revealedSecretValues: {},
  revealing: false,
  error: null,
});

export function openCopyAsCurlDialog(
  method: string,
  resolved: ResolvedRequest,
  deferredNames: readonly string[],
  defaultContentType: string,
  collectionId: string,
  environmentId: string,
): void {
  copyAsCurlDialogState.open = true;
  copyAsCurlDialogState.method = method;
  copyAsCurlDialogState.resolved = resolved;
  copyAsCurlDialogState.defaultContentType = defaultContentType;
  copyAsCurlDialogState.collectionId = collectionId;
  copyAsCurlDialogState.environmentId = environmentId;
  copyAsCurlDialogState.deferredNames = [...deferredNames];
  copyAsCurlDialogState.revealing = false;
  copyAsCurlDialogState.error = null;
  for (const key of Object.keys(copyAsCurlDialogState.revealedSecretValues)) {
    delete copyAsCurlDialogState.revealedSecretValues[key];
  }
}

export function closeCopyAsCurlDialog(): void {
  copyAsCurlDialogState.open = false;
  copyAsCurlDialogState.resolved = null;
  // D10: nothing generated is ever persisted — dropped on close, the same discipline
  // `revealedValues` follows.
  for (const key of Object.keys(copyAsCurlDialogState.revealedSecretValues)) {
    delete copyAsCurlDialogState.revealedSecretValues[key];
  }
}

/** D10 step 2/4: the command for the *current* reveal state — masked (every deferred span still
 *  literal `{{name}}`) until revealSecretValues() has filled some or all of them in. Pure over the
 *  store's own reactive fields, so a `computed()` wrapping this in the dialog re-renders exactly
 *  when one of them changes. */
export function currentCurlCommand(): string {
  const { resolved, method, defaultContentType, revealedSecretValues } = copyAsCurlDialogState;
  if (!resolved) return '';
  const hasRevealed = Object.keys(revealedSecretValues).length > 0;
  const effective = hasRevealed ? applySecretValues(resolved, revealedSecretValues) : resolved;
  return toCurl({
    method,
    url: effective.url,
    headers: effective.headers,
    body: effective.body,
    defaultContentType,
  });
}

/** D10 step 1's precedence, over the id a deferred *name* actually belongs to — environment wins
 *  over collection, mirroring mergedValuesAndSecrets' own merge order (views/httprequest/state.ts). */
function findSecretVariableId(
  name: string,
  collectionId: string,
  environmentId: string,
): string | null {
  const env = cachedVariables('environment', environmentId).find(
    (v) => v.isSecret && v.name === name,
  );
  if (env) return env.id;
  const col = cachedVariables('collection', collectionId).find(
    (v) => v.isSecret && v.name === name,
  );
  return col?.id ?? null;
}

/** D10 step 3: one `revealVariable` call per deferred name — the existing function, the existing
 *  four outcomes, the existing `confirmDialog` fallback and 5-minute grace. D10 step 5: a
 *  cancelled, unavailable-and-declined, or errored reveal simply leaves that name out of
 *  `revealedSecretValues`, so its `{{name}}` span stays literal — nothing throws, nothing is
 *  refused. */
export async function revealSecretValues(): Promise<void> {
  const { deferredNames, collectionId, environmentId } = copyAsCurlDialogState;
  copyAsCurlDialogState.revealing = true;
  copyAsCurlDialogState.error = null;
  try {
    for (const name of deferredNames) {
      if (copyAsCurlDialogState.revealedSecretValues[name] !== undefined) continue;
      const id = findSecretVariableId(name, collectionId, environmentId);
      if (!id) continue;
      await revealVariable(id, false, (message) => {
        copyAsCurlDialogState.error = message;
      });
      const value = revealedValues[id];
      if (value !== undefined) copyAsCurlDialogState.revealedSecretValues[name] = value;
    }
  } finally {
    copyAsCurlDialogState.revealing = false;
  }
}

/** D10: copy is available in both states — the masked form is a legal, useful, non-runnable
 *  command; the revealed form requires having passed the gate above first. */
export function copyCurlCommand(): void {
  void copyText(currentCurlCommand());
}
