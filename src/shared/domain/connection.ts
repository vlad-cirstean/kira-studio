import { z } from 'zod';
import { capsSchema } from '../caps';

export const connectionKindSchema = z.enum([
  'postgres',
  'mariadb',
  'mongodb',
  'redis',
  'kafka',
  'sqs',
  's3',
]); // all v1 kinds; postgres (P1) and mariadb (P2) have adapters so far
export type ConnectionKind = z.infer<typeof connectionKindSchema>;

// The connection dialog's default port per kind (D27's "kind-driven default port", not a
// second hardcoded number per adapter). Kinds with no conventional default port are absent.
export const DEFAULT_PORT: Partial<Record<ConnectionKind, number>> = {
  postgres: 5432,
  mariadb: 3306,
  mongodb: 27017,
  redis: 6379,
  kafka: 9092,
};

export const connectionColorSchema = z.enum([
  'red',
  'orange',
  'amber',
  'olive',
  'green',
  'teal',
  'cyan',
  'blue',
  'indigo',
  'violet',
  'magenta',
  'grey',
]); // D18; matches --kira-conn-* in tokens.css
export type ConnectionColor = z.infer<typeof connectionColorSchema>;

export const connectionModeSchema = z.enum(['fields', 'uri']);
export type ConnectionMode = z.infer<typeof connectionModeSchema>;

// The plain object shape, with no refinement — kept separate so both connectionInputSchema
// (which adds the fields/uri superRefine below) and connectionSummarySchema (which cannot
// .omit() from a refined schema) can each build off it independently.
const connectionFieldsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  kind: connectionKindSchema,
  color: connectionColorSchema,
  mode: connectionModeSchema,
  readOnly: z.boolean(),
  host: z.string().trim().nullable(),
  port: z.number().int().min(1).max(65535).nullable(),
  database: z.string().nullable(),
  username: z.string().nullable(),
  password: z.string().nullable(), // present on the way IN only; never on the way OUT (D9)
  uri: z.string().nullable(),
  options: z.record(z.string(), z.unknown()),
  // P11: optional shell command run before connect (e.g. a port-forward). A first-class column
  // rather than an options_json key — options round-trips through the connection URI and the
  // Copy URI menu item, and a shell command must never be settable by pasting a URI.
  preconnect: z.string().trim().min(1).max(2000).nullable().default(null),
  // Misc-fixes: overrides P11/D5's settle-window auto-detection with an explicit per-connection
  // choice. false (default) = "run each time it tries to connect" — a fresh instance is spawned
  // on every connect attempt and its exit is never monitored, whether or not it happens to still
  // be alive at the settle window. true = "run once, and disconnect the db when it dies" — always
  // arm() once the adapter connects, regardless of what the settle-window race resolved to (a
  // no-op if the script already exited, since there's nothing left to monitor).
  preconnectSidecar: z.boolean().default(false),
});

export const connectionInputSchema = connectionFieldsSchema.superRefine((input, ctx) => {
  if (input.mode === 'fields') {
    // SQS has no host/port at all (P10's D8) — fields mode repurposes `database` for the AWS
    // region and `username` for the named profile instead, per §5.1's "named AWS profile" wording.
    if (input.kind !== 'sqs' && !input.host) {
      ctx.addIssue({ code: 'custom', path: ['host'], message: 'Host is required.' });
    }
    if (input.kind !== 'sqs' && !input.port) {
      ctx.addIssue({ code: 'custom', path: ['port'], message: 'Port is required.' });
    }
  } else {
    if (!input.uri || input.uri.trim() === '') {
      ctx.addIssue({ code: 'custom', path: ['uri'], message: 'A connection URI is required.' });
    }
  }
});

export type ConnectionInput = z.infer<typeof connectionInputSchema>;

// What the renderer gets. Note the absence of `password` — this is D9 enforced by the type.
export const connectionSummarySchema = connectionFieldsSchema.omit({ password: true }).extend({
  id: z.string(),
  sortOrder: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ConnectionSummary = z.infer<typeof connectionSummarySchema>;

export const connectionStatusSchema = z.enum(['disconnected', 'connecting', 'connected', 'error']);
export type ConnectionStatus = z.infer<typeof connectionStatusSchema>;

export const connectionStateSchema = z.object({
  connectionId: z.string(),
  status: connectionStatusSchema,
  serverVersion: z.string().nullable(),
  error: z.string().nullable(),
  since: z.number(), // epoch ms
  // Non-null only while connected — the toolbar's projection menu (Step 9) reads this to
  // decide whether server-side projection actually applies.
  caps: capsSchema.nullable(),
});
export type ConnectionState = z.infer<typeof connectionStateSchema>;
