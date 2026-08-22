import type { ConnectionFilter, FilterNodeKind } from '@shared/domain/connection-filter';
import type { TreeNode } from '@shared/domain/tree';

const compiledCache = new Map<string, RegExp | null>();

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

function compile(rule: ConnectionFilter): RegExp | null {
  const cacheKey = `${rule.isRegex ? 'r' : 'g'}:${rule.pattern}`;
  const cached = compiledCache.get(cacheKey);
  if (cached !== undefined) return cached;
  let compiled: RegExp | null;
  try {
    compiled = rule.isRegex ? new RegExp(rule.pattern) : globToRegExp(rule.pattern);
  } catch {
    // An invalid regex rule is caught here and skipped — the filters dialog surfaces the
    // error next to that row instead of breaking every other rule's evaluation.
    compiled = null;
  }
  compiledCache.set(cacheKey, compiled);
  return compiled;
}

const FILTERABLE_KINDS = new Set<FilterNodeKind>(['database', 'schema', 'table']);

// D13: filters are applied in the renderer, at render time, over cached nodes. They never
// change what is fetched or cached.
//
// 1. Rules for this node kind only.
// 2. If any 'show' rule exists for the kind, the node must match at least one, else drop.
// 3. Then, if the node matches any 'hide' rule, drop.
export function evaluate(node: TreeNode, rules: ConnectionFilter[]): boolean {
  if (!FILTERABLE_KINDS.has(node.kind as FilterNodeKind)) return true;
  const applicable = rules.filter((rule) => rule.nodeKind === node.kind);
  if (applicable.length === 0) return true;

  const showRules = applicable.filter((rule) => rule.action === 'show');
  if (showRules.length > 0 && !showRules.some((rule) => compile(rule)?.test(node.name) ?? false)) {
    return false;
  }

  const hideRules = applicable.filter((rule) => rule.action === 'hide');
  if (hideRules.some((rule) => compile(rule)?.test(node.name) ?? false)) return false;

  return true;
}
