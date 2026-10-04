# P146 Stream B notes

Base 2ad7fdea, branch v2.0-p146-b. Not pushed.

## Commits

- 33fdda90 restore notes editor, resize handle, changes tab, estimate field; knip tiptap ignore dropped
- d55bc0c4 panel task mode, Notes tab, queries, store
- 19df98b7 panel branch mode, merged/deployed line 2, refresh summary
- 9d25eb2a backlog page, Backlog tab with count
- d329f67e headless setting sources switch
- 2d40ce2e UI specs, mock runtime channels
- 00935221 parity spec drops mockup `Right-click to re-merge.` suffix (R5)
- 17c73523 mockup alignment fixes

## Checks

- test:unit: 1739 pass, 0 fail.
- lint:all: exit 0. lint:dead (knip): exit 0, no `@tiptap/*` ignore.
- test:ui:space: 85 pass.
- check-ade-colours.sh: pass.
- Greps: no `ade/wire.ts` import under `ade/v2`; no `<style`; no `defineComponent`; no `Right-click` text; no Merge/Re-merge UI. Words rebase/queue remain only in pre-existing board model code (`timeline.ts`, `actions.ts`), not in this stream's UI.

## Deviations

- Settings switch: `SettingsDialog.vue` builds the draft from appearance/advanced/git only and `SettingsPaneProps` has no `ade`. Both are out of column. Switch in `AdvancedPane.vue` writes `ade.headlessSettingSources` immediately via `patchSettings`, not on dialog Save. Draft-bound version needs `SettingsDialog.vue` and `settings/types.ts`.
- Estimate: extend-only once set; shrink refusal is the backend error shown inline.
- Jira row shows key only (R4); no status chip or title.
- Details lists every repo environment and integration branch (from `repos`), `not deployed`/`not merged` where the branch has no entry.

## Mockup comparison (Chromium 1440x900)

Images in /tmp/claude-0/-home-user-kira-studio/d44f5205-cc3e-52b8-b56f-c8f106d4670f/scratchpad/mock/: `m-*.png` mockup, `a-*.png` app (task, notes, branch, changes, backlog).

Fixed after first pass: Details showed "No environments configured" for a branch without deployments (now lists repo environments); backlog selected-row border amber; row inputs transparent; arrows enabled at the ends like mockup; header and h2 sizes; notes editor fills the panel; task checkbox accent; Changes file delta omits zero.

Verdict: matches except accepted differences (Workflow block, Sessions tab, header stage actions/Archive, Merge/Re-merge/fix menu, Worktree setup block, fonts, fixture data, Jira status chip/title, extend-only estimate, app theme background).
