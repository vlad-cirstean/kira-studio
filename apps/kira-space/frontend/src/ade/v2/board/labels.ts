import type { Branch, Task } from '../wire';
import { baseContext } from './baseMarker';
import type { BranchGraph } from './branchGraph';

const SHORT_TARGET: Record<string, string> = { develop: 'dev', staging: 'stg', release: 'rel' };

/** Integration branch short label: `develop` -> `dev`, `staging` -> `stg`, `release` -> `rel`. */
export function integrationLabel(target: string): string {
  return SHORT_TARGET[target] ?? target;
}

export interface LabelChip {
  label: string;
  /** `muted` is up to date, `stale` renders amber, `unknown` is a failed deployment script. */
  tone: 'muted' | 'stale' | 'unknown';
  tip: string;
}

function chipsApply(b: Branch): boolean {
  return b.kind === 'mine' && b.name !== '';
}

/** `dev ✓` / `stg ⚠`; nothing for a target the branch is not merged into. */
export function integrationChips(b: Branch): LabelChip[] {
  if (!chipsApply(b)) return [];
  const out: LabelChip[] = [];
  for (const i of b.integration) {
    if (i.status === 'not merged') continue;
    const merged = i.status === 'merged';
    out.push({
      label: `${integrationLabel(i.target)} ${merged ? '✓' : '⚠'}`,
      tone: merged ? 'muted' : 'stale',
      tip: merged
        ? `merged into ${i.target}, up to date`
        : `stale in ${i.target}${i.note ? `: ${i.note}` : `: has changes not in ${i.target}`}`,
    });
  }
  return out;
}

/** `▲staging ✓` / `▲prod ⚠`; nothing for an environment the branch is not deployed to. */
export function deploymentChips(b: Branch): LabelChip[] {
  if (!chipsApply(b)) return [];
  const out: LabelChip[] = [];
  for (const d of b.deployments) {
    if (d.status === 'not deployed') continue;
    if (d.status === 'unknown') {
      out.push({
        label: `▲${d.env} ?`,
        tone: 'unknown',
        tip: d.error || `${d.env}: deployed sha unknown`,
      });
    } else if (d.status === 'deployed') {
      out.push({
        label: `▲${d.env} ✓`,
        tone: 'muted',
        tip: `deployed: ${d.env} runs ${d.deployedSha}, which contains this branch`,
      });
    } else {
      out.push({
        label: `▲${d.env} ⚠`,
        tone: 'stale',
        tip: `stale on ${d.env}: ${d.note || `${d.env} runs ${d.deployedSha}, missing changes of this branch`}`,
      });
    }
  }
  return out;
}

export interface BranchLine2 {
  /** `no branch yet · from main` for a draft, the PR title for a review item, else ''. */
  context: string;
  merged: LabelChip[];
  deployed: LabelChip[];
  /** Thin divider between merged and deployed, only when both exist. */
  divider: boolean;
}

/** Quiet second line: context · merged · divider · deployed (SPEC2 §4.1). */
export function branchLine2(b: Branch, graph: BranchGraph, prTitle: string): BranchLine2 {
  const merged = integrationChips(b);
  const deployed = deploymentChips(b);
  return {
    context: b.name === '' ? baseContext(b, graph) : b.kind === 'review' ? prTitle : '',
    merged,
    deployed,
    divider: merged.length > 0 && deployed.length > 0,
  };
}

/** Task title: its own title, else Jira key, else PR title, else branch name, else `New task`. */
export function taskTitle(t: Task, firstBranch: Branch | undefined, prTitle: string): string {
  return t.title || t.jira?.key || prTitle || firstBranch?.name || 'New task';
}
