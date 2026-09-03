import { authFailure } from "./authFailure.ts";
import { badges } from "./badges.ts";
import { ceiling } from "./ceiling.ts";
import { clean } from "./clean.ts";
import { conflicted } from "./conflicted.ts";
import { dirty } from "./dirty.ts";
import { hugeRepo } from "./hugeRepo.ts";
import type { Scenario } from "./types.ts";

const SCENARIOS: Readonly<Record<string, Scenario>> = {
  clean,
  dirty,
  conflicted,
  hugeRepo,
  authFailure,
  badges,
};

/** Loadable by exact name via `?scenario=<name>` but deliberately left out of `SCENARIOS` above
 *  (P4 W12) — never enumerated as "known" (the error message below only lists `SCENARIOS`'
 *  keys), so nothing that surfaces "the scenario picker" lists it, but still reachable by
 *  whoever already knows the name. Each entry is a function, not a value, so importing this
 *  module never pays a hidden scenario's own build cost — only calling `loadScenario` with its
 *  exact name does. Today the only entry is `ceiling`, and the only caller is expected to be
 *  `tests/perf/graphUi.ts` (W15). */
const HIDDEN_SCENARIOS: Readonly<Record<string, () => Scenario>> = {
  ceiling,
};

export function loadScenario(name: string): Scenario {
  const scenario = SCENARIOS[name];
  if (scenario) return scenario;
  const hidden = HIDDEN_SCENARIOS[name];
  if (hidden) return hidden();
  throw new Error(`unknown scenario '${name}'; known: ${Object.keys(SCENARIOS).join(", ")}`);
}

export type { Scenario } from "./types.ts";
