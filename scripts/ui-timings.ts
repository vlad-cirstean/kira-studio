#!/usr/bin/env bun
// Markdown timing report from Playwright `--reporter=json` files.
// Usage: bun scripts/ui-timings.ts <label> <report.json>... > out.md
import { readFileSync } from 'node:fs';

interface Result {
  status: string;
  duration: number;
  startTime: string;
  retry: number;
}
interface Spec {
  title: string;
  file: string;
  line: number;
  tests: { projectName: string; results: Result[] }[];
}
interface Suite {
  specs?: Spec[];
  suites?: Suite[];
}
interface Report {
  suites: Suite[];
  stats?: { duration?: number };
}
interface Row {
  project: string;
  file: string;
  line: number;
  title: string;
  duration: number;
  status: string;
  start: number;
  end: number;
}

const TOP = 30;

function collect(suite: Suite, rows: Row[]): void {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests) {
      for (const r of test.results) {
        const start = Date.parse(r.startTime);
        rows.push({
          project: test.projectName,
          file: spec.file,
          line: spec.line,
          title: spec.title,
          duration: r.duration,
          status: r.status,
          start,
          end: start + r.duration,
        });
      }
    }
  }
  for (const child of suite.suites ?? []) collect(child, rows);
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
const sec = (ms: number): string => (ms / 1000).toFixed(1);
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const esc = (s: string): string => s.replace(/\|/g, '\\|');

const [label, ...files] = process.argv.slice(2);
if (!label || files.length === 0) {
  console.error('usage: ui-timings.ts <label> <report.json>...');
  process.exit(2);
}

const rows: Row[] = [];
let statsMs = 0;
for (const f of files) {
  const report = JSON.parse(readFileSync(f, 'utf8')) as Report;
  for (const s of report.suites) collect(s, rows);
  statsMs += report.stats?.duration ?? 0;
}

const out: string[] = [
  `### ${label}`,
  '',
  `Playwright wall time (stats.duration): ${sec(statsMs)} s`,
  '',
];
const projects = [...new Set(rows.map((r) => r.project))];

out.push(
  '| project | tests | passed | failed | timed out | skipped | sum s | wall s | parallelism | median s | min s |',
  '|---|---|---|---|---|---|---|---|---|---|---|',
);
for (const p of projects) {
  const rs = rows.filter((r) => r.project === p);
  const d = rs.map((r) => r.duration);
  const wall = Math.max(...rs.map((r) => r.end)) - Math.min(...rs.map((r) => r.start));
  const n = (st: string): number => rs.filter((r) => r.status === st).length;
  const failed = rs.filter((r) => r.status === 'failed' || r.status === 'interrupted').length;
  out.push(
    `| ${p} | ${rs.length} | ${n('passed')} | ${failed} | ${n('timedOut')} | ${n('skipped')} | ${sec(sum(d))} | ${sec(wall)} | ${(sum(d) / wall).toFixed(2)} | ${sec(median(d))} | ${sec(Math.min(...d))} |`,
  );
}
out.push('');

for (const p of projects) {
  const rs = rows.filter((r) => r.project === p);
  const byFile = new Map<string, { n: number; ms: number }>();
  for (const r of rs) {
    const e = byFile.get(r.file) ?? { n: 0, ms: 0 };
    e.n++;
    e.ms += r.duration;
    byFile.set(r.file, e);
  }
  const total = sum(rs.map((r) => r.duration));
  out.push(
    `#### ${p}: slowest ${TOP} files`,
    '',
    '| file | tests | sum s | % of project sum |',
    '|---|---|---|---|',
  );
  for (const [file, e] of [...byFile].sort((a, b) => b[1].ms - a[1].ms).slice(0, TOP)) {
    out.push(`| ${file} | ${e.n} | ${sec(e.ms)} | ${((100 * e.ms) / total).toFixed(1)} |`);
  }
  out.push(
    '',
    `#### ${p}: slowest ${TOP} tests`,
    '',
    '| file:line | title | s | status |',
    '|---|---|---|---|',
  );
  for (const r of [...rs].sort((a, b) => b.duration - a.duration).slice(0, TOP)) {
    out.push(`| ${r.file}:${r.line} | ${esc(r.title)} | ${sec(r.duration)} | ${r.status} |`);
  }
  const bad = rs.filter((r) => r.status !== 'passed' && r.status !== 'skipped');
  out.push('', `#### ${p}: failures (${bad.length})`, '');
  for (const r of bad) out.push(`- ${r.file}:${r.line} ${esc(r.title)} (${r.status})`);
  out.push('');
}

console.log(out.join('\n'));
