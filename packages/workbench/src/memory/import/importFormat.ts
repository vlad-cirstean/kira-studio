import type { ImportJob } from '@shared/domain/memoryImport';

export const ACTIVE_JOB_STATES: readonly ImportJob['state'][] = [
  'scanning',
  'awaiting',
  'running',
  'paused',
];

export function formatDuration(seconds: number): string {
  if (seconds < 60) return 'under 1 min';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `about ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `about ${hours} h ${minutes % 60} min`;
}

export function jobTitle(job: ImportJob): string {
  const first = job.roots[0] ?? job.base;
  const name = first.split(/[\\/]/).filter(Boolean).pop() ?? first;
  return job.roots.length > 1 ? `${name} +${job.roots.length - 1}` : name;
}
