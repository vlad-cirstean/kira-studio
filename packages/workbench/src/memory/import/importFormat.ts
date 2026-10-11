import type { ImportJob } from '@shared/domain/memoryImport';

export const ACTIVE_JOB_STATES: readonly ImportJob['state'][] = [
  'scanning',
  'awaiting',
  'running',
  'paused',
];

export function jobTitle(job: ImportJob): string {
  const first = job.roots[0] ?? job.base;
  const name = first.split(/[\\/]/).filter(Boolean).pop() ?? first;
  return job.roots.length > 1 ? `${name} +${job.roots.length - 1}` : name;
}
