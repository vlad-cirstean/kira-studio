import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

// Parity oracle for the v2 board logic: the frozen P143-149 design mockup's own logic
// (fixtures/ade-v2-mockup-logic.js — the inline <script> of the former
// docs/v2.0/design/ade-v2/mockup.html, markup/CSS stripped since this oracle never reads them),
// run unmodified, same mechanism as the v1 `mockupOracle.ts`. Evaluated in a `node:vm` context,
// exposing the mockup's own `renderVals()` output. `renderVals()` never touches the DOM
// synchronously, so the stubs are inert. The mockup's `TODAY` is a local-time
// `new Date(2026, 8, 22)`; `TZ=UTC` keeps it equal to the calendar helpers' UTC arithmetic.
process.env.TZ = 'UTC';

const MOCKUP_LOGIC_PATH = path.join(import.meta.dir, 'fixtures/ade-v2-mockup-logic.js');

// biome-ignore lint/suspicious/noExplicitAny: the oracle's shape is the mockup's own untyped output.
export type MockupComponent = any;

let ctor: (new (props: Record<string, unknown>) => MockupComponent) | null = null;

function loadCtor(): new (props: Record<string, unknown>) => MockupComponent {
  if (ctor) return ctor;
  const logic = fs.readFileSync(MOCKUP_LOGIC_PATH, 'utf8');
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
  vm.runInContext(`${logic}\nglobalThis.__Mockup = Component;`, sandbox, {
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
