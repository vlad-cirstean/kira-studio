import { z } from 'zod';

export const kibanaLanguageSchema = /*#__PURE__*/ z.enum(['kuery', 'lucene']);
export type KibanaLanguage = z.infer<typeof kibanaLanguageSchema>;

export const kibanaIntervalSchema = /*#__PURE__*/ z.enum(['auto', 'm', 'h', 'd', 'w', 'M', 'y']);
export type KibanaInterval = z.infer<typeof kibanaIntervalSchema>;

export const kibanaFieldSchema = /*#__PURE__*/ z.object({
  name: z.string(),
  type: z.string(),
  esTypes: z.array(z.string()),
  searchable: z.boolean(),
  aggregatable: z.boolean(),
  nested: z.string().nullable(),
  multiParent: z.string().nullable(),
  runtime: z.boolean(),
});
export type KibanaField = z.infer<typeof kibanaFieldSchema>;

export const kibanaDataViewSummarySchema = /*#__PURE__*/ z.object({
  id: z.string(),
  name: z.string(),
  title: z.string(),
  timeFieldName: z.string().nullable(),
});
export type KibanaDataViewSummary = z.infer<typeof kibanaDataViewSummarySchema>;

export const kibanaDataViewSchema = /*#__PURE__*/ kibanaDataViewSummarySchema.extend({
  fields: z.array(kibanaFieldSchema),
});
export type KibanaDataView = z.infer<typeof kibanaDataViewSchema>;

export const kibanaTimeRangeSchema = /*#__PURE__*/ z.object({ from: z.string(), to: z.string() });
export type KibanaTimeRange = z.infer<typeof kibanaTimeRangeSchema>;

export const KIBANA_FILTER_OPERATORS = [
  'is',
  'is_not',
  'is_one_of',
  'is_not_one_of',
  'exists',
  'does_not_exist',
  'between',
] as const;
export const kibanaFilterOperatorSchema = /*#__PURE__*/ z.enum(KIBANA_FILTER_OPERATORS);
export type KibanaFilterOperator = z.infer<typeof kibanaFilterOperatorSchema>;

export const kibanaFilterSchema = /*#__PURE__*/ z.object({
  field: z.string(),
  operator: kibanaFilterOperatorSchema,
  values: z.array(z.string()),
  disabled: z.boolean(),
});
export type KibanaFilter = z.infer<typeof kibanaFilterSchema>;

export const kibanaSortSchema = /*#__PURE__*/ z.object({
  field: z.string(),
  order: z.enum(['asc', 'desc']),
});
export type KibanaSort = z.infer<typeof kibanaSortSchema>;

/** The statement text of an execute() on a kibana connection. Mirrors Go's DisallowUnknownFields. */
export const kibanaDiscoverRequestSchema = /*#__PURE__*/ z
  .object({
    dataView: z.string(),
    query: z.string(),
    language: kibanaLanguageSchema,
    timeRange: kibanaTimeRangeSchema.nullable(),
    filters: z.array(kibanaFilterSchema),
    sort: z.array(kibanaSortSchema),
    size: z.number().int().min(0),
    timeZone: z.string(),
  })
  .strict();
export type KibanaDiscoverRequest = z.infer<typeof kibanaDiscoverRequestSchema>;

export const kibanaHistogramSchema = /*#__PURE__*/ z.object({
  total: z.number(),
  relation: z.enum(['eq', 'gte']),
  interval: z.string(),
  buckets: z.array(z.object({ key: z.number(), count: z.number() })),
});
export type KibanaHistogram = z.infer<typeof kibanaHistogramSchema>;

export const kibanaSuggestionsSchema = /*#__PURE__*/ z.object({
  values: z.array(z.string()),
  complete: z.boolean(),
});
export type KibanaSuggestions = z.infer<typeof kibanaSuggestionsSchema>;

export const kibanaTimePresetSchema = /*#__PURE__*/ z.enum([
  'last15m',
  'last30m',
  'last1h',
  'last4h',
  'last12h',
  'last24h',
  'last7d',
  'last30d',
  'last90d',
  'last1y',
  'today',
  'thisWeek',
  'thisMonth',
  'thisYear',
]);
export type KibanaTimePreset = z.infer<typeof kibanaTimePresetSchema>;

export const kibanaTimeSelectionSchema = /*#__PURE__*/ z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('preset'), preset: kibanaTimePresetSchema }),
  z.object({ mode: z.literal('absolute'), from: z.string(), to: z.string() }),
]);
export type KibanaTimeSelection = z.infer<typeof kibanaTimeSelectionSchema>;

export const KIBANA_SAMPLE_SIZES = [100, 500, 1000, 5000, 10000] as const;

/** Per-tab Discover state. The query text lives in the console tab's own `text`. */
export const kibanaConsoleStateSchema = /*#__PURE__*/ z.object({
  dataViewId: z.string().nullable().default(null),
  // The view's display name, for the tab title; the id (often a uuid) is not worth showing.
  dataViewName: z.string().nullable().default(null),
  language: kibanaLanguageSchema.default('kuery'),
  time: kibanaTimeSelectionSchema.default({ mode: 'preset', preset: 'last15m' }),
  filters: z.array(kibanaFilterSchema).default([]),
  sort: z.array(kibanaSortSchema).default([]),
  sampleSize: z
    .union([z.literal(100), z.literal(500), z.literal(1000), z.literal(5000), z.literal(10000)])
    .default(500),
  interval: kibanaIntervalSchema.default('auto'),
});
export type KibanaConsoleState = z.infer<typeof kibanaConsoleStateSchema>;
