import type { TreeNode } from '@shared/tree';

// D13: filters are presentation-only, applied over cached nodes at render time (never what is
// fetched or cached). Glob is the default (* / ? → regex, everything else escaped); isRegex uses
// the pattern as-is. Compiled once per rule and cached; an invalid regex is skipped.

// The subset of ConnectionFilter that evaluation actually reads, so the filters dialog can preview
// unsaved draft rules before they have an id/connectionId.
export interface FilterRuleLike {
  nodeKind: 'database' | 'schema' | 'table';
  pattern: string;
  isRegex: boolean;
  action: 'hide' | 'show';
}

const regexCache = new Map<string, RegExp | null>();

export function compileRule(pattern: string, isRegex: boolean): RegExp | null {
  const cacheKey = `${isRegex ? 'r' : 'g'}:${pattern}`;
  const cached = regexCache.get(cacheKey);
  if (cached !== undefined) return cached;

  let compiled: RegExp | null = null;
  try {
    compiled = isRegex ? new RegExp(pattern) : globToRegex(pattern);
  } catch {
    compiled = null;
  }
  regexCache.set(cacheKey, compiled);
  return compiled;
}

function globToRegex(glob: string): RegExp {
  let source = '^';
  for (const ch of glob) {
    if (ch === '*') source += '.*';
    else if (ch === '?') source += '.';
    else if (/[\\^$.*+?()[\]{}|]/.test(ch)) source += `\\${ch}`;
    else source += ch;
  }
  source += '$';
  return new RegExp(source);
}

// §8.3 evaluation:
//   1. only rules for this node's kind apply,
//   2. if any 'show' rule exists for the kind, the node must match at least one — else drop,
//   3. then, if the node matches any 'hide' rule, drop.
export function evaluate(node: TreeNode, rules: FilterRuleLike[]): boolean {
  const applicable = rules.filter((r) => r.nodeKind === node.kind);
  if (applicable.length === 0) return true;

  const shows = applicable.filter((r) => r.action === 'show');
  if (shows.length > 0 && !shows.some((r) => compileRule(r.pattern, r.isRegex)?.test(node.name))) {
    return false;
  }

  const hides = applicable.filter((r) => r.action === 'hide');
  if (hides.some((r) => compileRule(r.pattern, r.isRegex)?.test(node.name))) return false;
  return true;
}

// Live preview for the filters dialog: how many of the given nodes a rule set would hide.
export function countFiltered(
  nodes: TreeNode[],
  rules: FilterRuleLike[],
): { total: number; hidden: number } {
  let total = 0;
  let hidden = 0;
  for (const node of nodes) {
    total += 1;
    if (!evaluate(node, rules)) hidden += 1;
  }
  return { total, hidden };
}
