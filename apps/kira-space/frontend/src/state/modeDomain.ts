// P128 §2.6: this app's own module vocabulary, split into its own leaf file (no imports of its
// own) rather than defined directly in state/mode.ts — mirrors tabDomain.ts/settingsDomain.ts and
// Kira Studio's own `@shared/domain/mode.ts` (its own header comment) for `AppMode`: bridge/
// index.ts's own `createCoreControl<…, SpaceMode>` call needs this type without pulling in
// state/mode.ts (which imports `control` from bridge/index.ts itself), and every non-bridge
// importer keeps reading `SpaceMode` from state/mode.ts unchanged via its re-export below.
//
// Widens as each module lands: `git` alone at step 6, `terminal` at step 7, `ade` joins here
// (step 8) — SPEC.md's own final vocabulary; `memory` joins at P201 Part 2.
export type SpaceMode = 'git' | 'automations' | 'ade' | 'memory';
