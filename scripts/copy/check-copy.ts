#!/usr/bin/env bun
/**
 * P265 F3: source text guard U64-U71. Flags literal user-visible text and misuse of the catalog
 * runtime in `.vue` and `.ts` sources (rules in sourceRules.ts). Exemptions come from
 * `scripts/copy-allowlist/*.txt` (allowlist.ts). `--failing-files` lists every file still owed a
 * migration (hits not covered by a `permanent` line), one per line, for splitting allowlists.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type AllowEntry, applyAllowlist, failingFiles, parseAllowlist } from './allowlist';
import { flattenCatalog, isPlural, placeholdersOf } from './catalogRules';
import { type Hit, type MessageShape, scanSource } from './sourceRules';

const REPO_ROOT = join(import.meta.dir, '..', '..');
const SCAN_DIRS = [
  'apps/kira-studio/frontend/src',
  'apps/kira-space/frontend/src',
  'apps/kira-space/frontend/mobile',
  'packages/workbench/src',
  'packages/git-ui/src',
  'packages/docker-ui/src',
  'packages/kira-ui/src',
  'packages/theme/src',
  'packages/shared',
];
const SKIP_PATH =
  /(?:^|\/)(?:node_modules|dist|testing|tests?|__tests__)\/|^packages\/theme\/src\/i18n\/|^packages\/shared\/protocol\/wire(?:\/|\.ts$)|\.(?:spec|test)\.ts$|\.d\.ts$/;
const ALLOWLIST_DIR = join(REPO_ROOT, 'scripts/copy-allowlist');
const CATALOG = join(REPO_ROOT, 'packages/theme/src/i18n/en.json');
const MAX_PRINTED = 300;

function listSources(): string[] {
  const out: string[] = [];
  for (const dir of SCAN_DIRS) {
    const base = join(REPO_ROOT, dir);
    if (!existsSync(base)) continue;
    for (const rel of readdirSync(base, { recursive: true, encoding: 'utf8' })) {
      const path = `${dir}/${rel}`;
      if (/\.(?:vue|ts)$/.test(rel) && !SKIP_PATH.test(path)) out.push(path);
    }
  }
  return out.sort();
}

function loadMessages(): Map<string, MessageShape> {
  const shapes = new Map<string, MessageShape>();
  if (!existsSync(CATALOG)) return shapes;
  const { catalog } = flattenCatalog(JSON.parse(readFileSync(CATALOG, 'utf8')));
  for (const [key, value] of catalog) {
    shapes.set(key, { placeholders: placeholdersOf(value), plural: isPlural(value) });
  }
  return shapes;
}

function loadAllowlists(): { entries: AllowEntry[]; errors: string[] } {
  const entries: AllowEntry[] = [];
  const errors: string[] = [];
  if (!existsSync(ALLOWLIST_DIR)) return { entries, errors };
  for (const name of readdirSync(ALLOWLIST_DIR)
    .filter((f) => f.endsWith('.txt'))
    .sort()) {
    const parsed = parseAllowlist(
      readFileSync(join(ALLOWLIST_DIR, name), 'utf8'),
      `scripts/copy-allowlist/${name}`,
    );
    entries.push(...parsed.entries);
    errors.push(...parsed.errors);
  }
  return { entries, errors };
}

function main(): number {
  const messages = loadMessages();
  const hits: Hit[] = [];
  for (const file of listSources()) {
    hits.push(...scanSource(file, readFileSync(join(REPO_ROOT, file), 'utf8'), { messages }));
  }
  const { entries, errors } = loadAllowlists();
  if (process.argv.includes('--failing-files')) {
    for (const f of failingFiles(hits, entries)) console.log(f);
    return 0;
  }
  const applied = applyAllowlist(hits, entries);
  errors.push(...applied.errors);
  const remaining = applied.remaining;
  const limit = process.argv.includes('--all') ? remaining.length : MAX_PRINTED;
  for (const h of remaining.slice(0, limit)) {
    console.error(`check-copy: ${h.file}:${h.line}: ${h.rule} ${h.message}`);
  }
  if (remaining.length > MAX_PRINTED)
    console.error(`check-copy: ...and ${remaining.length - MAX_PRINTED} more`);
  for (const e of errors) console.error(`check-copy: ${e}`);
  if (remaining.length > 0 || errors.length > 0) {
    const files = new Set(remaining.map((h) => h.file)).size;
    console.error(
      `check-copy: ${remaining.length} hit(s) in ${files} file(s), ${errors.length} allowlist error(s)`,
    );
    return 1;
  }
  return 0;
}

process.exit(main());
