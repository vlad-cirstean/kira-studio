import type { HttpSavedGrpcRequest, HttpSavedRequest } from '@shared/domain/collections';
import {
  defaultGrpcRequestTabState,
  type GrpcRequestTabState,
  grpcRequestTabStateSchema,
} from '@shared/domain/grpc';
import {
  defaultHttpRequestTabState,
  type HttpRequestTabState,
  httpRequestTabStateSchema,
} from '@shared/domain/http';
import {
  asGrpcRequestTab,
  asHttpRequestTab,
  type GrpcRequestTabRecord,
  type HttpRequestTabRecord,
} from '@shared/domain/tabs';
import { activateTab, type OpenTabResult, openTab, patchTabState, tabsState } from '../state/tabs';
import { fromSavedGrpcRequest } from '../views/grpcrequest/saved';
import { fromSavedRequest } from '../views/httprequest/saved';

// P12 D9: the module's own tab helpers, moved out of state/tabs.ts (§1.4) — these are the
// module's own code that happened to be written in a shell file, so this is a cut-and-paste onto
// the generic openTab/patchTabState primitives the shell keeps, not a new abstraction.

// P2 D2/D13: always a fresh tab — an HTTP request has no target to reuse by (its own id is its
// identity, D2), the same "always new" shape openConsoleTab already has for the same reason.
// `connectionId` is null (F3) and `path` is the literal constant 'request' (D2: non-empty per
// F2, carrying no false uniqueness, safe through pathTail per F4).
export function openApiRequestTab(): string {
  return openTab('http-request', null, 'request', () => defaultHttpRequestTabState(), {
    reuse: false,
  }).id;
}

// P4 D14: a saved request opens the **existing** 'http-request' tab kind — the same view P2 and
// P3 built, with its state sourced from a collection row instead of defaultHttpRequestTabState().
// No new tab kind, so tabKindSchema, RENDERABLE_TAB_KINDS, TAB_KIND_MODE, tabRecordSchema and Go's
// model.RenderableTabKinds are all byte-identical after this phase (F8).
//
// `path` stays the literal constant 'request'. P2 D2 explicitly offered P4 a real
// `collection:<id>/request:<id>` path and F13 is why it is declined: duplicateTab copies `path`
// verbatim while duplicateState clears `itemId`, so a duplicated tab would carry the saved
// request's path identity with a state saying it is unsaved — and openTab's reuse lookup (keyed on
// kind + connectionId + path) would then activate the *duplicate* when the user opened the
// original. Keeping identity in exactly one place and doing the lookup explicitly is four lines
// and has no such failure mode.
export function openCollectionRequestTab(
  itemId: string,
  name: string,
  saved: HttpSavedRequest,
): OpenTabResult {
  const existing = tabsState.tabs.find(
    (t) => t.kind === 'http-request' && (t as HttpRequestTabRecord).state.itemId === itemId,
  );
  if (existing) {
    activateTab(existing.id);
    return { id: existing.id, reused: true };
  }
  // D4: the one boundary where a stored saved request becomes tab state, and so the one place it
  // is Zod-parsed — reusing TabKindDef.parseState's own mechanism rather than adding a second
  // trust boundary. fromSavedRequest carries F4's method coercion.
  const state = httpRequestTabStateSchema.parse({
    ...defaultHttpRequestTabState(),
    ...fromSavedRequest(saved),
    itemId,
    name,
  });
  return openTab('http-request', null, 'request', () => state, { reuse: false });
}

/** Renaming a request in the tree patches every tab bound to it, so the view header and the tab
 *  strip follow immediately (D14). A tab whose row was deleted keeps the name it last knew. */
export function renameApiRequestTabs(itemId: string, name: string): void {
  for (const tab of tabsState.tabs) {
    if (tab.kind !== 'http-request') continue;
    if ((tab as HttpRequestTabRecord).state.itemId !== itemId) continue;
    patchHttpRequestTabState(tab.id, { name });
  }
}

// P11 D2: 'grpc-request''s own sibling of the four openApiRequestTab-family functions above —
// identical reasoning throughout (always fresh, no target to reuse by; a saved request opens the
// existing kind with state sourced from the collection row instead of the default).
export function openGrpcRequestTab(): string {
  return openTab('grpc-request', null, 'request', () => defaultGrpcRequestTabState(), {
    reuse: false,
  }).id;
}

export function openCollectionGrpcRequestTab(
  itemId: string,
  name: string,
  saved: HttpSavedGrpcRequest,
): OpenTabResult {
  const existing = tabsState.tabs.find(
    (t) => t.kind === 'grpc-request' && (t as GrpcRequestTabRecord).state.itemId === itemId,
  );
  if (existing) {
    activateTab(existing.id);
    return { id: existing.id, reused: true };
  }
  const state = grpcRequestTabStateSchema.parse({
    ...defaultGrpcRequestTabState(),
    ...fromSavedGrpcRequest(saved),
    itemId,
    name,
  });
  return openTab('grpc-request', null, 'request', () => state, { reuse: false });
}

export function renameGrpcRequestTabs(itemId: string, name: string): void {
  for (const tab of tabsState.tabs) {
    if (tab.kind !== 'grpc-request') continue;
    if ((tab as GrpcRequestTabRecord).state.itemId !== itemId) continue;
    patchGrpcRequestTabState(tab.id, { name });
  }
}

// P2: no skipUnchanged guard — a Params-table edit rewriting the URL to the value it already had
// (D9) is rare enough that the extra write is not worth the comparison every other patcher above
// already accepts skipping for a hotter path (scroll offsets, page index).
export function patchHttpRequestTabState(id: string, patch: Partial<HttpRequestTabState>): void {
  patchTabState(id, 'http-request', patch, { skipUnchanged: false });
}

export function patchGrpcRequestTabState(id: string, patch: Partial<GrpcRequestTabState>): void {
  patchTabState(id, 'grpc-request', patch, { skipUnchanged: false });
}

export function findHttpRequestTab(id: string): HttpRequestTabRecord | null {
  return asHttpRequestTab(tabsState.tabs.find((t) => t.id === id));
}

export function findGrpcRequestTab(id: string): GrpcRequestTabRecord | null {
  return asGrpcRequestTab(tabsState.tabs.find((t) => t.id === id));
}
