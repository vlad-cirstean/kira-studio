import { chmod, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { KiraSpaceApp } from '../fixtures';

export const GATED_FACT = 'The billing service uses PostgreSQL 16.';

const ANSWER = {
  type: 'result',
  subtype: 'success',
  is_error: false,
  total_cost_usd: 0.01,
  num_turns: 1,
  structured_output: {
    items: [
      {
        index: 0,
        verdict: 'accept',
        questions: [],
        facts: [
          {
            fact: GATED_FACT,
            reason: 'Stated by the maintainer in the migration notes.',
            keywords: ['billing', 'postgres', 'database'],
          },
        ],
      },
    ],
  },
};

/**
 * Fronts the fixture's fake claude for the memory gate: the fake prints a stream-json init line that
 * `--output-format json` callers cannot parse, so the gate prompt gets one canned accepting answer.
 * Every other call reaches the fake unchanged.
 */
export async function acceptingGate(kira: KiraSpaceApp): Promise<void> {
  const bin = join(kira.root, 'bin');
  const real = join(kira.root, 'real-claude');
  await rename(join(bin, 'claude'), real);
  const answer = join(kira.root, 'gate-answer.json');
  await writeFile(answer, JSON.stringify(ANSWER));
  const script = `#!/bin/bash
sys=""; prev=""
for a in "$@"; do
  [ "$prev" = "--system-prompt" ] && sys="$a"
  prev="$a"
done
case "$sys" in
*"gatekeeper of a long-term memory"*) cat >/dev/null; cat ${JSON.stringify(answer)}; exit 0;;
esac
exec ${JSON.stringify(real)} "$@"
`;
  await writeFile(join(bin, 'claude'), script);
  await chmod(join(bin, 'claude'), 0o755);
}
