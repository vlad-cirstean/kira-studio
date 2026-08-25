import { z } from 'zod';
import { capsSchema } from '../caps';

export const connectionKindSchema = z.enum([
  'postgres',
  'mariadb',
  'mysql',
  'sqlite',
  'clickhouse',
  'mongodb',
  'redis',
  'kafka',
  'sqs',
  's3',
]); // all v1 kinds; every one has an adapter as of P36
export type ConnectionKind = z.infer<typeof connectionKindSchema>;

// The connection dialog's default port per kind (D27's "kind-driven default port", not a
// second hardcoded number per adapter). Kinds with no conventional default port are absent.
export const DEFAULT_PORT: Partial<Record<ConnectionKind, number>> = {
  postgres: 5432,
  mariadb: 3306,
  mysql: 3306,
  // P36 D10: the HTTP interface, not the native protocol's 9000 — the only port the app's driver
  // (@clickhouse/client, HTTP-only) can ever speak to.
  clickhouse: 8123,
  mongodb: 27017,
  redis: 6379,
  kafka: 9092,
};

export const connectionColorSchema = z.enum([
  'none',
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
]); // D18; matches --kira-conn-* in tokens.css. 'none' is a real, stored value (the P16 design
// system's default — "no colour is the default, the rail slot stays reserved either way") rather
// than the field being nullable, so no DB/schema change is needed to add it.
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

// SQS and S3 have no host/port at all (P10's D8, P17's own D8/D9 mirror) — fields mode repurposes
// `database` for the AWS region and `username` for the named profile instead, per §5.1's "named
// AWS profile" wording.
export const AWS_STYLE_KINDS: ReadonlySet<ConnectionKind> = new Set(['sqs', 's3']);

// Kinds whose "connection" is a local file path, not a network endpoint (P35 D10/D11). Fields
// mode repurposes `database` for the absolute path; host/port/username/password are unused.
export const FILE_KINDS: ReadonlySet<ConnectionKind> = new Set(['sqlite']);

export const connectionInputSchema = connectionFieldsSchema.superRefine((input, ctx) => {
  if (input.mode === 'fields') {
    if (FILE_KINDS.has(input.kind)) {
      const path = input.database?.trim() ?? '';
      if (!path) {
        ctx.addIssue({
          code: 'custom',
          path: ['database'],
          message: 'A database file is required.',
        });
      } else if (!path.startsWith('/')) {
        ctx.addIssue({
          code: 'custom',
          path: ['database'],
          message: 'The database file must be an absolute path.',
        });
      }
    } else {
      if (!AWS_STYLE_KINDS.has(input.kind) && !input.host) {
        ctx.addIssue({ code: 'custom', path: ['host'], message: 'Host is required.' });
      }
      if (!AWS_STYLE_KINDS.has(input.kind) && !input.port) {
        ctx.addIssue({ code: 'custom', path: ['port'], message: 'Port is required.' });
      }
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
