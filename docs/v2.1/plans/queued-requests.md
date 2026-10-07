# Queued v2.1 requests

Not yet planned. P197-P199 and P202 moved to `SPEC.md`, planned in `P197-P202-plan.md`; P200 in `P200-plan.md`.

- P208 (runs after every other v2.1 phase lands): requirements audit. One pass checks every user request in this chapter against the shipped code and tests: the 12 original requests (P185-P196), P197-P199, P200, P201, P202, P203-P207. Findings file under `plans/`; every gap goes back to a Sonnet fixer, same phase number.
- P209 (last): code review per CLAUDE.md "Code review": one Opus subagent, three dimensions, scope = everything since the last review session (state base commit). Findings file committed before any fixer starts.
