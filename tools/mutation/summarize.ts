// Normalises gremlins (Go) and StrykerJS (TS) reports of one run dir into summary.json + summary.md.
// Usage: bun tools/mutation/summarize.ts <run-dir>   (P151, report-only)
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

type Lang = 'go' | 'ts';
type Counts = {
  killed: number;
  survived: number;
  timeout: number;
  noCoverage: number;
  invalid: number;
  ignored: number;
};
type Unit = {
  lang: Lang;
  unit: string;
  status: 'ok' | 'red' | 'skipped';
  reason?: string;
  tags: string[];
  counts: Counts;
  score: number | null;
  coveredScore: number | null;
  durationSec: number;
};
type FileRow = { lang: Lang; unit: string; file: string; counts: Counts; score: number | null };

const GREMLINS: Record<string, keyof Counts> = {
  KILLED: 'killed',
  LIVED: 'survived',
  'TIMED OUT': 'timeout',
  'NOT COVERED': 'noCoverage',
  'NOT VIABLE': 'invalid',
  SKIPPED: 'ignored',
};
const STRYKER: Record<string, keyof Counts> = {
  Killed: 'killed',
  Survived: 'survived',
  Timeout: 'timeout',
  NoCoverage: 'noCoverage',
  CompileError: 'invalid',
  RuntimeError: 'invalid',
  Ignored: 'ignored',
};

const empty = (): Counts => ({
  killed: 0,
  survived: 0,
  timeout: 0,
  noCoverage: 0,
  invalid: 0,
  ignored: 0,
});
const add = (a: Counts, b: Counts): Counts => ({
  killed: a.killed + b.killed,
  survived: a.survived + b.survived,
  timeout: a.timeout + b.timeout,
  noCoverage: a.noCoverage + b.noCoverage,
  invalid: a.invalid + b.invalid,
  ignored: a.ignored + b.ignored,
});
const total = (c: Counts) =>
  c.killed + c.survived + c.timeout + c.noCoverage + c.invalid + c.ignored;
// Stryker's convention, applied to both languages so the numbers compare.
const score = (c: Counts) => {
  const d = c.killed + c.timeout + c.survived + c.noCoverage;
  return d === 0 ? null : (c.killed + c.timeout) / d;
};
const coveredScore = (c: Counts) => {
  const d = c.killed + c.timeout + c.survived;
  return d === 0 ? null : (c.killed + c.timeout) / d;
};
const pct = (v: number | null) => (v === null ? 'n/a' : `${(v * 100).toFixed(1)}%`);
const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;

const runDir = resolve(process.argv[2] ?? '');
if (!process.argv[2] || !existsSync(join(runDir, 'meta.json'))) {
  console.error('usage: bun tools/mutation/summarize.ts <run-dir>');
  process.exit(2);
}
const toolsDir = dirname(new URL(import.meta.url).pathname);
const meta = readJson<{
  commit: string;
  nproc: number;
  segments: { mode: string; start: string; seconds: number; workers: number }[];
}>(join(runDir, 'meta.json'));

const units: Unit[] = [];
const files: FileRow[] = [];

type GoInfo = {
  pkg: string;
  status: 'ok' | 'red';
  reason: string;
  durationSec: number;
  darwinFiles: string[];
};
type GremlinsReport = { files: { file_name: string; mutations: { status: string }[] }[] };

const goDir = join(runDir, 'go');
if (existsSync(goDir)) {
  for (const f of readdirSync(goDir)
    .filter((n) => n.endsWith('.info.json'))
    .sort()) {
    const info = readJson<GoInfo>(join(goDir, f));
    const reportPath = join(goDir, f.replace('.info.json', '.json'));
    const counts = empty();
    if (existsSync(reportPath)) {
      for (const file of readJson<GremlinsReport>(reportPath).files ?? []) {
        const fc = empty();
        for (const m of file.mutations ?? []) {
          const key = GREMLINS[m.status];
          if (key) fc[key]++;
        }
        files.push({
          lang: 'go',
          unit: info.pkg,
          file: file.file_name,
          counts: fc,
          score: score(fc),
        });
        Object.assign(counts, add(counts, fc));
      }
    }
    const tags: string[] = [];
    const n = total(counts);
    if (info.pkg.includes('/adapters/') && n > 0 && counts.noCoverage / n > 0.5) {
      tags.push('container-gated');
    }
    if (info.darwinFiles.length > 0) tags.push(`darwin-only:${info.darwinFiles.length}`);
    units.push({
      lang: 'go',
      unit: info.pkg,
      status: info.status,
      reason: info.reason || undefined,
      tags,
      counts,
      score: score(counts),
      coveredScore: coveredScore(counts),
      durationSec: info.durationSec,
    });
  }
}

type TsInfo = {
  area: string;
  status: 'ok' | 'red' | 'skipped';
  reason: string;
  durationSec: number;
};
type StrykerReport = { files: Record<string, { mutants: { status: string }[] }> };

const tsDir = join(runDir, 'ts');
if (existsSync(tsDir)) {
  for (const f of readdirSync(tsDir)
    .filter((n) => n.endsWith('.info.json'))
    .sort()) {
    const info = readJson<TsInfo>(join(tsDir, f));
    const reportPath = join(tsDir, f.replace('.info.json', '.json'));
    const counts = empty();
    if (existsSync(reportPath)) {
      for (const [file, body] of Object.entries(readJson<StrykerReport>(reportPath).files)) {
        const fc = empty();
        for (const m of body.mutants) {
          const key = STRYKER[m.status];
          if (key) fc[key]++;
        }
        files.push({ lang: 'ts', unit: info.area, file, counts: fc, score: score(fc) });
        Object.assign(counts, add(counts, fc));
      }
    }
    units.push({
      lang: 'ts',
      unit: info.area,
      status: info.status,
      reason: info.reason || undefined,
      tags: [],
      counts,
      score: score(counts),
      coveredScore: coveredScore(counts),
      durationSec: info.durationSec,
    });
  }
}

const sumLang = (lang: Lang) => {
  const c = units.filter((u) => u.lang === lang).reduce((a, u) => add(a, u.counts), empty());
  return { counts: c, mutants: total(c), score: score(c), coveredScore: coveredScore(c) };
};
const versionOf = (p: string) => {
  try {
    return readJson<{ version: string }>(join(toolsDir, 'node_modules', p, 'package.json')).version;
  } catch {
    return 'unknown';
  }
};
let gremlins = 'unknown';
try {
  gremlins = readFileSync(join(toolsDir, 'bin', 'gremlins.stamp'), 'utf8').trim();
} catch {}

const summary = {
  commit: meta.commit,
  generatedAt: new Date().toISOString(),
  tools: {
    gremlins,
    stryker: versionOf('@stryker-mutator/core'),
    runner: versionOf('@hughescr/stryker-bun-runner'),
  },
  totals: { go: sumLang('go'), ts: sumLang('ts') },
  units,
};
writeFileSync(join(runDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);

const dur = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0
    ? `${h}h${String(m).padStart(2, '0')}m`
    : `${m}m${String(Math.round(s % 60)).padStart(2, '0')}s`;
};
const row = (cells: (string | number)[]) => `| ${cells.join(' | ')} |`;
const header = (cols: string[]) => [row(cols), row(cols.map(() => '---'))];
const unitRow = (u: Unit) =>
  row([
    `\`${u.unit}\``,
    total(u.counts),
    u.counts.killed,
    u.counts.survived,
    u.counts.timeout,
    u.counts.noCoverage,
    u.counts.invalid,
    u.counts.ignored,
    pct(u.score),
    pct(u.coveredScore),
    dur(u.durationSec),
  ]);
const COLS = [
  'unit',
  'mutants',
  'killed',
  'survived',
  'timeout',
  'no cov.',
  'invalid',
  'ignored',
  'score',
  'covered score',
  'time',
];

const md: string[] = [];
md.push(
  '## Totals',
  '',
  ...header([
    'lang',
    'mutants',
    'killed',
    'survived',
    'timeout',
    'no cov.',
    'invalid',
    'ignored',
    'score',
    'covered score',
  ]),
);
for (const lang of ['go', 'ts'] as const) {
  const t = sumLang(lang);
  if (t.mutants === 0) continue;
  md.push(
    row([
      lang,
      t.mutants,
      t.counts.killed,
      t.counts.survived,
      t.counts.timeout,
      t.counts.noCoverage,
      t.counts.invalid,
      t.counts.ignored,
      pct(t.score),
      pct(t.coveredScore),
    ]),
  );
}
md.push(
  '',
  'score = (killed + timeout) / (killed + timeout + survived + no coverage). covered score drops no coverage.',
);

const tsUnits = units.filter((u) => u.lang === 'ts' && u.status === 'ok');
if (tsUnits.length > 0) {
  md.push('', '## TS areas', '', ...header(COLS), ...tsUnits.map(unitRow));
}
const goUnits = units.filter((u) => u.lang === 'go' && u.status === 'ok');
if (goUnits.length > 0) {
  md.push('', '## Go packages', '', ...header(COLS), ...goUnits.map(unitRow));
}

const worst = (list: Unit[]) =>
  list
    .filter((u) => total(u.counts) >= 20 && u.score !== null)
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
    .slice(0, 15);
const worstUnits = worst(units.filter((u) => u.status === 'ok'));
if (worstUnits.length > 0) {
  md.push(
    '',
    '## Worst 15 units by score (>= 20 mutants)',
    '',
    ...header(COLS),
    ...worstUnits.map(unitRow),
  );
}
const worstFiles = files
  .filter((f) => total(f.counts) >= 20 && f.score !== null)
  .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
  .slice(0, 15);
if (worstFiles.length > 0) {
  md.push(
    '',
    '## Worst 15 files by score (>= 20 mutants)',
    '',
    ...header(['file', 'mutants', 'survived', 'no cov.', 'score']),
    ...worstFiles.map((f) =>
      row([
        `\`${f.lang === 'ts' ? f.file : `${f.unit}/${f.file}`}\``,
        total(f.counts),
        f.counts.survived,
        f.counts.noCoverage,
        pct(f.score),
      ]),
    ),
  );
}

const notOk = units.filter((u) => u.status !== 'ok');
if (notOk.length > 0) {
  md.push(
    '',
    '## Red / skipped units',
    '',
    ...header(['unit', 'status', 'reason']),
    ...notOk.map((u) =>
      row([`\`${u.lang}:${u.unit}\``, u.status, (u.reason ?? '').replace(/\|/g, '\\|')]),
    ),
  );
}

const gated = units.filter((u) => u.tags.includes('container-gated'));
const darwin = units.filter((u) => u.tags.some((t) => t.startsWith('darwin-only')));
md.push('', '## Notes', '');
md.push(
  `- container-gated Go packages (not covered share > 50%): ${gated.length}, ${gated.reduce((a, u) => a + u.counts.noCoverage, 0)} not-covered mutants`,
);
md.push(`- Go packages with darwin-only files not mutated: ${darwin.length}`);
md.push('- TS without a unit suite, not run: packages/theme, packages/kira-ui');
md.push('', '## Run', '', `- commit ${meta.commit}, ${meta.nproc} cores`);
for (const s of meta.segments)
  md.push(`- segment ${s.mode} ${s.start}: ${dur(s.seconds)}, ${s.workers} workers`);
md.push(
  `- tools: ${gremlins}; stryker ${summary.tools.stryker}; bun runner ${summary.tools.runner}`,
);
writeFileSync(join(runDir, 'summary.md'), `${md.join('\n')}\n`);
console.log(`mutation: summary written to ${join(runDir, 'summary.md')}`);
