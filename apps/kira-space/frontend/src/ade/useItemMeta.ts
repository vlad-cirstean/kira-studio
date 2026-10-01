import type { MaybeRefOrGetter } from 'vue';
import { reactive, toValue } from 'vue';
import { parseJira } from './jira';
import { parsePr } from './links';
import { useAdeSetBranchMeta, useAdeUpdateNewWork } from './mutations';
import type { QueuePanel } from './useQueue';
import type { AdeBranchMetaPatch, AdeNewWorkPatch } from './wire';

// P129 Part 6 §0.12: routes the Details tab's own field writes to `SetBranchMeta` (a real branch)
// or `UpdateNewWork` (a draft), and holds each field's own inline write error. Client-side
// validation (Jira/PR paste parsing, the estimate regex, new-work's "name or key" guard) happens
// here too, so nothing invalid ever reaches the mutation. Review items only ever call `setNotes`
// (the component hides every other input for them, mockup `mineOnly`) — this composable stays
// ignorant of that restriction rather than re-enforcing it.

/** `bridge/ade.go`'s own estimate pattern, unanchored nowhere: a bare number plus `h`/`d`. */
const EST_RE = /^\d+(?:\.\d+)?[hd]$/;

export type ItemMetaField = 'name' | 'jira' | 'prUrl' | 'estimate' | 'notes' | 'base';

export function useItemMeta(
  codeRepoId: MaybeRefOrGetter<string>,
  panel: MaybeRefOrGetter<QueuePanel>,
) {
  const setBranchMeta = useAdeSetBranchMeta(codeRepoId);
  const setNewWork = useAdeUpdateNewWork(codeRepoId);

  const errors = reactive<Record<ItemMetaField, string | null>>({
    name: null,
    jira: null,
    prUrl: null,
    estimate: null,
    notes: null,
    base: null,
  });

  async function writeNewWork(
    patch: AdeNewWorkPatch,
    field: ItemMetaField,
    id = toValue(panel).id,
  ): Promise<void> {
    try {
      await setNewWork.mutateAsync({ codeRepoId: toValue(codeRepoId), id, patch });
    } catch (e) {
      errors[field] = e instanceof Error ? e.message : 'Save failed';
    }
  }

  async function writeBranch(
    patch: AdeBranchMetaPatch,
    field: ItemMetaField,
    branch = toValue(panel).branch.ref,
  ): Promise<void> {
    try {
      await setBranchMeta.mutateAsync({
        codeRepoId: toValue(codeRepoId),
        branch,
        patch,
      });
    } catch (e) {
      errors[field] = e instanceof Error ? e.message : 'Save failed';
    }
  }

  /** Branch item -> `name` (empty clears the override); new work -> `title` (§0.12). */
  async function setName(value: string): Promise<void> {
    errors.name = null;
    const p = toValue(panel);
    if (p.isNewWork) await writeNewWork({ title: value }, 'name');
    else await writeBranch({ name: value }, 'name');
  }

  /** Empty input clears both `key`/`url`; a new-work draft refuses clearing the key while its own
   *  title is also empty, matching Go's own `title || jiraKey` rule (§0.10). */
  async function setJira(input: string): Promise<void> {
    errors.jira = null;
    const p = toValue(panel);
    const trimmed = input.trim();
    if (!trimmed) {
      if (p.isNewWork && !p.nameValue.trim()) {
        errors.jira = 'Give it a name or a Jira key';
        return;
      }
      const patch = { jira: { key: '', url: '' } };
      if (p.isNewWork) await writeNewWork(patch, 'jira');
      else await writeBranch(patch, 'jira');
      return;
    }
    const parsed = parseJira(trimmed);
    if (!parsed.key) {
      errors.jira = 'No Jira key found';
      return;
    }
    const patch = { jira: parsed };
    if (p.isNewWork) await writeNewWork(patch, 'jira');
    else await writeBranch(patch, 'jira');
  }

  /** Branch items only — new work has no PR row (§0.11: no PR field on `AdeNewWorkPatch`). */
  async function setPrUrl(input: string): Promise<void> {
    errors.prUrl = null;
    const trimmed = input.trim();
    if (!trimmed) {
      await writeBranch({ prUrl: '' }, 'prUrl');
      return;
    }
    const parsed = parsePr(trimmed);
    if (!parsed) {
      errors.prUrl = 'Paste a GitHub PR link (…/pull/123)';
      return;
    }
    await writeBranch({ prUrl: parsed.url }, 'prUrl');
  }

  /** `${num}${unit}` already assembled by the caller; empty clears it. A value failing the Go
   *  pattern shows inline and is never sent (§0.12). */
  async function setEstimate(value: string): Promise<void> {
    errors.estimate = null;
    const trimmed = value.trim();
    if (trimmed && !EST_RE.test(trimmed)) {
      errors.estimate = 'Use a number plus h or d, e.g. 4h or 2d';
      return;
    }
    const p = toValue(panel);
    if (p.isNewWork) await writeNewWork({ est: trimmed }, 'estimate');
    else await writeBranch({ est: trimmed }, 'estimate');
  }

  /** Writes to `itemId` (the item the editor text belongs to), never the current panel: the
   *  selection can move before a pending save lands. New-work ids carry the `nw:` prefix; a
   *  branch item's id is its branch name. */
  async function setNotes(itemId: string, value: string): Promise<void> {
    errors.notes = null;
    if (itemId.startsWith('nw:')) await writeNewWork({ notes: value }, 'notes', itemId);
    else await writeBranch({ notes: value }, 'notes', itemId);
  }

  /** New work only (§0.14's own Branch-row `from` select) — `''` means main. */
  async function setBase(value: string): Promise<void> {
    errors.base = null;
    await writeNewWork({ startFrom: value }, 'base');
  }

  return { errors, setName, setJira, setPrUrl, setEstimate, setNotes, setBase };
}
