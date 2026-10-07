import type { ContainerState, DockerPort } from '../wire';

export function shortId(id: string): string {
  return id.replace(/^sha256:/, '').slice(0, 12);
}

/** One decimal under 100%, whole numbers above (multi-core CPU can pass 100%). */
export function formatPercent(n: number): string {
  return n >= 100 ? `${Math.round(n)}%` : `${n.toFixed(1)}%`;
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** '0 B' / '341 MB' / '1.2 GB': 1024 steps, one decimal under 100, none above. */
export function formatSize(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (unit < UNITS.length - 1 && Math.round(value) >= 1024) {
    value /= 1024;
    unit++;
  }
  if (unit === 0) return `${Math.round(value)} B`;
  const digits = value < 99.95 ? 1 : 0;
  const text = value.toFixed(digits);
  if (text === '1024' && unit < UNITS.length - 1) return `1.0 ${UNITS[unit + 1]}`;
  return `${text} ${UNITS[unit]}`;
}

export function isActiveState(state: ContainerState): boolean {
  return state === 'running' || state === 'paused' || state === 'restarting';
}

/** Tailwind background for a container state's status dot. */
export function stateDotClass(state: ContainerState): string {
  if (state === 'running') return 'bg-ok';
  if (state === 'paused' || state === 'restarting') return 'bg-warn';
  if (state === 'dead') return 'bg-error';
  return 'bg-subtle';
}

/** Tailwind background for a usage bar: calm until it nears the limit. */
export function usageToneClass(percent: number): string {
  if (percent >= 90) return 'bg-error';
  if (percent >= 70) return 'bg-warn';
  return 'bg-info';
}

/** Published host ports, deduplicated (IPv4 and IPv6 bindings repeat), in port order. */
export function publishedPorts(ports: readonly DockerPort[]): string[] {
  const seen = new Set<number>();
  for (const p of ports) if (p.publicPort > 0) seen.add(p.publicPort);
  return [...seen].sort((a, b) => a - b).map(String);
}

export function formatCreated(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString();
}
