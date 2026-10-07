import type { ContainerState } from '../wire';

export function shortId(id: string): string {
  return id.replace(/^sha256:/, '').slice(0, 12);
}

export function formatPercent(n: number): string {
  return `${n.toFixed(1)}%`;
}

export function isActiveState(state: ContainerState): boolean {
  return state === 'running' || state === 'paused' || state === 'restarting';
}

/** Tailwind text colour for a container state's status dot. */
export function stateDotClass(state: ContainerState): string {
  if (state === 'running') return 'bg-ok';
  if (state === 'paused' || state === 'restarting') return 'bg-warn';
  return 'bg-subtle';
}

export function formatCreated(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString();
}
