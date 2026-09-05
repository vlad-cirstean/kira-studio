// P6 D4/D5: the eager half of the dynamic-value vocabulary — names only, imports nothing from
// `@faker-js/faker`, so nothing about this module being statically imported (by the live-preview
// chip, D8) pulls faker or its generators into the boot bundle. `generators.ts` is the lazy half.
//
// D4: 58 names, Postman's own `$name` spellings — verified against the installed
// `@faker-js/faker@10.6.0` before being written down (F11), not invented. Adopting Postman's
// spellings is what makes a `{{$randomEmail}}` reference imported from a real Postman collection
// keep working here, for the same reason it works there (F6). Case-sensitive, exact match:
// `{{$randomemail}}` is not `{{$randomEmail}}` and is reported as an unknown dynamic value (D13) —
// a case-insensitive lookup would make `{{$RANDOMEMAIL}}` work here and fail in Postman.
//
// What is deliberately excluded, and why, is enumerated in the plan (docs/v1.2/plans/
// P6-faker-dynamic-values.md, D4) rather than repeated here: the ~17-name image family (faker only
// has two image calls), the `$randomBs*`/word-fragment families (faker 10 removed `company.bs*`),
// `$randomArrayElement`/`$randomObjectElement` (meaningless without argument syntax, D10), names
// with no single-call faker mapping (`$randomStreetName`, `$randomAirport`), names that fail the
// "plausibly useful in a request" half of the inclusion rule rather than the "faker can produce it"
// half, and `$randomCreditCardMask` (faker's nearest call returns a full number, not a masked tail
// — a name that quietly means something else is worse than a missing name).
export const DYNAMIC_NAMES = [
  '$guid',
  '$randomUUID',
  '$timestamp',
  '$isoTimestamp',
  '$randomInt',
  '$randomBoolean',
  '$randomAlphaNumeric',
  '$randomColor',
  '$randomHexColor',
  '$randomFirstName',
  '$randomLastName',
  '$randomFullName',
  '$randomNamePrefix',
  '$randomNameSuffix',
  '$randomJobTitle',
  '$randomPhoneNumber',
  '$randomEmail',
  '$randomExampleEmail',
  '$randomUserName',
  '$randomPassword',
  '$randomUrl',
  '$randomDomainName',
  '$randomDomainSuffix',
  '$randomProtocol',
  '$randomIP',
  '$randomIPV6',
  '$randomMACAddress',
  '$randomUserAgent',
  '$randomSemver',
  '$randomCity',
  '$randomCountry',
  '$randomCountryCode',
  '$randomStreetAddress',
  '$randomLatitude',
  '$randomLongitude',
  '$randomDatePast',
  '$randomDateFuture',
  '$randomDateRecent',
  '$randomMonth',
  '$randomWeekday',
  '$randomCompanyName',
  '$randomCatchPhrase',
  '$randomProductName',
  '$randomDepartment',
  '$randomPrice',
  '$randomCurrencyCode',
  '$randomBankAccount',
  '$randomBitcoin',
  '$randomWord',
  '$randomWords',
  '$randomLoremWord',
  '$randomLoremWords',
  '$randomLoremSentence',
  '$randomLoremParagraph',
  '$randomLoremSlug',
  '$randomFileName',
  '$randomFileExt',
  '$randomMimeType',
] as const;

export type DynamicName = (typeof DYNAMIC_NAMES)[number];

// F12: the compiler-checked half of the exhaustiveness guarantee — `generators.ts`'s
// `Record<DynamicName, ...>` is the other half. A name added here with no entry there fails
// `tsc` with a missing-property error; an entry there with a key not here fails with an
// excess-property error. Neither drift is a test's job.
const DYNAMIC_NAME_SET: ReadonlySet<string> = new Set(DYNAMIC_NAMES);

export function isDynamicName(name: string): name is DynamicName {
  return DYNAMIC_NAME_SET.has(name);
}

// P17 D12: the `fake.` namespace — faker's own module.method paths, additive and permanent
// alongside the `$name` spellings above (never migrated, never rewritten in a stored request —
// see the doc comment below). This is not a new vocabulary invented for this app: it is the
// literal `GeneratorId` spelling `views/grid/fakeData/recipes.ts` already uses one directory over
// (F5), prefixed with `fake.`.
//
// 57 entries, one per DYNAMIC_NAMES entry except `$guid`/`$randomUUID`, which both alias
// `fake.string.uuid` — a single faker call reached by two Postman spellings collapses to one
// `fake.` spelling, not two. `$timestamp`/`$isoTimestamp` are the namespace's only two non-faker
// entries (`fake.date.timestamp`/`fake.date.iso`) — they read the clock, not the RNG (P6 D9), and
// faker has no path for them, but a user reaching for date/time generators would look for them
// here regardless.
export const FAKE_NAMES = [
  'fake.string.uuid',
  'fake.date.timestamp',
  'fake.date.iso',
  'fake.number.int',
  'fake.datatype.boolean',
  'fake.string.alphanumeric',
  'fake.color.human',
  'fake.color.rgbHex',
  'fake.person.firstName',
  'fake.person.lastName',
  'fake.person.fullName',
  'fake.person.prefix',
  'fake.person.suffix',
  'fake.person.jobTitle',
  'fake.phone.number',
  'fake.internet.email',
  'fake.internet.exampleEmail',
  'fake.internet.username',
  'fake.internet.password',
  'fake.internet.url',
  'fake.internet.domainName',
  'fake.internet.domainSuffix',
  'fake.internet.protocol',
  'fake.internet.ipv4',
  'fake.internet.ipv6',
  'fake.internet.mac',
  'fake.internet.userAgent',
  'fake.system.semver',
  'fake.location.city',
  'fake.location.country',
  'fake.location.countryCode',
  'fake.location.streetAddress',
  'fake.location.latitude',
  'fake.location.longitude',
  'fake.date.past',
  'fake.date.future',
  'fake.date.recent',
  'fake.date.month',
  'fake.date.weekday',
  'fake.company.name',
  'fake.company.catchPhrase',
  'fake.commerce.productName',
  'fake.commerce.department',
  'fake.commerce.price',
  'fake.finance.currencyCode',
  'fake.finance.accountNumber',
  'fake.finance.bitcoinAddress',
  'fake.word.sample',
  'fake.word.words',
  'fake.lorem.word',
  'fake.lorem.words',
  'fake.lorem.sentence',
  'fake.lorem.paragraph',
  'fake.lorem.slug',
  'fake.system.fileName',
  'fake.system.fileExt',
  'fake.system.mimeType',
] as const;

export type FakeName = (typeof FAKE_NAMES)[number];

const FAKE_NAME_SET: ReadonlySet<string> = new Set(FAKE_NAMES);

export function isFakeName(name: string): name is FakeName {
  return FAKE_NAME_SET.has(name);
}

// D12: every $name mapped onto the fake. name that produces the identical value — the compiler
// (not a test) proves this exhaustive: a DynamicName with no entry here, or an entry whose value
// is not a real FakeName, is a tsc error (F5's own exhaustiveness guarantee, extended).
export const ALIAS_TO_FAKE: Record<DynamicName, FakeName> = {
  $guid: 'fake.string.uuid',
  $randomUUID: 'fake.string.uuid',
  $timestamp: 'fake.date.timestamp',
  $isoTimestamp: 'fake.date.iso',
  $randomInt: 'fake.number.int',
  $randomBoolean: 'fake.datatype.boolean',
  $randomAlphaNumeric: 'fake.string.alphanumeric',
  $randomColor: 'fake.color.human',
  $randomHexColor: 'fake.color.rgbHex',
  $randomFirstName: 'fake.person.firstName',
  $randomLastName: 'fake.person.lastName',
  $randomFullName: 'fake.person.fullName',
  $randomNamePrefix: 'fake.person.prefix',
  $randomNameSuffix: 'fake.person.suffix',
  $randomJobTitle: 'fake.person.jobTitle',
  $randomPhoneNumber: 'fake.phone.number',
  $randomEmail: 'fake.internet.email',
  $randomExampleEmail: 'fake.internet.exampleEmail',
  $randomUserName: 'fake.internet.username',
  $randomPassword: 'fake.internet.password',
  $randomUrl: 'fake.internet.url',
  $randomDomainName: 'fake.internet.domainName',
  $randomDomainSuffix: 'fake.internet.domainSuffix',
  $randomProtocol: 'fake.internet.protocol',
  $randomIP: 'fake.internet.ipv4',
  $randomIPV6: 'fake.internet.ipv6',
  $randomMACAddress: 'fake.internet.mac',
  $randomUserAgent: 'fake.internet.userAgent',
  $randomSemver: 'fake.system.semver',
  $randomCity: 'fake.location.city',
  $randomCountry: 'fake.location.country',
  $randomCountryCode: 'fake.location.countryCode',
  $randomStreetAddress: 'fake.location.streetAddress',
  $randomLatitude: 'fake.location.latitude',
  $randomLongitude: 'fake.location.longitude',
  $randomDatePast: 'fake.date.past',
  $randomDateFuture: 'fake.date.future',
  $randomDateRecent: 'fake.date.recent',
  $randomMonth: 'fake.date.month',
  $randomWeekday: 'fake.date.weekday',
  $randomCompanyName: 'fake.company.name',
  $randomCatchPhrase: 'fake.company.catchPhrase',
  $randomProductName: 'fake.commerce.productName',
  $randomDepartment: 'fake.commerce.department',
  $randomPrice: 'fake.commerce.price',
  $randomCurrencyCode: 'fake.finance.currencyCode',
  $randomBankAccount: 'fake.finance.accountNumber',
  $randomBitcoin: 'fake.finance.bitcoinAddress',
  $randomWord: 'fake.word.sample',
  $randomWords: 'fake.word.words',
  $randomLoremWord: 'fake.lorem.word',
  $randomLoremWords: 'fake.lorem.words',
  $randomLoremSentence: 'fake.lorem.sentence',
  $randomLoremParagraph: 'fake.lorem.paragraph',
  $randomLoremSlug: 'fake.lorem.slug',
  $randomFileName: 'fake.system.fileName',
  $randomFileExt: 'fake.system.fileExt',
  $randomMimeType: 'fake.system.mimeType',
};

// D5/D7: memoised at module scope, exactly `views/grid/fakeData/generate.ts`'s `getFaker()`
// technique — a dynamic `import('./generators')`, so nothing about this module being eager pulls
// the generators, or faker, into the boot bundle. Only the first call in a session (a send that
// references a dynamic value, or the reference dialog's own open) pays the parse.
let generatorPromise: Promise<(name: string) => string | null> | null = null;

async function loadGenerators(): Promise<(name: string) => string | null> {
  const { generate } = await import('./generators');
  // D13: a name outside the catalogue — a typo, an excluded Postman name, or an argument form
  // D10 does not parse — returns null rather than throwing. resolve()'s caller (D2) treats that
  // exactly like having supplied no callback at all: the reference is left verbatim and classified
  // 'dynamic', and the send proceeds (D13). D12: `generate` itself accepts both spellings — a
  // `$name` (resolved through ALIAS_TO_FAKE) and a `fake.` name directly — so this wrapper needs
  // no branch of its own beyond what `generate` already returns.
  return (name: string): string | null => generate(name);
}

/** D2's callback, resolved once per session and reused thereafter — the same memoised-promise
 *  shape `views/grid/fakeData/generate.ts`'s `getFaker()` uses, for the same reason. */
export function loadDynamicGenerator(): Promise<(name: string) => string | null> {
  if (!generatorPromise) generatorPromise = loadGenerators();
  return generatorPromise;
}
