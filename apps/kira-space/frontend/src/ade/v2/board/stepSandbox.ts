import type { StepSandbox } from '../wire';

export function defaultSandbox(): StepSandbox {
  return { access: 'write', read: [], allow: [], network: true };
}
