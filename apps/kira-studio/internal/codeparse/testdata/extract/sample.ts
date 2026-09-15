interface Greeter {
  greet(name: string): string;
}

abstract class Person implements Greeter {
  abstract greet(name: string): string;
}

declare function helper(name: string): Greeter;

let g: Greeter;

class Robot implements Greeter {
  greet(name: string): string {
    return helper2(name);
  }
}

function helper2(name: string): string {
  return "hi " + name;
}

// P64: a type alias — invisible to the vendored tags.scm before p64_declarations.scm (§2.2).
type RobotKind = string;

// P64: an enum — same gap.
enum RobotState {
  Idle,
  Moving,
}

// P64: a module-level `export const` bound to a call expression — same gap.
export const robotConfig = makeConfig();

// P64: an arrow-valued `export const` — already indexed as @definition.function by javascript's
// own vendored pattern (unanchored, so it fires regardless of the export wrapper); p64's own const
// pattern must not also fire and produce a duplicate/incompatible-kind row for the same name.
export const buildRobot = () => new Robot();

// P64: a const inside a function body — the `program` anchor must keep this off the symbol table.
function helper3(): void {
  const localNote = "not indexed";
}

// P64b: a regex-valued module const — invisible before §2.7's widened value list.
const OPERATOR_RE = /[+\-*/]/;

// P67f: a module-level array, read via for...of and an index expression (§3.3's new "read"
// reference kind, one language family over from Go's queries/go/p67f_reads.scm). Named distinctly
// from any real production identifier — this fixture is indexed alongside the rest of the
// repository by the live MCP server, and a colliding name would make find_references ambiguous.
const p67fSampleItems: number[] = [1, 2, 3];

// P67f: a for...of over a call expression — the "no row" case (§5.3): the operand is not a bare
// identifier.
function p67fMakeItems(): number[] {
  return [];
}

function p67fHelperReads(): void {
  for (const v of p67fSampleItems) {
    console.log(v);
  }
  const first = p67fSampleItems[0];
  for (const v of p67fMakeItems()) {
    console.log(v);
  }
}

// P69b: a bare-identifier read as a call argument, as both operands of a comparison, and a
// non-identifier call argument, a selector (no row) — the commonest read shapes P67f's
// for...of/index patterns above didn't reach (docs/v1.6/plans/
// P69b-repo-map-bare-identifier-reads.md §6.2).
const p69bArg: number = 1;
const p69bLeft: number = 2;
const p69bRight: number = 3;
const p69bObj = { val: 4 };

function p69bConsume(n: number): void {}

function p69bHelperReads(): void {
  p69bConsume(p69bArg);
  const cmp = p69bLeft < p69bRight;
  p69bConsume(p69bObj.val);
}

// M1c: interface/type-literal/class member fields, and non-call member reads (docs/v1.7/plans/
// M1c-repomap-struct-field-fix.md §2.2/§2.4/§4.3). Fixture names prefixed m1c per the fixture's own
// rule above.
interface M1cInterface {
  m1cPropA: number;
  m1cPropB: string;
}

type M1cTypeLiteral = {
  m1cLiteralProp: number;
};

declare const m1cIfaceVal: M1cInterface;
declare const m1cLiteralVal: M1cTypeLiteral;

class M1cClass {
  m1cField = 1;
  #m1cPrivate = 2;

  m1cMethod(): number {
    return this.m1cField;
  }

  // A `#private` field is deliberately not captured (§2.2): neither this declaration nor this read
  // earns a "field" row.
  m1cReadPrivate(): number {
    return this.#m1cPrivate;
  }
}

const m1cInstance = new M1cClass();

function m1cHelperReads(): void {
  const a = m1cIfaceVal.m1cPropA;
  const b = m1cIfaceVal.m1cPropB;
  const c = m1cLiteralVal.m1cLiteralProp;
  const d = m1cInstance.m1cField;
  m1cInstance.m1cMethod(); // called: one "call" row, no duplicate "field" row (§2.6)
  const f = m1cInstance.m1cMethod; // method value, not called: one "field" row
  m1cInstance.m1cReadPrivate();
  void a;
  void b;
  void c;
  void d;
  void f;
}
