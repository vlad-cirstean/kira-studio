// P6 D4/D5: the lazy half of the dynamic-value vocabulary — statically imports `./fakerEntry`
// (fine here: this module itself is reached only through `catalog.ts`'s dynamic `import()`), and
// exports one `Record<DynamicName, (f: Faker) => string>` entry per D4's catalogue.
//
// F12: this is the other half of the compile-time exhaustiveness guarantee `catalog.ts` sets up —
// `Record<DynamicName, ...>` over a `const`-asserted tuple's derived union means a tuple entry with
// no record line, or a record line whose key is not a tuple entry, is a `tsc` error, not something
// a test has to catch. That is why this file has no accompanying unit test (§6.2/AGENTS.md: a
// 58-entry map of one-line faker calls whose completeness the compiler already proves is exactly
// the "thin pass-through wrapper" category that earns nothing).
//
// F11: every call below was executed against the installed `@faker-js/faker@10.6.0` before being
// written down. The five that return a non-string (`$randomInt`, `$randomBoolean`,
// `$randomLatitude`, `$randomLongitude`) are `String(...)`-wrapped at the call site so the record's
// value type stays `() => string` throughout.
import type { DynamicName } from './catalog';
import { faker } from './fakerEntry';

type Faker = typeof faker;

export const GENERATORS: Record<DynamicName, (f: Faker) => string> = {
  $guid: (f) => f.string.uuid(),
  $randomUUID: (f) => f.string.uuid(),
  // D9: the clock, not the RNG — Postman defines both as reading the current time, so neither
  // goes through faker even though they live in this same lazy-loaded record (D7 explains why
  // they are not split into their own code path).
  $timestamp: () => String(Math.floor(Date.now() / 1000)),
  $isoTimestamp: () => new Date().toISOString(),
  $randomInt: (f) => String(f.number.int({ min: 0, max: 1000 })),
  $randomBoolean: (f) => String(f.datatype.boolean()),
  $randomAlphaNumeric: (f) => f.string.alphanumeric(),
  $randomColor: (f) => f.color.human(),
  $randomHexColor: (f) => f.color.rgb({ format: 'hex' }),
  $randomFirstName: (f) => f.person.firstName(),
  $randomLastName: (f) => f.person.lastName(),
  $randomFullName: (f) => f.person.fullName(),
  $randomNamePrefix: (f) => f.person.prefix(),
  $randomNameSuffix: (f) => f.person.suffix(),
  $randomJobTitle: (f) => f.person.jobTitle(),
  $randomPhoneNumber: (f) => f.phone.number(),
  $randomEmail: (f) => f.internet.email(),
  $randomExampleEmail: (f) => f.internet.exampleEmail(),
  $randomUserName: (f) => f.internet.username(),
  $randomPassword: (f) => f.internet.password(),
  $randomUrl: (f) => f.internet.url(),
  $randomDomainName: (f) => f.internet.domainName(),
  $randomDomainSuffix: (f) => f.internet.domainSuffix(),
  $randomProtocol: (f) => f.internet.protocol(),
  $randomIP: (f) => f.internet.ipv4(),
  $randomIPV6: (f) => f.internet.ipv6(),
  $randomMACAddress: (f) => f.internet.mac(),
  $randomUserAgent: (f) => f.internet.userAgent(),
  $randomSemver: (f) => f.system.semver(),
  $randomCity: (f) => f.location.city(),
  $randomCountry: (f) => f.location.country(),
  $randomCountryCode: (f) => f.location.countryCode(),
  $randomStreetAddress: (f) => f.location.streetAddress(),
  $randomLatitude: (f) => String(f.location.latitude()),
  $randomLongitude: (f) => String(f.location.longitude()),
  // D9: dates go through faker and are always ISO-formatted — an HTTP body wants a full
  // timestamp, not P15's column-type-dependent truncation (`generate.ts`'s `formatTemporal`).
  $randomDatePast: (f) => f.date.past().toISOString(),
  $randomDateFuture: (f) => f.date.future().toISOString(),
  $randomDateRecent: (f) => f.date.recent().toISOString(),
  $randomMonth: (f) => f.date.month(),
  $randomWeekday: (f) => f.date.weekday(),
  $randomCompanyName: (f) => f.company.name(),
  $randomCatchPhrase: (f) => f.company.catchPhrase(),
  $randomProductName: (f) => f.commerce.productName(),
  $randomDepartment: (f) => f.commerce.department(),
  $randomPrice: (f) => f.commerce.price(),
  $randomCurrencyCode: (f) => f.finance.currencyCode(),
  $randomBankAccount: (f) => f.finance.accountNumber(),
  $randomBitcoin: (f) => f.finance.bitcoinAddress(),
  $randomWord: (f) => f.word.sample(),
  $randomWords: (f) => f.word.words(),
  $randomLoremWord: (f) => f.lorem.word(),
  $randomLoremWords: (f) => f.lorem.words(),
  $randomLoremSentence: (f) => f.lorem.sentence(),
  $randomLoremParagraph: (f) => f.lorem.paragraph(),
  $randomLoremSlug: (f) => f.lorem.slug(),
  $randomFileName: (f) => f.system.fileName(),
  $randomFileExt: (f) => f.system.fileExt(),
  $randomMimeType: (f) => f.system.mimeType(),
};

/** `catalog.ts`'s own point of contact with this record — the faker instance lives only in this
 *  module (it is the one place `./fakerEntry` is statically imported), so this is the seam that
 *  lets `catalog.ts` stay faker-free at the type level while still calling into the record. */
export function generate(name: DynamicName): string {
  return GENERATORS[name](faker);
}
