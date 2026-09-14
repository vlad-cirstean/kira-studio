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
