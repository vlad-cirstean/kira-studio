import { z } from 'zod';

// P25: what the app can tell the user about where credentials are kept. Reported by main once at
// startup (secret-cipher.ts's one `safeStorage` probe, D1) and never changes for the life of the
// process.
export const secretStorageStatusSchema = /*#__PURE__*/ z.object({
  available: z.boolean(),
  backend: /*#__PURE__*/ z.enum(['keychain', 'basic_text', 'unavailable']),
  /** True only for the Linux development fallback (D13). Always false on darwin. */
  insecureFallback: z.boolean(),
  /** One sentence, shown verbatim in the connection dialog; null when `available`. */
  reason: z.string().nullable(),
});
export type SecretStorageStatus = z.infer<typeof secretStorageStatusSchema>;
