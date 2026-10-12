/**
 * P265: named exemptions for check-copy. One rule exempt for one file, reason required. An
 * exemption with no hit left is stale and fails, so the list only shrinks.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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

const PENDING_LINE = /^(U6[4-9]|U7[01]) (\S+)$/;

/** P266 pending lists: `U<n> path` (n in 64-71) exempts one rule for one file until it migrates. */
export function loadPending(dir: string): Exemption[] {
  if (!existsSync(dir)) return [];
  const out: Exemption[] = [];
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.txt'))) {
    for (const raw of readFileSync(join(dir, name), 'utf8').split('\n')) {
      const m = PENDING_LINE.exec(raw.replace(/\s*#.*$/, '').trim());
      if (m) out.push({ rule: m[1] as SourceRule, path: m[2] ?? '', reason: 'pending (P266)' });
    }
  }
  return out;
}
