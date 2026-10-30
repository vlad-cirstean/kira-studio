import type { BaseCandidate, BaseResolution, BaseResolutionReason, RefRow } from '@kira/git-ipc';
import { t } from '@theme/i18n';
import { compareNatural } from '@workbench/behaviour/match';
import type { PickerGroup, PickerOption } from '@workbench/lib/pickerOptions';

/** `override` and `none` need no explanation of where the base came from. */
export function reasonLabel(reason: BaseResolutionReason): string | undefined {
  switch (reason) {
    case 'upstream':
      return t('git.review.base.reasonUpstream.label');
    case 'defaultBranch':
      return t('git.review.base.reasonDefaultBranch.label');
    case 'override':
    case 'none':
      return undefined;
  }
}

export const SUGGESTED_PREFIX = 's:';

interface RefLists {
  readonly branches: { readonly value: readonly RefRow[] };
  readonly remoteBranches: { readonly value: readonly RefRow[] };
}

function byName(
  rows: readonly RefRow[],
  group: string | undefined,
  exclude?: string,
): PickerOption[] {
  return rows
    .filter((row) => row.shortName !== exclude)
    .map((row) => ({ value: row.shortName, label: row.shortName, group, dataFont: true }))
    .sort((a, b) => compareNatural(a.label, b.label));
}

/** Local branches, then (with `remote`) remote-tracking ones under their own heading. */
export function branchOptions(
  refs: RefLists,
  opts: { remote: boolean; exclude?: string },
): PickerOption[] {
  const local = byName(refs.branches.value, opts.remote ? 'local' : undefined, opts.exclude);
  return opts.remote
    ? [...local, ...byName(refs.remoteBranches.value, 'remote', opts.exclude)]
    : local;
}

export function branchGroups(): PickerGroup[] {
  return [
    { id: 'suggested', label: t('git.review.base.suggested.label') },
    { id: 'local', label: t('common.module.branches.label') },
    { id: 'remote', label: t('git.picker.remoteBranches.label') },
  ];
}

/** The base candidates minus the current base (picking it again changes nothing). `s:` keeps the
 *  value apart from the same ref in the branch list. */
export function baseCandidateOptions(resolution: BaseResolution | undefined): PickerOption[] {
  const current = resolution?.base;
  return (resolution?.candidates ?? [])
    .filter((c: BaseCandidate) => c.ref !== current)
    .map((c) => ({
      value: `${SUGGESTED_PREFIX}${c.ref}`,
      label: c.ref,
      detail: reasonLabel(c.reason),
      group: 'suggested',
      dataFont: true,
      testid: `suggested-${c.ref}`,
    }));
}
