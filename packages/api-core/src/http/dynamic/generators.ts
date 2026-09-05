// P6 D4/D5, re-keyed by P17 D12: the lazy half of the dynamic-value vocabulary — statically
// imports `./fakerEntry` (fine here: this module itself is reached only through `catalog.ts`'s
// dynamic `import()`), and exports one `Record<FakeName, (f: Faker) => string>` entry per D12's
// catalogue — one generator per faker capability, addressed by its `fake.module.method` name
// rather than by every Postman spelling that reaches it.
//
// F12/D12: this is the other half of the compile-time exhaustiveness guarantee `catalog.ts` sets
// up — `Record<FakeName, ...>` over a `const`-asserted tuple's derived union means a tuple entry
// with no record line, or a record line whose key is not a tuple entry, is a `tsc` error, not
// something a test has to catch. That is why this file has no accompanying unit test (§6.2/
// AGENTS.md: a 57-entry map of one-line faker calls whose completeness the compiler already
// proves is exactly the "thin pass-through wrapper" category that earns nothing).
//
// F11: every call below was executed against the installed `@faker-js/faker@10.6.0` before being
// written down. The five that return a non-string (`number.int`, `datatype.boolean`,
// `location.latitude`, `location.longitude`) are `String(...)`-wrapped at the call site so the
// record's value type stays `() => string` throughout.
import {
  ALIAS_TO_FAKE,
  type DynamicName,
  type FakeName,
  isDynamicName,
  isFakeName,
} from './catalog';
import { faker } from './fakerEntry';

type Faker = typeof faker;

export const GENERATORS: Record<FakeName, (f: Faker) => string> = {
  'fake.string.uuid': (f) => f.string.uuid(),
  // D9/D12: the clock, not the RNG — Postman defines both $timestamp/$isoTimestamp as reading the
  // current time, so neither goes through faker even though they live in this same lazy-loaded
  // record (D7 explains why they are not split into their own code path). The namespace's only
  // two non-faker entries (D12).
  'fake.date.timestamp': () => String(Math.floor(Date.now() / 1000)),
  'fake.date.iso': () => new Date().toISOString(),
  'fake.number.int': (f) => String(f.number.int({ min: 0, max: 1000 })),
  'fake.datatype.boolean': (f) => String(f.datatype.boolean()),
  'fake.string.alphanumeric': (f) => f.string.alphanumeric(),
  'fake.color.human': (f) => f.color.human(),
  'fake.color.rgbHex': (f) => f.color.rgb({ format: 'hex' }),
  'fake.person.firstName': (f) => f.person.firstName(),
  'fake.person.lastName': (f) => f.person.lastName(),
  'fake.person.fullName': (f) => f.person.fullName(),
  'fake.person.prefix': (f) => f.person.prefix(),
  'fake.person.suffix': (f) => f.person.suffix(),
  'fake.person.jobTitle': (f) => f.person.jobTitle(),
  'fake.phone.number': (f) => f.phone.number(),
  'fake.internet.email': (f) => f.internet.email(),
  'fake.internet.exampleEmail': (f) => f.internet.exampleEmail(),
  'fake.internet.username': (f) => f.internet.username(),
  'fake.internet.password': (f) => f.internet.password(),
  'fake.internet.url': (f) => f.internet.url(),
  'fake.internet.domainName': (f) => f.internet.domainName(),
  'fake.internet.domainSuffix': (f) => f.internet.domainSuffix(),
  'fake.internet.protocol': (f) => f.internet.protocol(),
  'fake.internet.ipv4': (f) => f.internet.ipv4(),
  'fake.internet.ipv6': (f) => f.internet.ipv6(),
  'fake.internet.mac': (f) => f.internet.mac(),
  'fake.internet.userAgent': (f) => f.internet.userAgent(),
  'fake.system.semver': (f) => f.system.semver(),
  'fake.location.city': (f) => f.location.city(),
  'fake.location.country': (f) => f.location.country(),
  'fake.location.countryCode': (f) => f.location.countryCode(),
  'fake.location.streetAddress': (f) => f.location.streetAddress(),
  'fake.location.latitude': (f) => String(f.location.latitude()),
  'fake.location.longitude': (f) => String(f.location.longitude()),
  // D9: dates go through faker and are always ISO-formatted — an HTTP body wants a full
  // timestamp, not P15's column-type-dependent truncation (`generate.ts`'s `formatTemporal`).
  'fake.date.past': (f) => f.date.past().toISOString(),
  'fake.date.future': (f) => f.date.future().toISOString(),
  'fake.date.recent': (f) => f.date.recent().toISOString(),
  'fake.date.month': (f) => f.date.month(),
  'fake.date.weekday': (f) => f.date.weekday(),
  'fake.company.name': (f) => f.company.name(),
  'fake.company.catchPhrase': (f) => f.company.catchPhrase(),
  'fake.commerce.productName': (f) => f.commerce.productName(),
  'fake.commerce.department': (f) => f.commerce.department(),
  'fake.commerce.price': (f) => f.commerce.price(),
  'fake.finance.currencyCode': (f) => f.finance.currencyCode(),
  'fake.finance.accountNumber': (f) => f.finance.accountNumber(),
  'fake.finance.bitcoinAddress': (f) => f.finance.bitcoinAddress(),
  'fake.word.sample': (f) => f.word.sample(),
  'fake.word.words': (f) => f.word.words(),
  'fake.lorem.word': (f) => f.lorem.word(),
  'fake.lorem.words': (f) => f.lorem.words(),
  'fake.lorem.sentence': (f) => f.lorem.sentence(),
  'fake.lorem.paragraph': (f) => f.lorem.paragraph(),
  'fake.lorem.slug': (f) => f.lorem.slug(),
  'fake.system.fileName': (f) => f.system.fileName(),
  'fake.system.fileExt': (f) => f.system.fileExt(),
  'fake.system.mimeType': (f) => f.system.mimeType(),
};

/** `catalog.ts`'s own point of contact with this record — the faker instance lives only in this
 *  module (it is the one place `./fakerEntry` is statically imported), so this is the seam that
 *  lets `catalog.ts` stay faker-free at the type level while still calling into the record.
 *
 *  D12: accepts either spelling — a Postman `$name` (resolved through `ALIAS_TO_FAKE` first) or a
 *  `fake.` name directly — and returns `null` for anything else, matching D13's "an uncatalogued
 *  name behaves exactly as if no generator were supplied" contract. */
export function generate(name: string): string | null {
  const fakeName: FakeName | undefined = isDynamicName(name)
    ? ALIAS_TO_FAKE[name as DynamicName]
    : isFakeName(name)
      ? name
      : undefined;
  return fakeName ? GENERATORS[fakeName](faker) : null;
}
