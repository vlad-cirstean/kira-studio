// G23 D10: the JS half of the Go<->Bun differential fuzz test. Invoked exactly once per
// `go test -run TestDifferential` run (KIRA_GIT_DIFFERENTIAL=1), from
// `apps/kira-studio/internal/gitsearch/differential_test.go`, via `bun run` against this file's
// own absolute path — a relative import of `compileQuery` (not `@kira/git-core`) deliberately,
// since a workspace package's own name only resolves from inside a package that actually
// DECLARES it as a dependency (its own node_modules/@kira/* symlink); nothing makes that true for
// a Go test's working directory. Reads one JSON object off stdin, writes one JSON array to
// stdout — no other side effects, no console output on success (stderr is reserved for an actual
// crash). Not a `*.test.ts` file: `bun test`'s own glob never picks this up.
import { compileQuery } from './query.ts';

interface CaseIn {
  readonly pattern: string;
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
}

interface Input {
  readonly subjects: readonly string[];
  readonly cases: readonly CaseIn[];
}

interface CaseOut {
  readonly compiled: boolean;
  readonly matches: readonly boolean[];
}

async function main(): Promise<void> {
  const raw = await Bun.stdin.text();
  const input = JSON.parse(raw) as Input;
  const out: CaseOut[] = [];
  for (const c of input.cases) {
    const compiled = compileQuery({
      text: c.pattern,
      caseSensitive: c.caseSensitive,
      wholeWord: c.wholeWord,
      regex: true,
      scope: 'commits',
    });
    if (compiled.kind !== 'ok') {
      out.push({ compiled: false, matches: [] });
      continue;
    }
    const pattern = compiled.pattern;
    out.push({ compiled: true, matches: input.subjects.map((s) => pattern.test(s)) });
  }
  process.stdout.write(JSON.stringify(out));
}

await main();
