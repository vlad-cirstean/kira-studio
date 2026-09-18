import {
  buildRowPlan,
  type CommitStore,
  identityRowPlan,
  type RowPlan,
  type TipRef,
} from '@kira/git-core';
import { type ShallowRef, shallowRef } from 'vue';

/**
 * P93 §7: the branch-grouped row plan as reactive UI state — `GraphViewState`'s own `order`
 * (optional; `GraphViewState` falls back to the identity plan when none is given, §5.4). Owns
 * exactly the inputs `buildRowPlan` needs and nothing it computes from them: the tip list
 * (`App.vue` feeds it from `RefsState`/`StashState`, mirroring how `SelectionState` takes a
 * `CommitStore` and nothing else — this class never imports `RefsState`), the session-only
 * expanded-group set (P93 §4.4: never persisted, so every repo open starts fully collapsed
 * again), and the persisted `collapseEnabled` flag (`App.vue` also owns the actual persistence,
 * through `PersistedViewState`; this class only holds the live value).
 *
 * `rebuild` is the one place a `RowPlan` is actually built — deliberately not run automatically
 * by `setTips`/`toggleGroup`/`setCollapseEnabled`, since building one needs the `CommitStore`
 * this class does not hold. `GraphViewState.#rebuildLayout` (P93 §5.3) is the only caller —
 * `App.vue` changes an input, then calls `GraphViewState.rebuildOrder()`, which calls `rebuild`
 * as its own first step. `revision` is `GraphViewState`'s own dirty flag more than a public API:
 * a strictly-increasing counter a caller can diff against to notice a rebuild landed, without
 * reaching into `plan.value` itself.
 */
export class GraphOrderState {
  readonly plan: ShallowRef<RowPlan> = shallowRef(identityRowPlan(0));
  /** Bumped by every `rebuild()`/`reset()` call — `GraphViewState`'s own trigger for "the plan's
   *  inputs changed, lay it out again", kept separate from `RowPlan.revision` (which is only
   *  ever *read*, stamped at construction) so a watcher never has to reach into `plan.value`
   *  itself just to know something moved. */
  readonly revision: ShallowRef<number> = shallowRef(0);

  #tips: readonly TipRef[] = [];
  readonly #expandedKeys = new Set<string>();
  #collapseEnabled = false;

  /** `App.vue`'s own watcher over `RefsState`/`StashState`, already in priority order (§3.2) —
   *  this class has no branch/stash/tag vocabulary of its own and never reorders what it is
   *  given. Does not itself trigger a rebuild; see this class's own doc comment. */
  setTips(tips: readonly TipRef[]): void {
    this.#tips = tips;
  }

  /** A collapsed group's own expand/collapse click (P93 §4.2) — toggles `key` (a `TipRef.key`,
   *  or the synthetic `other` group's own key) in the session-only expanded set. */
  toggleGroup(key: string): void {
    if (this.#expandedKeys.has(key)) this.#expandedKeys.delete(key);
    else this.#expandedKeys.add(key);
  }

  /** The toolbar's collapse-branches toggle (P93 §4.4/§8) — the persisted half of this value
   *  lives in `App.vue`'s own `PersistedViewState`; this only holds the live value `rebuild`
   *  reads. */
  setCollapseEnabled(on: boolean): void {
    this.#collapseEnabled = on;
  }

  /** Builds a fresh `RowPlan` against `store`'s current rows and this class's current inputs,
   *  and bumps `revision` — the one call that actually changes what `GraphViewState` lays out.
   *  `generation` is `GraphViewState.generation.value` (`CommitStore`'s own reset counter); this
   *  class does not read it itself, but takes it in the signature so every call site is honest
   *  about which store generation the plan was built against (`GraphViewState`'s own doc comment
   *  on why every store consumer threads `generation` through). */
  rebuild(store: CommitStore, _generation: number): void {
    const revision = this.revision.value + 1;
    this.revision.value = revision;
    this.plan.value = buildRowPlan(store, this.#tips, {
      expandedKeys: this.#expandedKeys,
      collapseEnabled: this.#collapseEnabled,
      revision,
    });
  }

  /** Called alongside `GraphViewState.reset()` on a repo switch (`App.vue:259`) — clears the
   *  tip list and every expanded group (both genuinely per-repo session data); `collapseEnabled`
   *  is a standing UI preference, not repo-scoped, so it survives. Sets `plan` to an empty
   *  identity plan directly, rather than waiting on the next `rebuild()`, since a repo switch
   *  has no store to build one against yet. */
  reset(): void {
    this.#tips = [];
    this.#expandedKeys.clear();
    const revision = this.revision.value + 1;
    this.revision.value = revision;
    this.plan.value = identityRowPlan(0, revision);
  }
}
