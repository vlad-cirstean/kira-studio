#!/usr/bin/env bun
/**
 * P110 I2-3: catches a same-`twMerge`-group cascade fight between a static `class` token and a
 * conditional literal on the *same* element, plus a self-conflicting static class set — the whole
 * defect shape §2.2 M3/M7 and audit §1g name (a plain-CSS habit surviving the move to Tailwind:
 * "keep the base class, add an override alongside it" — twMerge doesn't dedupe two same-property
 * literals the way an unlayered CSS rule's specificity/source-order used to).
 *
 * Method (§3.1): parse every `.vue` file's `<template>` with `@vue/compiler-sfc`'s own `parse()` —
 * its `descriptor.template.ast` already carries each `:class` binding's expression as a real
 * (Babel-shaped) AST, the same one Vue's own compiler uses internally. That AST already IS a fully
 * parsed JS/TS expression tree, so there is nothing left for a second, separate TypeScript-compiler
 * parse to do — walking `exp.ast` directly is the same analysis the plan's own "parse with the
 * typescript compiler API" step describes, one parse instead of two, with no behaviour difference
 * (noted here since it's an implementation refinement from the plan's literal wording, not a scope
 * change).
 *
 * For each element with a static `class="..."` attribute:
 *   - Skip entirely when the `:class` binding's root expression is a call to `cn(...)`/
 *     `twMergeKv(...)`: the runtime merge already reconciles it (§3.1).
 *   - Otherwise, split both the static tokens and every literal found in the `:class` expression
 *     (every string literal anywhere in the tree, plus every string/identifier object-property key
 *     — a class-toggle map's own class names) into two groups by the `kv:` prefix, since a `kv:`
 *     token merges through kira-ui's own `cn()` (git-ui's root uses the same prefix) and every
 *     other token merges through theme's own `cn()` (§3.1: "merge function per token").
 *   - Fail 1 (static-conflict): merging a group's own static tokens against themselves changes the
 *     set (a same-group duplicate/self-conflict already sitting in the static class list).
 *   - Fail 2 (static-vs-conditional): merging a group's static tokens plus one conditional literal
 *     token drops one of the static tokens (the literal silently wins the cascade over the base).
 *
 * Registration self-check (§3.1, makes acceptance-2 self-enforcing): every `--text-*`/
 * `--spacing-*`/`--radius-*`/`--shadow-*`/`--animate-*`/`--leading-*` name declared in
 * `PT/base.css`'s and `KU/theme/tailwind-theme.css`'s own `@theme` blocks must sort into its own
 * twMerge group — asserted directly against the real merge functions, not by reading config.
 *
 * Landed unwired (I2-3): run directly with `bun scripts/check-class-conflicts.ts`. Wired into
 * `bun run lint` at I2-9, once every hit its first run surfaces is fixed.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse as parseSFC } from '@vue/compiler-sfc';
import { cn as cnKv } from '../packages/kira-ui/src/cn';
import { cn } from '../packages/theme/src/lib/utils';

const REPO_ROOT = join(import.meta.dir, '..');

const SCAN_DIRS = [
  'apps/kira-studio/frontend/src',
  'apps/kira-space/frontend/src',
  'packages/theme/src',
  'packages/workbench/src',
  'packages/git-ui/src',
  'packages/kira-ui/src',
];

interface Hit {
  file: string;
  line: number;
  kind: 'static-conflict' | 'static-vs-conditional' | 'registration';
  staticTokens: string;
  conditional: string;
}

function listVueFiles(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      listVueFiles(full, out);
    } else if (entry.endsWith('.vue')) {
      out.push(full);
    }
  }
}

function tokensOf(s: string): string[] {
  return s.trim().split(/\s+/).filter(Boolean);
}

function splitKv(tokens: string[]): { kv: string[]; plain: string[] } {
  const kv: string[] = [];
  const plain: string[] = [];
  for (const t of tokens) {
    if (t.startsWith('kv:')) kv.push(t);
    else plain.push(t);
  }
  return { kv, plain };
}

function mergeGroup(tokens: string[], isKv: boolean): string[] {
  if (tokens.length === 0) return [];
  const merged = isKv ? cnKv(tokens.join(' ')) : cn(tokens.join(' '));
  return tokensOf(merged);
}

function sameSet(a: string[], b: string[]): boolean {
  const sa = [...new Set(a)].sort();
  const sb = [...new Set(b)].sort();
  if (sa.length !== sb.length) return false;
  return sa.every((v, i) => v === sb[i]);
}

/** Walks a Babel-shaped AST (compiler-sfc's own `:class` expression parse), not a Vue-template AST
 *  -- generic recursive structural walk, no dedicated visitor package needed for two node kinds. */
function collectLiterals(node: unknown, out: string[]): void {
  if (node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) collectLiterals(n, out);
    return;
  }
  const n = node as Record<string, unknown>;
  if (n.type === 'StringLiteral' && typeof n.value === 'string') {
    out.push(n.value);
  }
  if (n.type === 'ObjectProperty') {
    const key = n.key as Record<string, unknown> | undefined;
    if (key?.type === 'StringLiteral' && typeof key.value === 'string') {
      out.push(key.value);
    } else if (!n.computed && key?.type === 'Identifier' && typeof key.name === 'string') {
      out.push(key.name);
    }
  }
  for (const k of Object.keys(n)) {
    if (
      k === 'loc' ||
      k === 'start' ||
      k === 'end' ||
      k === 'range' ||
      k === 'leadingComments' ||
      k === 'trailingComments'
    ) {
      continue;
    }
    const v = n[k];
    if (v && typeof v === 'object') collectLiterals(v, out);
  }
}

function isCnRootCall(ast: unknown): boolean {
  const n = ast as Record<string, unknown> | null;
  if (n?.type !== 'CallExpression') return false;
  const callee = n.callee as Record<string, unknown> | undefined;
  return callee?.type === 'Identifier' && (callee.name === 'cn' || callee.name === 'twMergeKv');
}

// biome-ignore lint/suspicious/noExplicitAny: compiler-sfc's compiled-template AST node shape
type TemplateNode = any;

function findClassAttrs(node: TemplateNode): {
  staticClass: string;
  classExpAst: unknown;
  line: number;
} {
  let staticClass = '';
  let classExpAst: unknown = null;
  let line = node.loc?.start?.line ?? 0;
  for (const p of node.props ?? []) {
    if (p.type === 6 && p.name === 'class') {
      staticClass = p.value?.content ?? '';
      line = p.loc?.start?.line ?? line;
    }
    if (p.type === 7 && p.name === 'bind' && p.arg?.content === 'class') {
      classExpAst = p.exp?.ast ?? null;
      line = p.loc?.start?.line ?? line;
    }
  }
  return { staticClass, classExpAst, line };
}

// Fail 1 (§3.1): merging a group's own static tokens against themselves changes the set.
function checkStaticSelfConflict(
  kvStatic: string[],
  plainStatic: string[],
  relPath: string,
  line: number,
  hits: Hit[],
): void {
  for (const [group, isKv] of [
    [kvStatic, true],
    [plainStatic, false],
  ] as const) {
    if (group.length === 0) continue;
    const merged = mergeGroup(group, isKv);
    if (!sameSet(merged, group)) {
      hits.push({
        file: relPath,
        line,
        kind: 'static-conflict',
        staticTokens: group.join(' '),
        conditional: '',
      });
    }
  }
}

// Fail 2 (§3.1): merging a group's static tokens plus one conditional literal drops a static token.
function checkStaticVsConditional(
  classExpAst: unknown,
  kvStatic: string[],
  plainStatic: string[],
  relPath: string,
  line: number,
  hits: Hit[],
): void {
  const lits: string[] = [];
  collectLiterals(classExpAst, lits);
  const seenTok = new Set<string>();
  for (const lit of lits) {
    for (const tok of tokensOf(lit)) {
      if (seenTok.has(tok)) continue;
      seenTok.add(tok);
      const isKv = tok.startsWith('kv:');
      const group = isKv ? kvStatic : plainStatic;
      if (group.length === 0) continue;
      const merged = mergeGroup([...group, tok], isKv);
      const mergedSet = new Set(merged);
      const dropped = group.filter((g) => !mergedSet.has(g));
      if (dropped.length > 0) {
        hits.push({
          file: relPath,
          line,
          kind: 'static-vs-conditional',
          staticTokens: group.join(' '),
          conditional: tok,
        });
      }
    }
  }
}

function checkElement(node: TemplateNode, relPath: string, hits: Hit[]): void {
  const { staticClass, classExpAst, line } = findClassAttrs(node);
  if (!staticClass) return;
  if (classExpAst && isCnRootCall(classExpAst)) return; // merges at runtime, §3.1

  const staticTokens = tokensOf(staticClass);
  const { kv: kvStatic, plain: plainStatic } = splitKv(staticTokens);

  checkStaticSelfConflict(kvStatic, plainStatic, relPath, line, hits);
  if (classExpAst) {
    checkStaticVsConditional(classExpAst, kvStatic, plainStatic, relPath, line, hits);
  }
}

function walk(node: TemplateNode, relPath: string, hits: Hit[]): void {
  if (!node) return;
  if (node.type === 1) {
    checkElement(node, relPath, hits);
  }
  for (const child of node.children ?? []) {
    walk(child, relPath, hits);
  }
  // Element nodes can also carry v-if/v-else branch content under `branches` (IfNode) — compiler
  // AST already flattens those into `children` on the containing IfBranchNode, which itself has
  // type 1-shaped `props`/`children`, so the same recursion covers them; templateChildren of
  // ForNode/IfNode are covered by the generic `children` walk above since both node kinds expose
  // a `children` (or `branches[].children`) array. Cover `branches` explicitly for completeness.
  if (Array.isArray(node.branches)) {
    for (const branch of node.branches) walk(branch, relPath, hits);
  }
}

function checkFile(absPath: string, hits: Hit[]): void {
  const relPath = relative(REPO_ROOT, absPath);
  const src = readFileSync(absPath, 'utf8');
  if (!src.includes('<template')) return;
  let descriptor: ReturnType<typeof parseSFC>['descriptor'];
  try {
    descriptor = parseSFC(src, { filename: relPath }).descriptor;
  } catch (e) {
    console.error(`check-class-conflicts: failed to parse ${relPath}: ${(e as Error).message}`);
    return;
  }
  const ast = descriptor.template?.ast;
  if (!ast) return;
  walk(ast, relPath, hits);
}

// --- Registration self-check ---

function themeTokenNames(cssPath: string, prefix: string): string[] {
  const src = readFileSync(join(REPO_ROOT, cssPath), 'utf8');
  const re = new RegExp(`--${prefix}-([a-z0-9-]+):`, 'g');
  const names: string[] = [];
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex-exec-loop idiom
  while ((m = re.exec(src))) {
    names.push(m[1]);
  }
  return names;
}

interface RegCase {
  group: string;
  // A default-scale value in the SAME merge group -- merging it with `own` must collapse to one
  // class (proves `own` sorts into the real `group` merge group, not "ungrouped, always kept").
  ambiguous: string;
  // A default-scale value that shares the SAME utility prefix but a DIFFERENT merge group -- only
  // `text` has this (text-red-500 is a colour, text-xs is a font-size; twMerge splits them into two
  // groups despite the shared `text-` prefix). Omitted for every other group: `p-`/`rounded-`/
  // `shadow-`/`animate-`/`leading-` have no same-prefix distinct-group split in Tailwind's own
  // config, so there is no meaningful "both survive" case to assert there.
  distinctBaseline?: string;
}

const REG_CASES: RegCase[] = [
  { group: 'text', ambiguous: 'text-xs', distinctBaseline: 'text-red-500' },
  { group: 'spacing', ambiguous: 'p-1' },
  { group: 'radius', ambiguous: 'rounded-md' },
  { group: 'shadow', ambiguous: 'shadow-md' },
  { group: 'animate', ambiguous: 'animate-spin' },
  { group: 'leading', ambiguous: 'leading-4' },
];

const UTILITY_PREFIX: Record<string, string> = {
  text: 'text',
  spacing: 'p',
  radius: 'rounded',
  shadow: 'shadow',
  animate: 'animate',
  leading: 'leading',
};

// Distinct family (e.g. text-red-500 vs text-X): both must survive.
function checkDistinctFamily(
  own: string,
  distinctBaseline: string,
  isKv: boolean,
  cssPath: string,
  hits: Hit[],
): void {
  const base = isKv ? `kv:${distinctBaseline}` : distinctBaseline;
  const withBase = mergeGroup([base, own], isKv);
  if (!withBase.includes(base) || !withBase.includes(own)) {
    hits.push({
      file: cssPath,
      line: 0,
      kind: 'registration',
      staticTokens: `${own} not correctly grouped -- lost against '${base}' (expected both to survive)`,
      conditional: '',
    });
  }
}

// Same family (e.g. text-xs vs text-X): exactly one must survive (the group is registered as a
// real merge group, so it conflicts with its own family's other members).
function checkSameFamily(
  own: string,
  group: string,
  ambiguous: string,
  isKv: boolean,
  cssPath: string,
  hits: Hit[],
): void {
  const amb = isKv ? `kv:${ambiguous}` : ambiguous;
  const withAmb = mergeGroup([amb, own], isKv);
  if (withAmb.length !== 1) {
    hits.push({
      file: cssPath,
      line: 0,
      kind: 'registration',
      staticTokens: `${own} not registered in the '${group}' merge group -- '${amb} ${own}' should collapse to one class, got: ${withAmb.join(' ')}`,
      conditional: '',
    });
  }
}

function checkRegistration(cssPath: string, isKv: boolean, hits: Hit[]): void {
  for (const { group, ambiguous, distinctBaseline } of REG_CASES) {
    const names = themeTokenNames(cssPath, group);
    for (const name of names) {
      const tokenName = `${UTILITY_PREFIX[group]}-${name}`;
      const own = isKv ? `kv:${tokenName}` : tokenName;
      if (distinctBaseline) {
        checkDistinctFamily(own, distinctBaseline, isKv, cssPath, hits);
      }
      checkSameFamily(own, group, ambiguous, isKv, cssPath, hits);
    }
  }
}

function main(): void {
  const hits: Hit[] = [];
  for (const dir of SCAN_DIRS) {
    const files: string[] = [];
    listVueFiles(join(REPO_ROOT, dir), files);
    for (const f of files) checkFile(f, hits);
  }
  checkRegistration('packages/theme/src/base.css', false, hits);
  checkRegistration('packages/kira-ui/src/theme/tailwind-theme.css', true, hits);

  if (hits.length === 0) {
    console.log('check-class-conflicts: no conflicts found.');
    return;
  }
  for (const h of hits) {
    if (h.kind === 'static-conflict') {
      console.error(
        `${h.file}:${h.line}  static-conflict  '${h.staticTokens}' merges to a smaller set on its own`,
      );
    } else if (h.kind === 'static-vs-conditional') {
      console.error(
        `${h.file}:${h.line}  static-vs-conditional  '${h.staticTokens}' vs '${h.conditional}'`,
      );
    } else {
      console.error(`${h.file}:${h.line}  registration  ${h.staticTokens}`);
    }
  }
  console.error(`check-class-conflicts: ${hits.length} hit(s) found.`);
  process.exit(1);
}

main();
