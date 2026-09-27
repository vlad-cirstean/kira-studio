import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// P129 Part 3 §3.1 (plan §0.2): the parity oracle is the mockup itself, run unmodified. This module
// extracts `docs/v2.0/design/mockup.html`'s inline script from `class DCLogic` up to (not including)
// `const comp = new Component({})`, runs it in a `node:vm` context, and exposes one `Component`
// class the spec instantiates per scenario. `renderVals()` never touches the DOM synchronously
// (§0.2 — only event handlers do, e.g. the notes editor's own deferred `setTimeout(fn, 0)`), so the
// stubs below are deliberately inert: a `setTimeout` that never invokes its callback is what keeps
// `document.getElementById` unreached during a synchronous `renderVals()` call.
//
// `TODAY` is the mockup's own literal `new Date(2026, 8, 22)` (line 935) — local-time. Forcing
// `TZ=UTC` here, before any `Date` is constructed in this process, makes the vm context's `Date`
// (backed by the same process-wide ICU/libuv timezone data as the main realm) agree with
// `useQueue.ts`'s own `Date.UTC`-based calendar arithmetic — the mitigation plan §0.6's own risk
// entry (row 4: "local vs UTC date drift") calls for.
process.env.TZ = 'UTC';

const MOCKUP_PATH = path.join(import.meta.dir, '../../../../../docs/v2.0/design/mockup.html');
const START_MARKER = 'class DCLogic';
const END_MARKER = 'const comp = new Component({})';

function extractSource(): string {
  const html = fs.readFileSync(MOCKUP_PATH, 'utf8');
  const start = html.indexOf(START_MARKER);
  const end = html.indexOf(END_MARKER);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(
      `mockupOracle: could not locate '${START_MARKER}'..'${END_MARKER}' markers in ${MOCKUP_PATH}`,
    );
  }
  return html.slice(start, end);
}

// biome-ignore lint/suspicious/noExplicitAny: the oracle's shape is the mockup's own untyped output.
export type MockupComponent = any;

let ComponentCtor: (new (props: Record<string, unknown>) => MockupComponent) | null = null;

/** Loads and evaluates the mockup's own script once per test process; every scenario gets a fresh
 *  `new Component({})` instance (the constructor resets `state`), never a shared one. */
function loadComponentCtor(): new (props: Record<string, unknown>) => MockupComponent {
  if (ComponentCtor) return ComponentCtor;
  const source = extractSource();
  const sandbox: Record<string, unknown> = {
    console,
    // Never invoked (see header comment) — a real timer would leak past the test and touch `document`.
    setTimeout: () => 0,
    clearTimeout: () => {},
    document: {
      getElementById: () => null,
      execCommand: () => {},
      queryCommandValue: () => '',
      addEventListener: () => {},
    },
    navigator: { clipboard: { writeText: () => {} } },
    window: { getSelection: () => null, open: () => {} },
  };
  vm.createContext(sandbox);
  // Class declarations don't attach to the context object on their own — the explicit assignment
  // below is how `Component` escapes the vm's own module-less top level scope.
  vm.runInContext(`${source}\nglobalThis.__MockupComponent = Component;`, sandbox, {
    filename: 'mockup-oracle.js',
  });
  const ctor = sandbox.__MockupComponent as new (props: Record<string, unknown>) => MockupComponent;
  ComponentCtor = ctor;
  return ctor;
}

/** §0.2: strips `ready`/`ciFailing` from every `repoData()` item and empties every Jira `title`, so
 *  the mockup's own `ready`/`CI failing` status rungs and Jira-title fallback are unreachable —
 *  neutralizing user decisions by data, never by patching the mockup's own source. Also empties
 *  `state.newWork[*].jiraTitle`, the other half of the title-fallback chain the design dropped. */
function neutralize(comp: MockupComponent): void {
  const originalRepoData = comp.repoData.bind(comp);
  comp.repoData = () => {
    const data = originalRepoData();
    for (const repo of Object.keys(data)) {
      for (const item of data[repo]) {
        item.ready = undefined;
        item.ciFailing = undefined;
        if (item.jira) item.jira = { ...item.jira, title: '' };
      }
    }
    return data;
  };
  for (const repo of Object.keys(comp.state.newWork)) {
    comp.state.newWork[repo] = comp.state.newWork[repo].map((w: Record<string, unknown>) => ({
      ...w,
      jiraTitle: '',
    }));
  }
}

export interface RunMockupOptions {
  repo: string;
  /** Assigned to `state.selected[repo]` before rendering — `renderVals()`'s own `sel` (and the
   *  branch link row's `branchStatus`) are only ever computed for this one id (§3.1's own discovery:
   *  `status()`/`branchStatus()` are not embedded per-row in `blocks[].rows[]`, only in `sel`). */
  selectedId?: string;
  /** Shallow-merged onto `comp.state` after `repo`/`selected` are set — nested objects (`plans`,
   *  `merged`, ...) must be passed whole (mockup's own `setState` shape, one level deep). */
  statePatch?: Record<string, unknown>;
  /** Default `true` — set `false` only for a rule test that must observe the mockup's own
   *  ready/ciFailing/Jira-title behavior directly (rules spec, never the parity spec). */
  neutralizeUserDecisions?: boolean;
}

/** Runs one `renderVals()` scenario and returns its full, unmodified return value — every field the
 *  mockup itself computes, not a pre-shaped projection (§3.1: "projects data fields" is the spec's
 *  own job, done at the comparison site, not baked into the oracle). */
export function runMockup(options: RunMockupOptions): MockupComponent {
  const Component = loadComponentCtor();
  const comp = new Component({});
  comp.state.repo = options.repo;
  comp.state.lastRepo = options.repo;
  if (options.selectedId !== undefined) {
    comp.state.selected = { ...comp.state.selected, [options.repo]: options.selectedId };
  }
  if (options.neutralizeUserDecisions !== false) neutralize(comp);
  if (options.statePatch) Object.assign(comp.state, options.statePatch);
  return comp.renderVals();
}

/** A fresh, neutralized `Component` instance with no `renderVals()` call yet — for a converter that
 *  needs `repoData()`/`historyData()` (already neutralized) without paying for a full render. */
export function loadNeutralizedComponent(): MockupComponent {
  const Component = loadComponentCtor();
  const comp = new Component({});
  neutralize(comp);
  return comp;
}
