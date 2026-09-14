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
