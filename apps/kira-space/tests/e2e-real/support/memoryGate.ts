import { join } from 'node:path';

export const GATED_FACT = 'The billing service uses PostgreSQL 16.';

/** Scenario whose memory gate accepts every fact with one canned answer (support/gate-accept.json). */
export const ACCEPTING_GATE = {
  prompts: [
    { system: 'gatekeeper of a long-term memory', emit: join(__dirname, 'gate-accept.json') },
  ],
};
