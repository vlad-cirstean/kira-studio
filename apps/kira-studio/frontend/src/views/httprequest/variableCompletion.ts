import {
  classifyReference,
  DYNAMIC_NAMES,
  isDynamicName,
  type ReferenceKind,
  splitTemplateSpans,
} from '@kira/api-core';
import { cachedVariables, mergedValuesAndSecrets } from '../../api/state/variables';
import type { RangeHighlight } from '../../editor/variableHighlight';
import type { Completion } from '../../theme/primitives/completion';

// P15b D4: the Api side supplies the data, in one module, from the call already being made — F5's
// own finding that mergedValuesAndSecrets is already synchronous, already cached, and already
// fired on mount/collection/environment change by HttpRequestView.vue. This module builds three
// pure, DOM-free lookups over that same data for D2/D3's editor seams to call: colouring
// (rangeHighlights), the hover panel's lines (hoverAt), and the `{{…}}` completion list
// (candidates). May import @kira/api-core and api/state/variables.ts; may not import
// `workbench/**` (biome.json).

const HOVER_VALUE_MAX_LENGTH = 200;

// D2's three classes (editor/theme.ts): resolved and a catalogued dynamic reference (both "this
// will produce a value") share `.cm-kira-var`; an uncatalogued dynamic reference is painted
// exactly like `unknown` (D2's own table: "unknown, or an uncatalogued `{{$dynamic}}`").
function classFor(name: string, kind: ReferenceKind): string {
  switch (kind) {
    case 'resolved':
      return 'cm-kira-var';
    case 'deferred':
      return 'cm-kira-var-secret';
    case 'dynamic':
      return isDynamicName(name) ? 'cm-kira-var' : 'cm-kira-var-unknown';
    case 'unknown':
      return 'cm-kira-var-unknown';
  }
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
  candidates: Completion[];
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
    switch (kind) {
      case 'resolved': {
        const value = values[span.name] ?? '';
        const truncated =
          value.length > HOVER_VALUE_MAX_LENGTH
            ? `${value.slice(0, HOVER_VALUE_MAX_LENGTH)}…`
            : value;
        return [truncated, `${scopeOf(span.name, environmentId)} variable`];
      }
      case 'deferred':
        // F5/§0.3: a secret's plaintext never enters the renderer to begin with — there is no
        // value this line could show even if it wanted to. Never a second line.
        return ['secret — resolved when the request is sent'];
      case 'dynamic':
        // D4's table also wants "the catalogue's own description" as a second line here — the
        // catalogue (api-core's dynamic/catalog.ts) deliberately carries no description strings
        // (DynamicValuesDialog.vue's own D11: "the sample is the description", which needs an
        // async generator load this synchronous hover can't perform) — so only line 1 is shown,
        // a documented deviation rather than a second, drifting copy of that dialog's samples.
        return isDynamicName(span.name)
          ? ['generated fresh on every send']
          : ['unknown dynamic value'];
      case 'unknown':
        return ['not defined in this collection or environment'];
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
  const dynamicCandidates: Completion[] = DYNAMIC_NAMES.map((name) => ({
    label: name,
    detail: 'dynamic',
    icon: 'symbol-variable',
  }));

  return {
    rangeHighlights,
    hoverAt,
    candidates: [...varCandidates, ...dynamicCandidates],
  };
}
