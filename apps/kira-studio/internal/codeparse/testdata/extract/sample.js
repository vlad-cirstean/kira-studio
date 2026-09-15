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

// P67f: a module-level array, read via for...of and an index expression (§3.3's new "read"
// reference kind, one language family over from Go's queries/go/p67f_reads.scm). Named distinctly
// from any real production identifier — this fixture is indexed alongside the rest of the
// repository by the live MCP server, and a colliding name would make find_references ambiguous.
const p67fSampleItems = [1, 2, 3];

// P67f: a for...of over a call expression — the "no row" case (§5.3): the operand is not a bare
// identifier.
function p67fMakeItems() {
  return [];
}

function p67fHelperReads() {
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
const p69bArg = 1;
const p69bLeft = 2;
const p69bRight = 3;
const p69bObj = { val: 4 };

function p69bConsume(n) {}

function p69bHelperReads() {
  p69bConsume(p69bArg);
  const cmp = p69bLeft < p69bRight;
  p69bConsume(p69bObj.val);
}
