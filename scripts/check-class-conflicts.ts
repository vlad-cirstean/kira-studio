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
 *
 * P131 Part 1 §7: a third rule, scoped to `packages/git-ui/src/**\/*.vue` only -- a tag whose local
 * name is imported from `@theme/components/**` (a shadcn component) is a theme-root element, so it
 * must carry no `kv:` token: `kv:` is git-ui's own prefixed root's vocabulary and never merges
 * through the theme's unprefixed `cn()` a shadcn component's own template uses internally. Detected
 * from each file's own `<script setup>` import specifiers (regex, not a full TS parse -- import
 * statements are a fixed enough shape), then matched against template tag names in both PascalCase
 * (as imported) and kebab-case (Vue's own template-tag normalisation).
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

const GIT_UI_DIR = 'packages/git-ui/src';

interface Hit {
  file: string;
  line: number;
  kind: 'static-conflict' | 'static-vs-conditional' | 'registration' | 'kv-on-theme-component';
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

// P131 Part 1 §7: local names a git-ui file imports from a shadcn theme component module --
// `import { Dialog, DialogContent } from '@theme/components/ui/dialog'` or
// `import Foo from '@theme/components/ui/foo/Foo.vue'`. Regex over the raw script source: import
// statements are a fixed enough shape that a full TS parse buys nothing here.
function themeComponentLocalNames(scriptSrc: string): Set<string> {
  const names = new Set<string>();
  const importRe = /import\s+([^;]+?)\s+from\s+['"](@theme\/components\/[^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  // biome-ignore lint/suspicious/noAssignInExpressions: standard regex-exec-loop idiom
  while ((m = importRe.exec(scriptSrc))) {
    const clause = m[1].trim();
    const namedMatch = clause.match(/^\{([^}]*)\}$/);
    if (namedMatch) {
      for (const part of namedMatch[1].split(',')) {
        const spec = part.trim();
        if (!spec) continue;
        const asMatch = spec.match(/^\S+\s+as\s+(\S+)$/);
        names.add(asMatch ? asMatch[1] : spec);
      }
    } else {
      // Default import, e.g. `Foo` in `import Foo from '@theme/components/ui/foo/Foo.vue'`.
      names.add(clause);
    }
  }
  return names;
}

function pascalToKebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

// Fail 3 (§7): a shadcn theme-component tag in git-ui markup carrying a `kv:` token.
function checkKvOnThemeComponent(
  node: TemplateNode,
  themeNames: Set<string>,
  relPath: string,
  hits: Hit[],
): void {
  const tag: string = node.tag ?? '';
  // Exact PascalCase match (`<Dialog>`, as every call site in this repo writes it), or a REAL
  // kebab-case rendering with an inserted hyphen (`<RadioGroupItem>` -> `radio-group-item`).
  // Deliberately NOT a bare `.toLowerCase()` of a single-word name -- that would collapse `Label`/
  // `Dialog`/`Button`/`Input` down to `label`/`dialog`/`button`/`input`, colliding with the native
  // HTML elements of the same spelling that Vue's compiler always resolves those lowercase tags
  // to, never to a same-named component (confirmed against ForcePushDialog.vue's own native
  // `<label>` false-positiving here before this guard was added).
  const matches =
    themeNames.has(tag) ||
    [...themeNames].some((n) => {
      const kebab = pascalToKebab(n);
      return kebab.includes('-') && kebab === tag;
    });
  if (!matches) return;
  const { staticClass, classExpAst, line } = findClassAttrs(node);
  const tokens = tokensOf(staticClass).filter((t) => t.startsWith('kv:'));
  if (classExpAst) {
    const lits: string[] = [];
    collectLiterals(classExpAst, lits);
    for (const lit of lits) {
      for (const tok of tokensOf(lit)) {
        if (tok.startsWith('kv:')) tokens.push(tok);
      }
    }
  }
  for (const tok of tokens) {
    hits.push({
      file: relPath,
      line,
      kind: 'kv-on-theme-component',
      staticTokens: `<${tag}>`,
      conditional: tok,
    });
  }
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

function checkElement(
  node: TemplateNode,
  relPath: string,
  themeNames: Set<string>,
  hits: Hit[],
): void {
  // P131 Part 1 §7: independent of the static/conditional checks below (and of whether the tag
  // carries any static class at all) -- only git-ui's own tree is in scope for this rule.
  if (themeNames.size > 0 && relPath.startsWith(GIT_UI_DIR)) {
    checkKvOnThemeComponent(node, themeNames, relPath, hits);
  }

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

function walk(node: TemplateNode, relPath: string, themeNames: Set<string>, hits: Hit[]): void {
  if (!node) return;
  if (node.type === 1) {
    checkElement(node, relPath, themeNames, hits);
  }
  for (const child of node.children ?? []) {
    walk(child, relPath, themeNames, hits);
  }
  // Element nodes can also carry v-if/v-else branch content under `branches` (IfNode) — compiler
  // AST already flattens those into `children` on the containing IfBranchNode, which itself has
  // type 1-shaped `props`/`children`, so the same recursion covers them; templateChildren of
  // ForNode/IfNode are covered by the generic `children` walk above since both node kinds expose
  // a `children` (or `branches[].children`) array. Cover `branches` explicitly for completeness.
  if (Array.isArray(node.branches)) {
    for (const branch of node.branches) walk(branch, relPath, themeNames, hits);
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
  const scriptSrc = (descriptor.scriptSetup?.content ?? '') + (descriptor.script?.content ?? '');
  const themeNames = themeComponentLocalNames(scriptSrc);
  walk(ast, relPath, themeNames, hits);
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
  // P131 Part 1 §3.1 moved every --text-*/--radius-*/--shadow-*/--animate-*/--leading-* name out of
  // base.css into tailwind-core.css -- this self-check must follow, or it silently checks zero
  // names (a for-loop over an empty themeTokenNames() list, no error).
  checkRegistration('packages/theme/src/tailwind-core.css', false, hits);
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
    } else if (h.kind === 'kv-on-theme-component') {
      console.error(
        `${h.file}:${h.line}  kv-on-theme-component  ${h.staticTokens} carries '${h.conditional}' -- a shadcn component reads the unprefixed root`,
      );
    } else {
      console.error(`${h.file}:${h.line}  registration  ${h.staticTokens}`);
    }
  }
  console.error(`check-class-conflicts: ${hits.length} hit(s) found.`);
  process.exit(1);
}

main();
