import type { StyleValue } from 'vue';
import { matchesQuery } from '../behaviour/match';

export interface PickerOption {
  value: string;
  label: string;
  /** Muted text beside the label; searched too. */
  detail?: string;
  group?: string;
  /** Extra search text. */
  keywords?: readonly string[];
  disabled?: boolean;
  /** Why the option is disabled; shown as a visible line. */
  reason?: string;
  labelClass?: string;
  labelStyle?: StyleValue;
  /** Label in the data font (refs, keys, paths). */
  dataFont?: boolean;
  /** Test id suffix when `value` is not test-id safe. */
  testid?: string;
}

export interface PickerGroup {
  id: string;
  label: string;
}

export interface PickerSection {
  id: string;
  label: string;
  options: PickerOption[];
}

export interface FoldedOptions {
  /** Matches in display order: ungrouped first, then `groups` order. */
  ordered: PickerOption[];
  /** An option label equals the trimmed query. */
  exact: boolean;
}

/** Filters by `query` and orders by `groups`. Caller order is kept inside a group. */
export function foldOptions(
  options: readonly PickerOption[],
  groups: readonly PickerGroup[],
  query: string,
): FoldedOptions {
  const needle = query.trim();
  const known = new Set(groups.map((g) => g.id));
  const buckets = new Map<string, PickerOption[]>([['', []]]);
  for (const g of groups) buckets.set(g.id, []);
  let exact = false;
  for (const o of options) {
    const hay = [o.label, o.detail ?? '', ...(o.keywords ?? [])].join(' ');
    if (!matchesQuery(hay, needle)) continue;
    if (o.label === needle) exact = true;
    buckets.get(o.group !== undefined && known.has(o.group) ? o.group : '')?.push(o);
  }
  return { ordered: [...buckets.values()].flat(), exact };
}

/** Splits an ordered slice back into headed sections. */
export function sectionize(
  ordered: readonly PickerOption[],
  groups: readonly PickerGroup[],
): PickerSection[] {
  const sections: PickerSection[] = [];
  for (const o of ordered) {
    const id = o.group !== undefined && groups.some((g) => g.id === o.group) ? o.group : '';
    const last = sections.at(-1);
    if (last?.id === id) last.options.push(o);
    else sections.push({ id, label: groups.find((g) => g.id === id)?.label ?? '', options: [o] });
  }
  return sections;
}
