import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// Parity oracle for the v2 board logic: the frozen P129 design mockup (fixtures/ade-v2-mockup.html,
// formerly docs/v2.0/design/ade-v2/mockup.html), run unmodified, same mechanism as the v1
// `mockupOracle.ts`. Extracts the inline script from `class DCLogic` up to (not including) `const
// comp = new Component({})`, evaluates it in a `node:vm` context and exposes the mockup's own
// `renderVals()` output. `renderVals()` never touches the DOM synchronously, so the stubs are inert.
// The mockup's `TODAY` is a local-time `new Date(2026, 8, 22)`; `TZ=UTC` keeps it equal to the
// calendar helpers' UTC arithmetic.
process.env.TZ = 'UTC';

const MOCKUP_PATH = path.join(import.meta.dir, 'fixtures/ade-v2-mockup.html');
const START_MARKER = 'class DCLogic';
const END_MARKER = 'const comp = new Component({})';

// biome-ignore lint/suspicious/noExplicitAny: the oracle's shape is the mockup's own untyped output.
export type MockupComponent = any;

let ctor: (new (props: Record<string, unknown>) => MockupComponent) | null = null;

function loadCtor(): new (props: Record<string, unknown>) => MockupComponent {
  if (ctor) return ctor;
  const html = fs.readFileSync(MOCKUP_PATH, 'utf8');
  const start = html.indexOf(START_MARKER);
  const end = html.indexOf(END_MARKER);
  if (start < 0 || end <= start) {
    throw new Error(
      `mockupV2Oracle: markers '${START_MARKER}'..'${END_MARKER}' not found in ${MOCKUP_PATH}`,
    );
  }
  const sandbox: Record<string, unknown> = {
    console,
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
  vm.runInContext(`${html.slice(start, end)}\nglobalThis.__Mockup = Component;`, sandbox, {
    filename: 'mockup-v2-oracle.js',
  });
  ctor = sandbox.__Mockup as new (props: Record<string, unknown>) => MockupComponent;
  return ctor;
}

/** One fresh `renderVals()` of the mockup's default data, every plan item shown. */
export function runMockupV2(statePatch: Record<string, unknown> = {}): MockupComponent {
  const Component = loadCtor();
  const comp = new Component({});
  Object.assign(comp.state, { showAllItems: true }, statePatch);
  return comp.renderVals();
}
