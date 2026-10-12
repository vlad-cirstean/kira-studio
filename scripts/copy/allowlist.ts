/**
 * P265: named exemptions for check-copy. One rule exempt for one file, reason required. An
 * exemption with no hit left is stale and fails, so the list only shrinks.
 */
import type { Hit, SourceRule } from './sourceRules';

export interface Exemption {
  rule: SourceRule;
  path: string;
  reason: string;
}

export interface ApplyResult {
  remaining: Hit[];
  errors: string[];
}

/** Drops hits an exemption covers; reports every exemption that covers nothing. */
export function applyExemptions(
  hits: readonly Hit[],
  exemptions: readonly Exemption[],
): ApplyResult {
  const errors = exemptions
    .filter((e) => !hits.some((h) => h.file === e.path && h.rule === e.rule))
    .map((e) => `stale exemption ${e.rule} ${e.path}, no ${e.rule} hit left (remove it)`);
  const exempt = new Set(exemptions.map((e) => `${e.rule} ${e.path}`));
  return { remaining: hits.filter((h) => !exempt.has(`${h.rule} ${h.file}`)), errors };
}
