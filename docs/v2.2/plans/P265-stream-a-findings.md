# P265 Stream A findings

Needs from files Stream A does not own. Test-and-fix agent applies each, then deletes this file.

## Specs owned by another stream

- `apps/kira-studio/tests/ui/automations-module.spec.ts:406` (Stream C): collection delete confirm message is now `“Backend” and everything inside it will be deleted. This can’t be undone.` under title `Delete collection?`.

## Foundation gaps

- `scripts/copy/catalogRules.ts` C6 treats the word after ` — `, `: ` and `. ` as a sentence start, so a lowercase word there fails. Messages were reworded to sentences. `AI`, `SSO`, `PII`, `CDATA`, `DOCTYPE` are not in `PROPER_NOUNS`; messages avoid them or take them as placeholders.
