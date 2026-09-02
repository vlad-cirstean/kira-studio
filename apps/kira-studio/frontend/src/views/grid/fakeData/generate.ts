import type { Caps } from '@shared/caps';
import type { MutationRowOp } from '@shared/domain/mutations';
import { data } from '../../../bridge/data';
import { parseTypeBounds, type TypeBounds } from './typeBounds';
import type { ColumnPlan, GeneratorId, Recipe } from './types';

// P15 D1: a capability test (tabular + canInsert), not a kind check — a future adapter with real
// columns and an insert path opts in for free. Deliberately narrower than isWritable/canInsert
// alone: mongo/redis/kafka/sqs/s3 all have canInsert but no column set to generate against.
//
// P12 round 1 finding #16: the one gate for whether Generate data is offered at all, shared by
// DataToolbar.vue's own button and DataView.vue's command-palette entry — previously restated by
// hand in both, already caught drifting once (the second copy's own comment admitted it "mirrors
// DataToolbar.vue's canGenerateData exactly").
export function canGenerateDataFor(caps: Caps | null, readOnly: boolean | undefined): boolean {
  return !!caps?.tabular && !!caps?.canInsert && !readOnly;
}

// D2: the one dynamic import of fakerEntry.ts, memoised at module scope so a second run (or a
// second Preview) pays nothing beyond the first — the whole reason fakerEntry.ts exists as its
// own file is to give this import a clean, statically-analysable re-export to split on (P13's D2
// precedent), rather than leaving Rollup to shape a chunk around an inline dynamic namespace.
type Faker = Awaited<ReturnType<typeof loadFaker>>;
let fakerPromise: Promise<Faker> | null = null;
async function loadFaker() {
  const mod = await import('./fakerEntry');
  return mod.faker;
}
function getFaker(): Promise<Faker> {
  if (!fakerPromise) fakerPromise = loadFaker();
  return fakerPromise;
}

// D6: 500 rows/batch — ~0.12 MiB of request JSON and ~35ms to generate (F8), comfortably inside
// the ~150ms-per-step budget (docs/ARCHITECTURE.md:69), two orders of magnitude under the 8 MiB
// inbound-queue admission ceiling (F9.2), and a 500-statement (not 100 000-statement) op_log.command
// row (F9.1) — none of which anything else here truncates.
export const BATCH_SIZE = 500;

function clamp(text: string, maxLength: number | undefined): string {
  return maxLength !== undefined && text.length > maxLength ? text.slice(0, maxLength) : text;
}

// Formats an unscaled BigInt magnitude as a fixed-scale decimal string ("184600" @ scale 2 ->
// "1846.00") — string arithmetic throughout, never a JS number, so a numeric(20,6) never touches
// float64 on its way to the wire (F10, D5).
function formatScaled(unscaled: bigint, scale: number): string {
  if (scale === 0) return unscaled.toString();
  const digits = unscaled.toString().padStart(scale + 1, '0');
  const intPart = digits.slice(0, -scale) || '0';
  const fracPart = digits.slice(-scale);
  return `${intPart}.${fracPart}`;
}

function randomIntText(faker: Faker, bounds: TypeBounds): string {
  if (bounds.intRange) {
    return faker.number.bigInt({ min: bounds.intRange.min, max: bounds.intRange.max }).toString();
  }
  if (bounds.precision !== undefined) {
    const scale = bounds.scale ?? 0;
    const maxUnscaled = 10n ** BigInt(bounds.precision) - 1n;
    return formatScaled(faker.number.bigInt({ min: 0n, max: maxUnscaled }), scale);
  }
  // No declared bounds (an unrecognised dataType, D5) — a generic, harmless range.
  return faker.number.int({ min: 0, max: 1_000_000 }).toString();
}

function formatTemporal(dateValue: Date, dataType: string): string {
  const lower = dataType.toLowerCase();
  if (lower === 'date') return dateValue.toISOString().slice(0, 10);
  if (lower.startsWith('time') && !lower.startsWith('timestamp')) {
    return dateValue.toISOString().slice(11, 19);
  }
  return dateValue.toISOString();
}

function fakerCall(
  faker: Faker,
  id: GeneratorId,
  bounds: TypeBounds,
  dataType: string,
): () => string {
  switch (id) {
    case 'person.fullName':
      return () => faker.person.fullName();
    case 'person.firstName':
      return () => faker.person.firstName();
    case 'person.lastName':
      return () => faker.person.lastName();
    case 'internet.email':
      return () => faker.internet.email();
    case 'internet.url':
      return () => faker.internet.url();
    case 'phone.number':
      return () => faker.phone.number();
    case 'location.city':
      return () => faker.location.city();
    case 'location.country':
      return () => faker.location.country();
    case 'location.state':
      return () => faker.location.state();
    case 'location.zipCode':
      return () => faker.location.zipCode();
    case 'location.streetAddress':
      return () => faker.location.streetAddress();
    case 'company.name':
      return () => faker.company.name();
    case 'finance.amount':
      return () => faker.finance.amount({ dec: bounds.scale ?? 2 });
    case 'date.recent':
      return () => formatTemporal(faker.date.recent(), dataType);
    case 'date.birthdate':
      return () => formatTemporal(faker.date.birthdate(), dataType);
    case 'date.past':
      return () => formatTemporal(faker.date.past(), dataType);
    case 'lorem.sentence':
      return () => clamp(faker.lorem.sentence(), bounds.maxLength);
    case 'lorem.words':
      return () => clamp(faker.lorem.words(), bounds.maxLength);
    case 'lorem.slug':
      return () => clamp(faker.lorem.slug(), bounds.maxLength);
    case 'string.uuid':
      return () => faker.string.uuid();
    case 'datatype.boolean':
      return () => String(faker.datatype.boolean());
    case 'number.int':
      return () => randomIntText(faker, bounds);
    case 'json.object':
      return () =>
        JSON.stringify({
          note: faker.lorem.words(3),
          value: faker.number.int({ min: 0, max: 1000 }),
        });
    case 'binary.hex':
      return () => `0x${faker.string.hexadecimal({ length: 16, casing: 'lower', prefix: '' })}`;
  }
}

function resolveGenerator(
  faker: Faker,
  recipe: Recipe,
  bounds: TypeBounds,
  dataType: string,
): (rowIndex: number) => string | null {
  switch (recipe.kind) {
    case 'skip':
    case 'null':
      return () => null;
    case 'constant': {
      const value = recipe.value;
      return () => value;
    }
    case 'sequence': {
      const start = recipe.start;
      return (rowIndex) => String(start + rowIndex);
    }
    case 'faker': {
      // An Enum8/Enum16 column's real member set overrides whatever generator was proposed —
      // anything else is a guaranteed constraint violation on every single row.
      if (bounds.enumMembers && bounds.enumMembers.length > 0) {
        const members = bounds.enumMembers;
        return () => faker.helpers.arrayElement(members);
      }
      const call = fakerCall(faker, recipe.generatorId, bounds, dataType);
      return () => call();
    }
  }
}

interface ColumnGenerator {
  name: string;
  run: ((rowIndex: number) => string | null) | null; // null = omit this column entirely (skip)
}

function buildGenerators(faker: Faker, plans: ColumnPlan[]): ColumnGenerator[] {
  return plans.map((plan) => ({
    name: plan.column.name,
    run:
      plan.recipe.kind === 'skip'
        ? null
        : resolveGenerator(
            faker,
            plan.recipe,
            parseTypeBounds(plan.column.dataType),
            plan.column.dataType,
          ),
  }));
}

// D6: one batch, generated and released immediately — nothing here accumulates rows beyond the
// `count` this call is asked for, so peak renderer heap is one batch, not the whole run.
function generateBatch(
  generators: ColumnGenerator[],
  from: number,
  count: number,
): MutationRowOp[] {
  const ops: MutationRowOp[] = [];
  for (let i = 0; i < count; i++) {
    const rowIndex = from + i;
    const values: Record<string, string | null> = {};
    for (const g of generators) {
      if (!g.run) continue;
      values[g.name] = g.run(rowIndex);
    }
    ops.push({ kind: 'insert', values });
  }
  return ops;
}

// D10: the preview panel's own first-`count`-rows sample — re-seeds independently of a real run,
// so calling this and then runGeneration with the same `seed` produces byte-identical leading rows
// (faker.seed() fully resets the RNG stream each time it is called).
export async function previewFirstRows(
  plans: ColumnPlan[],
  seed: number,
  count: number,
): Promise<MutationRowOp[]> {
  const faker = await getFaker();
  faker.seed(seed);
  return generateBatch(buildGenerators(faker, plans), 0, count);
}

export class GenerationError extends Error {
  readonly committedRows: number;
  readonly code: string;
  constructor(message: string, code: string, committedRows: number) {
    super(message);
    this.code = code;
    this.committedRows = committedRows;
  }
}

export interface RunGenerationArgs {
  connectionId: string;
  path: string;
  tabId: string | null;
  plans: ColumnPlan[];
  total: number;
  seed: number;
  /** Fired right before each batch's data.mutate is sent, so the caller can capture the op id for
   *  a Stop button (D7 — commits otherwise have no op id to cancel at all, F4). */
  onBatchStart: (opId: string) => void;
  onProgress: (committedRows: number) => void;
  signal: AbortSignal;
}

// D6/D7: the whole run, one batch at a time — each its own data.mutate call (its own op id, its
// own place to fail), stopping at the first failure (or the caller's own cancellation) rather than
// retrying or resuming. `committedRows` on a thrown GenerationError is what the dialog reports
// alongside the server's own message.
export async function runGeneration(args: RunGenerationArgs): Promise<void> {
  const faker = await getFaker();
  faker.seed(args.seed);
  const generators = buildGenerators(faker, args.plans);

  let committed = 0;
  while (committed < args.total) {
    if (args.signal.aborted) return;
    const count = Math.min(BATCH_SIZE, args.total - committed);
    const ops = generateBatch(generators, committed, count);
    const opId = crypto.randomUUID();
    args.onBatchStart(opId);
    try {
      await data.mutate({
        opId,
        tabId: args.tabId,
        connectionId: args.connectionId,
        path: args.path,
        ops,
      });
    } catch (err) {
      const code = (err as { code?: string } | undefined)?.code ?? 'E_QUERY';
      const message = err instanceof Error ? err.message : String(err);
      throw new GenerationError(message, code, committed);
    }
    committed += count;
    args.onProgress(committed);
  }
}
