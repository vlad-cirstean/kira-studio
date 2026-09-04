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
  // 'dynamic', and the send proceeds (D13).
  return (name: string): string | null => (isDynamicName(name) ? generate(name) : null);
}

/** D2's callback, resolved once per session and reused thereafter — the same memoised-promise
 *  shape `views/grid/fakeData/generate.ts`'s `getFaker()` uses, for the same reason. */
export function loadDynamicGenerator(): Promise<(name: string) => string | null> {
  if (!generatorPromise) generatorPromise = loadGenerators();
  return generatorPromise;
}
