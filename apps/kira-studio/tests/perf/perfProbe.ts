import { readdirSync, readFileSync } from 'node:fs';

// P160 probe helpers. Opt-in, asserts nothing (docs/DEV_ENVIRONMENT.md).

export interface RunMetrics {
  load1: number;
  warm: boolean;
  firstTextMs: number | null;
  shownMs: number | null;
  longestBlockMs: number | null;
  tbtMs: number | null;
  rssPeakDeltaMb: number | null;
  rssPeakMb: number | null;
}

export function load1(): number {
  try {
    return Number.parseFloat(readFileSync('/proc/loadavg', 'utf8').split(' ')[0] ?? 'NaN');
  } catch {
    return Number.NaN;
  }
}

function readProc(pid: number): { ppid: number; rssKb: number } | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
    const status = readFileSync(`/proc/${pid}/status`, 'utf8');
    const m = /^VmRSS:\s+(\d+) kB/m.exec(status);
    return { ppid, rssKb: m ? Number(m[1]) : 0 };
  } catch {
    return null;
  }
}

/** Sum of VmRSS (MB) over every descendant of this process (WebKit UI, web and network processes). */
export function descendantsRssMb(rootPid: number = process.pid): number | null {
  if (process.platform !== 'linux') return null;
  const procs = new Map<number, { ppid: number; rssKb: number }>();
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    const p = readProc(Number(name));
    if (p) procs.set(Number(name), p);
  }
  const inTree = new Set<number>([rootPid]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [pid, p] of procs) {
      if (!inTree.has(pid) && inTree.has(p.ppid)) {
        inTree.add(pid);
        grew = true;
      }
    }
  }
  let kb = 0;
  for (const pid of inTree) if (pid !== rootPid) kb += procs.get(pid)?.rssKb ?? 0;
  return kb / 1024;
}

export class RssSampler {
  private timer: ReturnType<typeof setInterval> | null = null;
  peakMb: number | null = null;
  baselineMb: number | null = descendantsRssMb();

  start(): void {
    this.baselineMb = descendantsRssMb();
    this.peakMb = this.baselineMb;
    this.timer = setInterval(() => {
      const v = descendantsRssMb();
      if (v !== null && (this.peakMb === null || v > this.peakMb)) this.peakMb = v;
    }, 100);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

function median(xs: Array<number | null>): number | null {
  const v = xs.filter((x): x is number => x !== null && Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  return v[Math.floor(v.length / 2)] ?? null;
}

const fmt = (n: number | null): string => (n === null ? 'n/a' : String(Math.round(n * 10) / 10));

export function runLine(c: string, size: number, run: number, m: RunMetrics): string {
  return (
    `case=${c} size=${size} run=${run} load1=${fmt(m.load1)} warm=${m.warm} ` +
    `firstTextMs=${fmt(m.firstTextMs)} shownMs=${fmt(m.shownMs)} longestBlockMs=${fmt(m.longestBlockMs)} ` +
    `tbtMs=${fmt(m.tbtMs)} rssPeakDeltaMb=${fmt(m.rssPeakDeltaMb)} rssPeakMb=${fmt(m.rssPeakMb)}`
  );
}

export function summaryLine(c: string, size: number, runs: RunMetrics[]): string {
  const loads = runs.map((r) => r.load1).filter(Number.isFinite);
  return (
    `summary case=${c} size=${size} runs=${runs.length} ` +
    `load1=${fmt(loads.length ? Math.min(...loads) : null)}..${fmt(loads.length ? Math.max(...loads) : null)} ` +
    `firstTextMs=${fmt(median(runs.map((r) => r.firstTextMs)))} shownMs=${fmt(median(runs.map((r) => r.shownMs)))} ` +
    `longestBlockMs=${fmt(median(runs.map((r) => r.longestBlockMs)))} tbtMs=${fmt(median(runs.map((r) => r.tbtMs)))} ` +
    `rssPeakDeltaMb=${fmt(median(runs.map((r) => r.rssPeakDeltaMb)))}`
  );
}
