#!/usr/bin/env bun
/**
 * Duplication candidates from CodeGraph's SQLite index. Recreates P107/P113's ad-hoc sweeps
 * (docs/v1.9/plans/P107-duplication-findings*.md §0, P113 §0) as a runnable script. Read-only.
 * Usage and caveats: docs/DEV_ENVIRONMENT.md, "CodeGraph duplicate finder".
 *
 * Sweeps (function/method nodes only; source read from disk by file + line span):
 *   exact  - identical body after stripping comments and whitespace.
 *   blind  - identical body after also collapsing identifiers and literals.
 *   name   - same symbol name in >=2 files, same language, line-set similarity >= --similarity.
 *   calls  - ordered `calls` edge list, LCS/max >= --lcs with >= --min-callees callees.
 * Every hit is a candidate to read, never a verdict.
 */
import { Database } from 'bun:sqlite';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const HELP = `codegraph-duplicates.ts - duplication candidates from .codegraph/codegraph.db (read-only)

  bun scripts/codegraph-duplicates.ts [options]

  --db <path>         index (env CODEGRAPH_DB; default <root>/.codegraph/codegraph.db, else main checkout's)
  --root <dir>        source root the index paths are relative to (default: repo root)
  --path <substr>     keep groups with a member whose file path contains substr (repeatable)
  --lang <name>       go | typescript | vue | ... (default: all)
  --min-lines <n>     smallest body, in lines (default 6)
  --sweep <list>      comma list of exact,blind,name,calls (default: all)
  --similarity <r>    name sweep line-set ratio (default 0.6)
  --lcs <r>           calls sweep LCS ratio (default 0.7)
  --min-callees <n>   calls sweep minimum callees (default 6)
  --include-tests     keep _test.go / *.test.ts / *.spec.ts (default: dropped)
  --include-generated keep files the index flags generated (default: dropped)
  --top <n>           groups per sweep (default 20)
  --json              JSON instead of text
  -h, --help
`;

const { values: o } = parseArgs({
  options: {
    db: { type: 'string' },
    root: { type: 'string' },
    path: { type: 'string', multiple: true },
    lang: { type: 'string' },
    'min-lines': { type: 'string', default: '6' },
    sweep: { type: 'string', default: 'exact,blind,name,calls' },
    similarity: { type: 'string', default: '0.6' },
    lcs: { type: 'string', default: '0.7' },
    'min-callees': { type: 'string', default: '6' },
    'include-tests': { type: 'boolean', default: false },
    'include-generated': { type: 'boolean', default: false },
    top: { type: 'string', default: '20' },
    json: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});
if (o.help) {
  console.log(HELP);
  process.exit(0);
}

const root = resolve(o.root ?? join(dirname(new URL(import.meta.url).pathname), '..'));

// Linked worktrees often lack their own index; fall back to the main checkout's.
function mainCheckoutDb(): string | undefined {
  try {
    const out = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: root,
      encoding: 'utf8',
    });
    const main = out
      .split('\n')
      .find((l) => l.startsWith('worktree '))
      ?.slice(9);
    return main ? join(main, '.codegraph', 'codegraph.db') : undefined;
  } catch {
    return undefined;
  }
}

let dbPath = resolve(o.db ?? process.env.CODEGRAPH_DB ?? join(root, '.codegraph', 'codegraph.db'));
if (!o.db && !process.env.CODEGRAPH_DB && !existsSync(dbPath)) {
  const fallback = mainCheckoutDb();
  if (fallback && existsSync(fallback)) {
    console.error(`codegraph-duplicates: no index in worktree, using ${fallback}`);
    dbPath = fallback;
  }
}
if (!existsSync(dbPath)) {
  console.error(
    `codegraph-duplicates: no index at ${dbPath}\n` +
      '  build it: scripts/codegraph-setup.sh (needs the codegraph CLI), or pass --db / CODEGRAPH_DB.',
  );
  process.exit(0);
}

const minLines = Number(o['min-lines']);
const top = Number(o.top);
const simMin = Number(o.similarity);
const lcsMin = Number(o.lcs);
const minCallees = Number(o['min-callees']);
const sweeps = new Set(o.sweep!.split(','));
const pathFilters = o.path ?? [];
const TEST_RE = /(_test\.go|\.test\.[jt]sx?|\.spec\.[jt]sx?)$/;

type Fn = {
  id: string;
  name: string;
  file: string;
  lang: string;
  start: number;
  end: number;
  lines: number;
  norm: string[]; // comment/blank-stripped lines
};

let db: Database;
try {
  db = new Database(dbPath, { readonly: true });
  db.query('select 1 from nodes limit 1').get();
} catch (e) {
  console.error(`codegraph-duplicates: cannot read ${dbPath}: ${(e as Error).message}`);
  process.exit(0);
}

const fileCache = new Map<string, string[] | null>();
function fileLines(rel: string): string[] | null {
  if (!fileCache.has(rel)) {
    const p = join(root, rel);
    fileCache.set(rel, existsSync(p) ? readFileSync(p, 'utf8').split('\n') : null);
  }
  return fileCache.get(rel)!;
}

function stripComments(src: string): string[] {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, '');
  return noBlock
    .split('\n')
    .map((l) => l.replace(/(^|\s)\/\/.*$/, '').trim())
    .filter((l) => l.length > 0);
}

const rows = db
  .query(
    `select n.id, n.name, n.file_path, n.language, n.start_line, n.end_line
       from nodes n join files f on f.path = n.file_path
      where n.kind in ('function','method')
        and (n.end_line - n.start_line + 1) >= ?1
        and (?2 or f.generated = 0)
        and (?3 is null or n.language = ?3)`,
  )
  .all(minLines, o['include-generated'] ? 1 : 0, o.lang ?? null) as {
  id: string;
  name: string;
  file_path: string;
  language: string;
  start_line: number;
  end_line: number;
}[];

const fns: Fn[] = [];
let missing = 0;
for (const r of rows) {
  if (!o['include-tests'] && TEST_RE.test(r.file_path)) continue;
  const lines = fileLines(r.file_path);
  if (!lines) {
    missing++;
    continue;
  }
  const norm = stripComments(lines.slice(r.start_line - 1, r.end_line).join('\n'));
  if (norm.length < 2) continue;
  fns.push({
    id: r.id,
    name: r.name,
    file: r.file_path,
    lang: r.language,
    start: r.start_line,
    end: r.end_line,
    lines: r.end_line - r.start_line + 1,
    norm,
  });
}

const KEYWORDS = new Set(
  (
    'break case chan const continue default defer else fallthrough for func go goto if import interface map ' +
    'package range return select struct switch type var nil true false err ' +
    'abstract as async await catch class delete do enum export extends finally from function in instanceof ' +
    'let new null of readonly static super this throw try typeof undefined void while yield string number boolean'
  ).split(' '),
);
const blindLine = (l: string) =>
  l
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`/g, 'S')
    .replace(/\b\d[\w.]*\b/g, 'N')
    .replace(/[A-Za-z_$][\w$]*/g, (w) => (KEYWORDS.has(w) ? w : '_'));

const hash = (s: string) => createHash('sha1').update(s).digest('hex');
const keepGroup = (g: Fn[]) =>
  pathFilters.length === 0 || g.some((f) => pathFilters.some((p) => f.file.includes(p)));
const loc = (f: Fn) => `${f.file}:${f.start}-${f.end}`;

type Group = {
  sweep: string;
  score: number;
  lines: number;
  members: { name: string; loc: string }[];
};
const out: Group[] = [];
const push = (sweep: string, score: number, g: Fn[]) =>
  out.push({
    sweep,
    score: Math.round(score * 100) / 100,
    lines: Math.max(...g.map((f) => f.lines)),
    members: g.map((f) => ({ name: f.name, loc: loc(f) })),
  });
const rank = (a: Group, b: Group) => b.members.length * b.lines - a.members.length * a.lines;

function hashSweep(sweep: 'exact' | 'blind') {
  const by = new Map<string, Fn[]>();
  for (const f of fns) {
    const key = hash((sweep === 'exact' ? f.norm : f.norm.map(blindLine)).join('\n'));
    (by.get(key) ?? by.set(key, []).get(key)!).push(f);
  }
  const groups = [...by.values()].filter(
    (g) => new Set(g.map((f) => f.file)).size > 1 && keepGroup(g),
  );
  // blind groups that are already exact groups add nothing
  const exactKeys = sweep === 'blind' ? exactGroupKeys() : new Set<string>();
  for (const g of groups) {
    if (
      sweep === 'blind' &&
      exactKeys.has(
        g
          .map((f) => f.id)
          .sort()
          .join(),
      )
    )
      continue;
    push(sweep, 1, g);
  }
}
function exactGroupKeys(): Set<string> {
  const by = new Map<string, Fn[]>();
  for (const f of fns)
    (
      by.get(hash(f.norm.join('\n'))) ??
      by.set(hash(f.norm.join('\n')), []).get(hash(f.norm.join('\n')))!
    ).push(f);
  return new Set(
    [...by.values()]
      .filter((g) => g.length > 1)
      .map((g) =>
        g
          .map((f) => f.id)
          .sort()
          .join(),
      ),
  );
}

function lcs<T>(a: T[], b: T[]): number {
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++)
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    prev = cur;
  }
  return prev[b.length];
}

function nameSweep() {
  const by = new Map<string, Fn[]>();
  for (const f of fns) {
    const k = `${f.lang}\0${f.name}`;
    (by.get(k) ?? by.set(k, []).get(k)!).push(f);
  }
  for (const g of by.values()) {
    if (g.length < 2 || g.length > 30) continue; // New/Close/render-style names are noise
    for (let i = 0; i < g.length; i++)
      for (let j = i + 1; j < g.length; j++) {
        const [a, b] = [g[i], g[j]];
        if (a.file === b.file || !keepGroup([a, b])) continue;
        const bs = new Set(b.norm);
        const shared = a.norm.filter((l) => bs.has(l)).length;
        const ratio = shared / Math.max(a.norm.length, b.norm.length);
        if (ratio >= simMin) push('name', ratio, [a, b]);
      }
  }
}

function push1<K, V>(m: Map<K, V[]>, k: K, v: V) {
  const cur = m.get(k);
  if (cur) cur.push(v);
  else m.set(k, [v]);
}

function loadCallees(): Map<string, string[]> {
  const callees = new Map<string, string[]>();
  const ids = new Set(fns.map((f) => f.id));
  const q = db.query(
    "select source, target from edges where kind = 'calls' order by source, line, col",
  );
  for (const e of q.all() as { source: string; target: string }[])
    if (ids.has(e.source)) push1(callees, e.source, e.target);
  for (const [id, cs] of callees) if (cs.length < minCallees) callees.delete(id);
  return callees;
}

function candidatePeers(id: string, cs: string[], inv: Map<string, string[]>): [string, number][] {
  const cand = new Map<string, number>();
  for (const c of new Set(cs)) {
    const callers = inv.get(c) ?? [];
    if (callers.length > 300) continue; // ubiquitous callee, no signal
    for (const other of callers) if (other > id) cand.set(other, (cand.get(other) ?? 0) + 1);
  }
  return [...cand].filter(([, n]) => n >= minCallees * lcsMin * 0.9);
}

function callsSweep() {
  const callees = loadCallees();
  const byId = new Map(fns.map((f) => [f.id, f]));
  const inv = new Map<string, string[]>();
  for (const [id, cs] of callees) for (const c of new Set(cs)) push1(inv, c, id);
  for (const [id, cs] of callees) {
    const a = byId.get(id);
    if (!a) continue;
    for (const [otherId] of candidatePeers(id, cs, inv)) {
      const b = byId.get(otherId);
      const other = callees.get(otherId);
      if (!b || !other || a.file === b.file || !keepGroup([a, b])) continue;
      const ratio = lcs(cs, other) / Math.max(cs.length, other.length);
      if (ratio >= lcsMin) push('calls', ratio, [a, b]);
    }
  }
}

if (sweeps.has('exact')) hashSweep('exact');
if (sweeps.has('blind')) hashSweep('blind');
if (sweeps.has('name')) nameSweep();
if (sweeps.has('calls')) callsSweep();

const result = [...sweeps].flatMap((s) =>
  out
    .filter((g) => g.sweep === s)
    .sort(rank)
    .slice(0, top),
);
if (o.json) {
  console.log(JSON.stringify({ db: dbPath, root, functions: fns.length, groups: result }, null, 2));
} else {
  console.log(
    `# ${fns.length} functions/methods scanned (${missing} skipped: source file missing under ${root})`,
  );
  for (const s of sweeps) {
    const gs = result.filter((g) => g.sweep === s);
    console.log(`\n## ${s}: ${out.filter((g) => g.sweep === s).length} groups, top ${gs.length}`);
    for (const g of gs)
      console.log(
        `${g.sweep === 'name' || g.sweep === 'calls' ? `${g.score} ` : ''}${g.lines}L x${g.members.length} ${g.members[0].name}\n${g.members.map((m) => `    ${m.loc}`).join('\n')}`,
      );
  }
}
