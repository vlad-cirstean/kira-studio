class Greeter {
  greet(name) {
    return helper(name);
  }
}

function helper(name) {
  return "hi " + name;
}

class Robot extends Greeter {
  build() {
    return new Greeter();
  }
}

// P64b: an export const bound to an object — exercises the export_statement pattern (§2.5).
export const robotDefaults = { speed: 1 };

// P64b: a bare const bound to a call expression — exercises the non-export pattern (§2.5).
const robotFactory = makeRobot();

// P64b: an arrow-valued export const — already indexed as @definition.function by javascript's own
// vendored pattern; p64b's own const pattern must not also fire (no duplicate/incompatible row).
export const buildRobot = () => new Robot();

// P64b: a const inside a function body — the `program` anchor must keep this off the symbol table.
function helper2() {
  const localNote = "not indexed";
}

// P64b: a `let` at module scope — deliberately excluded (§2.5, matching P64 §2.2's own decision).
let robotCounter = 0;
