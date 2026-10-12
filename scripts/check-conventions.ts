#!/usr/bin/env bun
/**
 * P266 code convention guard N1-N7 (docs/v2.2/plans/P266-consistency-audit.md section 2.10 and
 * 4.2).
 *
 * N1 file names (.ts camelCase, .vue PascalCase), N2 no `.test.ts`, N3 no util/utils/helpers
 * folder, N4 Pinia id = export name without `use`/`create` and `Store`, N5 event names
 * `kira:<scope>:<name>` in camelCase, N7 new migrations follow `NNNN_<phase>_<slug>.sql` and add no
 * TEXT `*_at` column, N6 the Go (`internal/ipcerr/codes.go`) and TS
 * (`packages/shared/domain/errorCodes.ts`) error-code registries list the same codes.
 *
 * A hit listed as `N<n> path` in scripts/consistency-allowlist/*.txt is pending migration; a line
 * that matches no hit is stale and fails, so the lists only shrink.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Rule = 'N1' | 'N2' | 'N3' | 'N4' | 'N5' | 'N6' | 'N7';
export interface Hit {
  rule: Rule;
  path: string;
  message: string;
}

const REPO_ROOT = join(import.meta.dir, '..');
const ALLOW_DIR = join(REPO_ROOT, 'scripts/consistency-allowlist');
const SOURCE_ROOTS = ['apps/kira-studio/frontend', 'apps/kira-space/frontend', 'packages'];
const SKIP_DIR = new Set([
  'node_modules',
  'dist',
  'bindings',
  'wire',
  'generated',
  'tests',
  'test',
  '__tests__',
  'db-fixtures',
  '.cache',
]);
const EVENT_FILES = [
  { path: 'packages/shared/protocol/events.ts', literal: /'(kira:[^']*)'/g },
  { path: 'internal/appevent/appevent.go', literal: /"(kira:[^"]*)"/g },
];
const GO_CODES_PATH = 'internal/ipcerr/codes.go';
const TS_CODES_PATH = 'packages/shared/domain/errorCodes.ts';
const EVENT_NAME = /^kira:[a-z][a-zA-Z]*:[a-z][a-zA-Z]*$/;
const MIGRATION_SETS: ReadonlyArray<{ dir: string; baseline: number }> = [
  { dir: 'apps/kira-space/internal/gitreview/migrations', baseline: 3 },
  { dir: 'apps/kira-space/internal/storage/migrations', baseline: 32 },
  { dir: 'apps/kira-studio/internal/storage/migrations', baseline: 37 },
  { dir: 'internal/memory/migrations', baseline: 3 },
];
const MIGRATION_NAME = /^(\d{4})_[a-z]\d+[a-z]?_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/;
const BAD_FOLDERS = new Set(['util', 'utils', 'helpers']);

export function fileNameHit(path: string): Hit | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1);
  if (name.endsWith('.d.ts') || name.endsWith('.config.ts')) return undefined;
  if (name.endsWith('.vue')) {
    return /^[A-Z][a-zA-Z0-9]*\.vue$/.test(name)
      ? undefined
      : { rule: 'N1', path, message: 'component file name is not PascalCase' };
  }
  if (!name.endsWith('.ts')) return undefined;
  // `.worker` (Vite worker entry) and `.check` (type-level check) are role suffixes, not word breaks.
  const base = name.replace(/(?:\.(?:worker|check|spec|test))?\.ts$/, '');
  return /^[a-z][a-zA-Z0-9]*$/.test(base)
    ? undefined
    : { rule: 'N1', path, message: 'module file name is not camelCase' };
}

export function testSuffixHit(path: string): Hit | undefined {
  return path.endsWith('.test.ts')
    ? { rule: 'N2', path, message: 'use the .spec.ts suffix' }
    : undefined;
}

export function folderHits(path: string): Hit[] {
  const dirs = path.split('/').slice(0, -1);
  return BAD_FOLDERS.has(dirs.at(-1) ?? '')
    ? [{ rule: 'N3', path: dirs.join('/'), message: 'use lib/ for helpers' }]
    : [];
}

/** `export const useFooStore = defineStore('foo'` / `createFooStore` factories. */
export function piniaHits(path: string, source: string): Hit[] {
  const hits: Hit[] = [];
  for (const m of source.matchAll(/defineStore\(\s*'([^']*)'/g)) {
    const before = source.slice(0, m.index);
    const exp = [...before.matchAll(/export (?:const|function) (?:use|create)(\w+)/g)].at(-1);
    if (!exp) continue;
    const stem = (exp[1] ?? '').replace(/Store$/, '');
    const want = stem.charAt(0).toLowerCase() + stem.slice(1);
    if (m[1] !== want) {
      hits.push({
        rule: 'N4',
        path,
        message: `Pinia id '${m[1]}' should be '${want}'`,
      });
    }
  }
  return hits;
}

export function eventHits(path: string, source: string, literal: RegExp): Hit[] {
  const names = new Set([...source.matchAll(literal)].map((m) => m[1] ?? ''));
  const bad = [...names].filter((n) => !EVENT_NAME.test(n));
  return bad.length === 0
    ? []
    : [
        {
          rule: 'N5',
          path,
          message: `event names not kira:<scope>:<name> camelCase: ${bad.join(', ')}`,
        },
      ];
}

function codesOf(text: string): Set<string> {
  return new Set([...text.matchAll(/"?'?(E_[A-Z_]+)"?'?/g)].map((m) => m[1] ?? ''));
}

/** Go constants == TS `ERROR_CODES`; Go `Legacy` keys == TS `LEGACY_ERROR_CODES`. */
export function codeParityHits(goSource: string, tsSource: string): Hit[] {
  const goActive = new Set(
    [...goSource.matchAll(/\bCode\s*=\s*"(E_[A-Z_]+)"/g)].map((m) => m[1] ?? ''),
  );
  const legacyBlock = goSource.match(/var Legacy = map\[Code\]Code\{([\s\S]*?)\n\}/)?.[1] ?? '';
  const goLegacy = new Set([...legacyBlock.matchAll(/"(E_[A-Z_]+)":/g)].map((m) => m[1] ?? ''));
  const tsArray = (name: string): Set<string> =>
    codesOf(
      tsSource.match(new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const`))?.[1] ?? '',
    );
  const diff = (label: string, go: Set<string>, ts: Set<string>): Hit[] => {
    const onlyGo = [...go].filter((c) => !ts.has(c)).sort();
    const onlyTs = [...ts].filter((c) => !go.has(c)).sort();
    const parts = [
      onlyGo.length > 0 ? `only in Go: ${onlyGo.join(', ')}` : '',
      onlyTs.length > 0 ? `only in TS: ${onlyTs.join(', ')}` : '',
    ].filter(Boolean);
    return parts.length === 0
      ? []
      : [{ rule: 'N6', path: TS_CODES_PATH, message: `${label} differ (${parts.join('; ')})` }];
  };
  return [
    ...diff('error codes', goActive, tsArray('ERROR_CODES')),
    ...diff('legacy error codes', goLegacy, tsArray('LEGACY_ERROR_CODES')),
  ];
}

export function migrationHits(
  dir: string,
  baseline: number,
  files: ReadonlyMap<string, string>,
): Hit[] {
  const hits: Hit[] = [];
  for (const [name, sql] of files) {
    const num = Number.parseInt(name.slice(0, 4), 10);
    if (!(num > baseline)) continue;
    const path = `${dir}/${name}`;
    if (!MIGRATION_NAME.test(name)) {
      hits.push({
        rule: 'N7',
        path,
        message: 'name must be NNNN_<phase>_<slug>.sql',
      });
    }
    if (/\b\w+_at\s+TEXT\b/i.test(sql)) {
      hits.push({
        rule: 'N7',
        path,
        message: 'TEXT *_at column (store an integer instant)',
      });
    }
  }
  return hits;
}

/** Splits pending lines of the given rule ids into a set of `rule path` keys. */
export function parsePending(lines: readonly string[]): Set<string> {
  const keys = new Set<string>();
  for (const raw of lines) {
    const entry = raw.replace(/\s*#.*$/, '').trim();
    if (/^N[1-9] \S/.test(entry)) keys.add(entry);
  }
  return keys;
}

export function applyPending(
  hits: readonly Hit[],
  pending: ReadonlySet<string>,
): { remaining: Hit[]; stale: string[] } {
  const keys = new Set(hits.map((h) => `${h.rule} ${h.path}`));
  return {
    remaining: hits.filter((h) => !pending.has(`${h.rule} ${h.path}`)),
    stale: [...pending].filter((k) => !keys.has(k)).sort(),
  };
}

function walk(root: string): string[] {
  const out: string[] = [];
  const base = join(REPO_ROOT, root);
  if (!existsSync(base)) return out;
  for (const rel of readdirSync(base, { recursive: true, encoding: 'utf8' })) {
    if (rel.split('/').some((seg) => SKIP_DIR.has(seg))) continue;
    out.push(`${root}/${rel}`);
  }
  return out.sort();
}

function collectHits(): Hit[] {
  const hits: Hit[] = [];
  const dirs = new Set<string>();
  for (const root of SOURCE_ROOTS) {
    for (const path of walk(root)) {
      if (!/\.(?:vue|ts)$/.test(path)) continue;
      const nameHit = fileNameHit(path);
      if (nameHit) hits.push(nameHit);
      const suffixHit = testSuffixHit(path);
      if (suffixHit) hits.push(suffixHit);
      for (const h of folderHits(path)) dirs.add(JSON.stringify(h));
      if (path.endsWith('.ts') && !/\.(?:spec|test)\.ts$/.test(path)) {
        hits.push(...piniaHits(path, readFileSync(join(REPO_ROOT, path), 'utf8')));
      }
    }
  }
  for (const d of dirs) hits.push(JSON.parse(d) as Hit);
  for (const { path, literal } of EVENT_FILES) {
    hits.push(...eventHits(path, readFileSync(join(REPO_ROOT, path), 'utf8'), literal));
  }
  hits.push(
    ...codeParityHits(
      readFileSync(join(REPO_ROOT, GO_CODES_PATH), 'utf8'),
      readFileSync(join(REPO_ROOT, TS_CODES_PATH), 'utf8'),
    ),
  );
  for (const { dir, baseline } of MIGRATION_SETS) {
    const files = new Map<string, string>();
    for (const name of readdirSync(join(REPO_ROOT, dir)).filter((n) => n.endsWith('.sql'))) {
      files.set(name, readFileSync(join(REPO_ROOT, dir, name), 'utf8'));
    }
    hits.push(...migrationHits(dir, baseline, files));
  }
  return hits;
}

function main(): number {
  const lines: string[] = [];
  if (existsSync(ALLOW_DIR)) {
    for (const f of readdirSync(ALLOW_DIR).filter((n) => n.endsWith('.txt'))) {
      lines.push(...readFileSync(join(ALLOW_DIR, f), 'utf8').split('\n'));
    }
  }
  const { remaining, stale } = applyPending(collectHits(), parsePending(lines));
  for (const h of remaining) console.error(`check-conventions: ${h.path}: ${h.rule} ${h.message}`);
  for (const k of stale)
    console.error(`check-conventions: stale pending entry (no hit left): ${k}`);
  if (remaining.length > 0 || stale.length > 0) {
    console.error(
      `check-conventions: ${remaining.length} hit(s), ${stale.length} stale entr(y/ies); see docs/v2.2/plans/P266-consistency-audit.md section 2.10`,
    );
    return 1;
  }
  console.log('check-conventions: every convention holds (N1-N7).');
  return 0;
}

if (import.meta.main) process.exit(main());
