// Stryker base config for P151 (report-only). Run via scripts/mutation/ts.sh, CWD = snapshot.
// Env: MUTATION_AREA, MUTATION_REPORT (json path), MUTATION_WORKERS, MUTATION_ONLY (JSON list of
// changed files; intersected with the area's globs, exit 3 when empty).
import { globSync, readFileSync } from 'node:fs';
import { matchesGlob } from 'node:path';

const spec = JSON.parse(readFileSync(new URL('./areas.json', import.meta.url), 'utf8'));
const name = process.env.MUTATION_AREA;
const area = spec.areas[name];
if (!area) throw new Error(`unknown mutation area: ${name}`);

const excluded = new Set(area.excludeTests.map((t) => t.path));
const tests = area.tests
  .flatMap((dir) =>
    ['*.spec.ts', '*.test.ts'].flatMap((glob) =>
      globSync(`${dir}/**/${glob}`, { exclude: (p) => p === 'node_modules' }),
    ),
  )
  .filter((f) => !excluded.has(f))
  .sort();

let mutate = area.mutate;
if (process.env.MUTATION_ONLY) {
  mutate = JSON.parse(process.env.MUTATION_ONLY).filter(
    (f) =>
      area.mutate.some((g) => matchesGlob(f, g)) &&
      !spec.globalExcludes.some((g) => matchesGlob(f, g)),
  );
  if (mutate.length === 0) {
    console.error(`area ${name}: no changed files in scope`);
    process.exit(3);
  }
}

export default {
  testRunner: 'bun',
  plugins: [import.meta.resolve('@hughescr/stryker-bun-runner')],
  coverageAnalysis: 'perTest',
  ignoreStatic: true,
  // Workspace packages carry their own node_modules (isolated linker); Stryker's sandbox only
  // links the root one. The snapshot is disposable, so mutate it in place.
  inPlace: true,
  checkers: [],
  disableTypeChecks: '{apps,packages}/**/*.ts',
  mutate: [...mutate, ...spec.globalExcludes.map((g) => `!${g}`)],
  bun: {
    testFiles: tests,
    timeout: 600000,
    // Bun's 5s per-test default kills the 100k-sha shaTable test under instrumentation.
    bunArgs: ['--timeout', '60000'],
  },
  timeoutMS: 10000,
  timeoutFactor: 2,
  concurrency: Number(process.env.MUTATION_WORKERS ?? 2),
  reporters: ['json', 'clear-text', 'progress-append-only'],
  clearTextReporter: { allowColor: false, logTests: false, reportTests: false },
  jsonReporter: { fileName: process.env.MUTATION_REPORT ?? 'reports/mutation/mutation.json' },
  cleanTempDir: true,
};
