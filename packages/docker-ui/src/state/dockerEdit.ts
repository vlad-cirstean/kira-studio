import { defineStore } from 'pinia';
import { reactive, ref } from 'vue';
import { changes, cloneValues, type EditValues, merge3, type PendingChange } from '../lib/editDiff';
import type { DockerEditSpec } from '../wire';

export type EditSection = 'inPlace' | 'recreate';

export interface EditDraft extends EditValues {
  base: DockerEditSpec;
  /** The container changed under a dirty draft; the user reloads or keeps editing against old data. */
  stale: boolean;
}

export interface EditOutcome {
  warnings: string[];
}

export interface EditFailure {
  message: string;
  code: string;
  restored: boolean;
}

/** Edit drafts per container for the session, plus what each apply is doing and last reported. */
export const useDockerEditStore = defineStore('dockerEdit', () => {
  const drafts = reactive<Record<string, EditDraft>>({});
  const applying = reactive<Record<string, EditSection | undefined>>({});
  const outcome = reactive<Record<string, EditOutcome | undefined>>({});
  const failure = reactive<Record<string, EditFailure | undefined>>({});
  const rebaseOnce = ref(new Set<string>());

  function pending(id: string): PendingChange[] {
    const d = drafts[id];
    return d ? changes(d.base, d) : [];
  }

  function fresh(spec: DockerEditSpec): EditDraft {
    return {
      base: spec,
      inPlace: cloneValues(spec.inPlace),
      recreate: cloneValues(spec.recreate),
      stale: false,
    };
  }

  /** Feed a fetched spec in: create the draft, follow a clean one, or flag a dirty one as stale. */
  function ensure(spec: DockerEditSpec): void {
    const d = drafts[spec.id];
    if (!d) {
      drafts[spec.id] = fresh(spec);
      return;
    }
    if (d.base.baseHash === spec.baseHash) return;
    if (pending(spec.id).length === 0) {
      drafts[spec.id] = fresh(spec);
      return;
    }
    if (applying[spec.id] === 'inPlace' || rebaseOnce.value.has(spec.id)) {
      rebaseOnce.value.delete(spec.id);
      rebase(spec);
      return;
    }
    d.stale = true;
  }

  /** Re-base onto a newer spec, keeping every field the user edited. */
  function rebase(spec: DockerEditSpec): void {
    const d = drafts[spec.id];
    if (!d) return;
    drafts[spec.id] = {
      base: spec,
      inPlace: merge3(d.base.inPlace, d.inPlace, spec.inPlace),
      recreate: merge3(d.base.recreate, d.recreate, spec.recreate),
      stale: false,
    };
  }

  function expectRebase(id: string): void {
    rebaseOnce.value.add(id);
  }

  function reset(id: string, section?: EditSection): void {
    const d = drafts[id];
    if (!d) return;
    if (section !== 'recreate') d.inPlace = cloneValues(d.base.inPlace);
    if (section !== 'inPlace') d.recreate = cloneValues(d.base.recreate);
  }

  function discard(id: string): void {
    delete drafts[id];
    delete applying[id];
    delete outcome[id];
    delete failure[id];
    rebaseOnce.value.delete(id);
  }

  function begin(id: string, section: EditSection): void {
    applying[id] = section;
    delete outcome[id];
    delete failure[id];
  }

  function end(id: string): void {
    delete applying[id];
  }

  return {
    drafts,
    applying,
    outcome,
    failure,
    pending,
    ensure,
    rebase,
    expectRebase,
    reset,
    discard,
    begin,
    end,
  };
});
