import {
  applyPipeline,
  classifyReference,
  DYNAMIC_NAMES,
  FAKE_NAMES,
  isDynamicName,
  isFakeName,
  isTransformName,
  type ReferenceKind,
  splitTemplateSpans,
  TRANSFORM_NAMES,
  type TransformName,
} from '@kira/api-core';
import type { RangeHighlight } from '../../editor/variableHighlight';
import type { Completion } from '../../theme/primitives/completion';
import { cachedVariables, mergedValuesAndSecrets } from './variables';

// P15b D4: the Api side supplies the data, in one module, from the call already being made — F5's
// own finding that mergedValuesAndSecrets is already synchronous, already cached, and already
// fired on mount/collection/environment change by HttpRequestView.vue. This module builds three
// pure, DOM-free lookups over that same data for D2/D3's editor seams to call: colouring
// (rangeHighlights), the hover panel's lines (hoverAt), and the `{{…}}` completion list
// (candidates). May import @kira/api-core and api/state/variables.ts; may not import
// `workbench/**` (biome.json).
//
// P18 D11: moved here from views/httprequest/ — biome.json's per-directory noRestrictedImports
// bans views/grpcrequest/** from reaching into views/httprequest/**, and gRPC needs this module's
// exports too (F15). api/state/ is the precedent P12 D12 already set for a module both protocol
// views need: this file imports only @kira/api-core, api/state/variables.ts (a sibling, now) and
// two type-only imports, none of which are views/**/project/**/workbench/**, so the move is legal
// in the direction that matters. No re-export shim is left at the old path.

const HOVER_VALUE_MAX_LENGTH = 200;

// D2's three classes (editor/theme.ts): resolved and a catalogued dynamic reference (both "this
// will produce a value") share `.cm-kira-var`; an uncatalogued dynamic reference is painted
// exactly like `unknown` (D2's own table: "unknown, or an uncatalogued `{{$dynamic}}`"). P17 D12:
// "catalogued" now means either spelling — `isDynamicName` ($-prefixed) or `isFakeName`
// (fake.-prefixed).
function classFor(name: string, kind: ReferenceKind): string {
  switch (kind) {
    case 'resolved':
      return 'cm-kira-var';
    case 'deferred':
      return 'cm-kira-var-secret';
    case 'dynamic':
      return isDynamicName(name) || isFakeName(name) ? 'cm-kira-var' : 'cm-kira-var-unknown';
    case 'unknown':
      return 'cm-kira-var-unknown';
  }
}

// P17 D13(c): the hover's own past-participle phrasing for a transform, used only for a
// *deferred* (secret) reference — "secret — base64-encoded when the request is sent" never shows
// a value, transformed or not, but naming the transform itself is not a leak (P15b §4's security
// assertion, extended).
const TRANSFORM_VERBS: Record<TransformName, string> = {
  base64: 'base64-encoded',
  base64decode: 'base64-decoded',
  upper: 'upper-cased',
  lower: 'lower-cased',
  urlencode: 'URL-encoded',
  urldecode: 'URL-decoded',
};

function describePipelineVerbs(pipeline: readonly TransformName[]): string {
  return pipeline.map((t) => TRANSFORM_VERBS[t]).join(', then ');
}

// D3 rule 4's own fallback, made legible: a name that contains `|` but never parsed as a pipeline
// (`classifyReference` sees the whole `token | base46` string as the name) means at least one
// segment after the first is not a recognised transform. Names the first offending one, or the
// first segment itself when it was the empty-name case (`{{ | upper}}`).
function badTransformMessage(fullName: string): string {
  const segments = fullName.split('|').map((s) => s.trim());
  const rest = segments.slice(1);
  const bad = rest.find((s) => !isTransformName(s)) ?? (segments[0] === '' ? '' : rest.at(-1));
  return `"${bad ?? ''}" is not a transform — try ${TRANSFORM_NAMES.join(', ')}`;
}

/** Which scope a resolved name came from, for the hover's second line (D4) — re-reads
 *  `cachedVariables('environment', …)` to test membership rather than widening
 *  `mergedValuesAndSecrets` with a parallel `origin` map: the one call site that needs this is
 *  here, and widening a store function `send()` depends on for a tooltip caption is the wrong
 *  direction of dependency. */
function scopeOf(name: string, environmentId: string): 'collection' | 'environment' {
  return cachedVariables('environment', environmentId).some((v) => v.name === name)
    ? 'environment'
    : 'collection';
}

export interface VariableSupport {
  rangeHighlights: (doc: string) => readonly RangeHighlight[];
  /** `null` when `offset` is not inside any `{{...}}` reference — closes/never opens the hover. */
  hoverAt: (text: string, offset: number) => string[] | null;
  /** P17 D13(b): a function of the token's own context, not a static array — the list depends on
   *  whether the caret is before or after a `|` inside the reference. */
  candidates: (ctx: { text: string; from: number; word: string }) => Completion[];
}

// P17 D13(b): "after a `|`" is decided the same way templateToken decides "inside an unclosed
// reference" — from the nearest unclosed `{{` at or before `from`, is there already a `|`
// between it and the caret.
function isAfterPipe(text: string, from: number): boolean {
  const before = text.slice(0, from);
  const open = before.lastIndexOf('{{');
  if (open === -1) return false;
  return before.indexOf('|', open) !== -1;
}

export function variableSupport(collectionId: string, environmentId: string): VariableSupport {
  const { values, secretNames } = mergedValuesAndSecrets(collectionId, environmentId);

  function rangeHighlights(doc: string): readonly RangeHighlight[] {
    return splitTemplateSpans(doc)
      .filter((span) => span.isReference)
      .map((span) => ({
        from: span.from,
        to: span.to,
        class: classFor(span.name, classifyReference(span.name, values, secretNames)),
      }));
  }

  function hoverAt(text: string, offset: number): string[] | null {
    const span = splitTemplateSpans(text).find(
      (s) => s.isReference && offset >= s.from && offset < s.to,
    );
    if (!span) return null;
    const kind = classifyReference(span.name, values, secretNames);
    const pipeline = span.pipeline ?? [];
    // D13(c): a reference with a pipeline gets one more line naming the chain in order — never
    // shown for `unknown` (D3 rule 4's fallback has no pipeline by construction: the whole
    // "token | base46" string became the name instead) or for `deferred` (folded into that
    // branch's own sentence below, rather than a bare arrow chain next to "secret").
    const chainLine = pipeline.length > 0 ? [`→ ${pipeline.join(' → ')}`] : [];
    switch (kind) {
      case 'resolved': {
        const raw = values[span.name] ?? '';
        // D13(c): the renderer has the plaintext for a non-secret, so showing the piped RESULT is
        // both possible and more useful than showing the input untransformed.
        const shown = pipeline.length > 0 ? (applyPipeline(pipeline, raw) ?? raw) : raw;
        const truncated =
          shown.length > HOVER_VALUE_MAX_LENGTH
            ? `${shown.slice(0, HOVER_VALUE_MAX_LENGTH)}…`
            : shown;
        return [truncated, `${scopeOf(span.name, environmentId)} variable`, ...chainLine];
      }
      case 'deferred':
        // F5/§0.3: a secret's plaintext never enters the renderer to begin with — there is no
        // value this line could show even if it wanted to, transformed or not (P15b §4's security
        // assertion, extended to a pipeline).
        return pipeline.length > 0
          ? [`secret — ${describePipelineVerbs(pipeline)} when the request is sent`]
          : ['secret — resolved when the request is sent'];
      case 'dynamic': {
        // D4's table also wants "the catalogue's own description" as a second line here — the
        // catalogue (api-core's dynamic/catalog.ts) deliberately carries no description strings
        // (DynamicValuesDialog.vue's own D11: "the sample is the description", which needs an
        // async generator load this synchronous hover can't perform) — so only line 1 is shown,
        // a documented deviation rather than a second, drifting copy of that dialog's samples.
        // D12: catalogued means either spelling.
        const catalogued = isDynamicName(span.name) || isFakeName(span.name);
        return catalogued
          ? ['generated fresh on every send', ...chainLine]
          : ['unknown dynamic value'];
      }
      case 'unknown':
        // D3 rule 4: a name shaped like a failed pipeline (contains `|` but never parsed as one)
        // gets a second line naming exactly which segment isn't a real transform.
        return span.name.includes('|')
          ? ['not defined in this collection or environment', badTransformMessage(span.name)]
          : ['not defined in this collection or environment'];
    }
  }

  const varCandidates: Completion[] = [
    ...Object.keys(values).map((name) => ({
      label: name,
      detail: 'variable',
      icon: 'symbol-variable',
    })),
    ...secretNames.map((name) => ({ label: name, detail: 'secret', icon: 'symbol-variable' })),
  ].sort((a, b) => a.label.localeCompare(b.label));
  // D12/D13(b): fake. names before $ names — the namespace this app wants a user to reach for
  // first, with the Postman spellings still offered (tagged accordingly) right after.
  const fakeCandidates: Completion[] = FAKE_NAMES.map((name) => ({
    label: name,
    detail: 'dynamic',
    icon: 'symbol-variable',
  }));
  const dynamicCandidates: Completion[] = DYNAMIC_NAMES.map((name) => ({
    label: name,
    detail: 'postman alias',
    icon: 'symbol-variable',
  }));
  // D7's table, as a completion detail — a one-line reminder of what each transform does, shown
  // to the right of its name exactly where `variable`/`secret`/`dynamic` show for the other list.
  const TRANSFORM_DETAILS: Record<TransformName, string> = {
    base64: 'base64 encode',
    base64decode: 'base64 decode',
    upper: 'upper-case',
    lower: 'lower-case',
    urlencode: 'URL-encode (query form)',
    urldecode: 'URL-decode (query form)',
  };
  const transformCandidates: Completion[] = TRANSFORM_NAMES.map((name) => ({
    label: name,
    detail: TRANSFORM_DETAILS[name],
    icon: 'symbol-method',
  }));
  const nameCandidates = [...varCandidates, ...fakeCandidates, ...dynamicCandidates];

  function candidates(ctx: { text: string; from: number; word: string }): Completion[] {
    return isAfterPipe(ctx.text, ctx.from) ? transformCandidates : nameCandidates;
  }

  return {
    rangeHighlights,
    hoverAt,
    candidates,
  };
}
