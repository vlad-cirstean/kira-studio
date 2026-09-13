import type { Caps } from '@shared/caps';
import type { MutationRowOp } from '@shared/domain/mutations';
import { data } from '../../../bridge/data';
import type { SqlDialect } from '../../shared/sqlIdent';
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

// F7/P21 round 1: the ISO-8601-with-`Z` fall-through is correct for Postgres (format_type's own
// `timestamp without/with time zone`, both of which accept it) and harmless for SQLite (text
// storage) — it is wrong for the mysql family, where `dataType` is COLUMN_TYPE: `datetime`/
// `timestamp` reject the trailing `Z` outright in strict mode (Incorrect datetime value) or
// truncate/mangle it otherwise, and `year` against a full ISO string is unambiguous — there is no
// reading under which it works. ClickHouse's DateTime/DateTime64 text format is the same
// space-separated shape as mysql's, for the same reason (no `T`/`Z`).
export function formatTemporal(
  dateValue: Date,
  dataType: string,
  dialect: SqlDialect | undefined,
): string {
  const lower = dataType.toLowerCase();
  if (lower === 'date') return dateValue.toISOString().slice(0, 10);
  if (lower.startsWith('time') && !lower.startsWith('timestamp')) {
    return dateValue.toISOString().slice(11, 19);
  }
  if (dialect === 'mysql' || dialect === 'clickhouse') {
    if (lower.startsWith('year')) return String(dateValue.getUTCFullYear());
    // 'YYYY-MM-DD HH:MM:SS' — mysql's/ClickHouse's own accepted text format, no 'T'/'Z'.
    return dateValue.toISOString().replace('T', ' ').slice(0, 19);
  }
  return dateValue.toISOString();
}

function fakerCall(
  faker: Faker,
  id: GeneratorId,
  bounds: TypeBounds,
  dataType: string,
  dialect: SqlDialect | undefined,
): () => string {
  switch (id) {
    // P21 round 3 functional finding 1: every one of these text generators used to return
    // faker's raw output with no reference to bounds.maxLength, even though it is already parsed
    // out of the column's own varchar(n)/char(n)/nvarchar(n)/FixedString(n) declaration and
    // handed in here. A value even one character over the column's declared length aborted the
    // whole batch (`value too long for type character varying(n)`) with committedRows = 0 and
    // nothing in the plan warning it could happen — clamp bounds every case the same way the
    // three lorem.* generators already were.
    case 'person.fullName':
      return () => clamp(faker.person.fullName(), bounds.maxLength);
    case 'person.firstName':
      return () => clamp(faker.person.firstName(), bounds.maxLength);
    case 'person.lastName':
      return () => clamp(faker.person.lastName(), bounds.maxLength);
    case 'internet.email':
      return () => clamp(faker.internet.email(), bounds.maxLength);
    case 'internet.url':
      return () => clamp(faker.internet.url(), bounds.maxLength);
    case 'phone.number':
      return () => clamp(faker.phone.number(), bounds.maxLength);
    case 'location.city':
      return () => clamp(faker.location.city(), bounds.maxLength);
    case 'location.country':
      return () => clamp(faker.location.country(), bounds.maxLength);
    case 'location.state':
      return () => clamp(faker.location.state(), bounds.maxLength);
    case 'location.zipCode':
      return () => clamp(faker.location.zipCode(), bounds.maxLength);
    case 'location.streetAddress':
      return () => clamp(faker.location.streetAddress(), bounds.maxLength);
    case 'company.name':
      return () => clamp(faker.company.name(), bounds.maxLength);
    case 'finance.amount':
      // P21 round 3 functional finding 2: finance.amount is offered (and name-heuristic-matched
      // via price/amount/total/cost/salary) for both text and number columns, but used to ignore
      // the column's own numeric bounds entirely — faker's default 0..1000 range with 2 decimals
      // overflows a narrow numeric(p,s) and isn't even syntactically valid for an integer column.
      // An int/bigint/smallint column (bounds.intRange) gets a real integer via the already
      // bounds-aware randomIntText instead of a decimal string; a numeric(p,s) column's max is
      // derived from precision - scale (the digits available before the decimal point), capped so
      // the float arithmetic behind faker's own `max` option never runs into precision loss for a
      // very large declared precision.
      if (bounds.intRange) return () => randomIntText(faker, bounds);
      if (bounds.precision !== undefined) {
        const dec = bounds.scale ?? 0;
        const wholeDigits = Math.max(1, Math.min(bounds.precision - dec, 15));
        return () => faker.finance.amount({ dec, max: 10 ** wholeDigits - 1 });
      }
      return () => clamp(faker.finance.amount({ dec: bounds.scale ?? 2 }), bounds.maxLength);
    case 'date.recent':
      return () => formatTemporal(faker.date.recent(), dataType, dialect);
    case 'date.birthdate':
      return () => formatTemporal(faker.date.birthdate(), dataType, dialect);
    case 'date.past':
      return () => formatTemporal(faker.date.past(), dataType, dialect);
    case 'lorem.sentence':
      return () => clamp(faker.lorem.sentence(), bounds.maxLength);
    case 'lorem.words':
      return () => clamp(faker.lorem.words(), bounds.maxLength);
    case 'lorem.slug':
      return () => clamp(faker.lorem.slug(), bounds.maxLength);
    case 'string.uuid':
      return () => clamp(faker.string.uuid(), bounds.maxLength);
    case 'datatype.boolean':
      return () => String(faker.datatype.boolean());
    case 'number.int':
      return () => randomIntText(faker, bounds);
    case 'json.object':
      return () =>
        clamp(
          JSON.stringify({
            note: faker.lorem.words(3),
            value: faker.number.int({ min: 0, max: 1000 }),
          }),
          bounds.maxLength,
        );
    case 'binary.hex': {
      // P21 round 3 functional finding 1: the hex length was a fixed 16 (8 bytes) regardless of
      // the column's own declared length — derive it from bounds.maxLength (never more than the
      // previous fixed default) when known, one byte minimum.
      const hexLength =
        bounds.maxLength !== undefined ? Math.max(2, Math.min(16, bounds.maxLength * 2)) : 16;
      return () =>
        `0x${faker.string.hexadecimal({ length: hexLength, casing: 'lower', prefix: '' })}`;
    }
  }
}

function resolveGenerator(
  faker: Faker,
  recipe: Recipe,
  bounds: TypeBounds,
  dataType: string,
  dialect: SqlDialect | undefined,
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
      const call = fakerCall(faker, recipe.generatorId, bounds, dataType, dialect);
      return () => call();
    }
  }
}

interface ColumnGenerator {
  name: string;
  run: ((rowIndex: number) => string | null) | null; // null = omit this column entirely (skip)
}

function buildGenerators(
  faker: Faker,
  plans: ColumnPlan[],
  dialect: SqlDialect | undefined,
): ColumnGenerator[] {
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
            dialect,
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
  dialect: SqlDialect | undefined,
): Promise<MutationRowOp[]> {
  const faker = await getFaker();
  faker.seed(seed);
  return generateBatch(buildGenerators(faker, plans, dialect), 0, count);
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
  dialect: SqlDialect | undefined;
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
  const generators = buildGenerators(faker, args.plans, args.dialect);

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
