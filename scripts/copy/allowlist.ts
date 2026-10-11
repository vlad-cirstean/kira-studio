/**
 * P265 F3: allowlist for check-copy (P263 format). One entry per line:
 *   `path`                        whole file exempt from U64-U71 while unmigrated
 *   `permanent U<n> path # why`   one rule exempt for one file, reason required
 * `#` starts a comment. Lists only shrink: an entry with no hit left is stale and fails.
 */
import { type Hit, SOURCE_RULES, type SourceRule } from './sourceRules';

export type AllowEntry =
  | { kind: 'file'; path: string; origin: string }
  | { kind: 'permanent'; rule: SourceRule; path: string; reason: string; origin: string };

export interface ParsedAllowlist {
  entries: AllowEntry[];
  errors: string[];
}

export function parseAllowlist(text: string, name: string): ParsedAllowlist {
  const entries: AllowEntry[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  text.split('\n').forEach((raw, i) => {
    const origin = `${name}:${i + 1}`;
    const hash = raw.indexOf('#');
    const body = (hash === -1 ? raw : raw.slice(0, hash)).trim();
    const reason = hash === -1 ? '' : raw.slice(hash + 1).trim();
    if (body === '') return;
    if (seen.has(body)) {
      errors.push(`${origin}: duplicate entry "${body}"`);
      return;
    }
    seen.add(body);
    const words = body.split(/\s+/);
    if (words[0] === 'permanent') {
      const [, rule, path, ...rest] = words;
      if (!rule || !path || rest.length > 0 || !SOURCE_RULES.includes(rule as SourceRule)) {
        errors.push(`${origin}: expected "permanent U<64-71> path # reason"`);
      } else if (reason === '') {
        errors.push(`${origin}: permanent entry needs a "# reason"`);
      } else {
        entries.push({ kind: 'permanent', rule: rule as SourceRule, path, reason, origin });
      }
      return;
    }
    if (words.length !== 1) {
      errors.push(`${origin}: expected a single path, got "${body}"`);
      return;
    }
    entries.push({ kind: 'file', path: body, origin });
  });
  return { entries, errors };
}

export interface ApplyResult {
  remaining: Hit[];
  errors: string[];
}

/** Drops hits the allowlist covers; reports every entry that covers nothing. */
export function applyAllowlist(hits: readonly Hit[], entries: readonly AllowEntry[]): ApplyResult {
  const errors: string[] = [];
  const byFile = new Map<string, Hit[]>();
  for (const h of hits) {
    const list = byFile.get(h.file);
    if (list) list.push(h);
    else byFile.set(h.file, [h]);
  }
  for (const e of entries) {
    const fileHits = byFile.get(e.path) ?? [];
    if (e.kind === 'file' && fileHits.length === 0) {
      errors.push(`${e.origin}: stale entry, no hit left in ${e.path} (remove it)`);
    }
    if (e.kind === 'permanent' && !fileHits.some((h) => h.rule === e.rule)) {
      errors.push(
        `${e.origin}: stale permanent ${e.rule} entry, no ${e.rule} hit left in ${e.path} (remove it)`,
      );
    }
  }
  const wholeFile = new Set(entries.filter((e) => e.kind === 'file').map((e) => e.path));
  const permanent = new Set(
    entries.filter((e) => e.kind === 'permanent').map((e) => `${e.rule} ${e.path}`),
  );
  const remaining = hits.filter(
    (h) => !wholeFile.has(h.file) && !permanent.has(`${h.rule} ${h.file}`),
  );
  return { remaining, errors };
}

/** Hits left once only `permanent` lines apply: the files still owed a migration. */
export function failingFiles(hits: readonly Hit[], entries: readonly AllowEntry[]): string[] {
  const kept = applyAllowlist(
    hits,
    entries.filter((e) => e.kind === 'permanent'),
  ).remaining;
  return [...new Set(kept.map((h) => h.file))].sort();
}
