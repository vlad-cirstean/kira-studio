import { z } from 'zod';

// P212: the Mobile access pane's domain. bridge/mobile.go never carries a token or hash across
// this boundary.

export const mobileDeviceSchema = /*#__PURE__*/ z.object({
  id: z.string(),
  label: z.string(),
  userAgent: z.string(),
  createdAt: z.number(),
  lastSeenAt: z.number(),
  lastIp: z.string(),
  revokedAt: z.number().nullable(),
  /** Change the backlog and move or start tasks. Set from the desktop pane. */
  canWrite: z.boolean(),
  /** Reply to agents and control their terminals. Needs the global switch too. */
  canAgentInput: z.boolean(),
});
export type MobileDevice = z.infer<typeof mobileDeviceSchema>;

export const mobileStatusSchema = /*#__PURE__*/ z.object({
  enabled: z.boolean(),
  running: z.boolean(),
  httpsPort: z.number(),
  setupPort: z.number(),
  appUrls: z.array(z.string()),
  setupUrls: z.array(z.string()),
  /** SHA-256 of the local CA certificate, shown so the user can compare it on the phone. */
  fingerprint: z.string(),
  leafExpiresAt: z.number(),
  /** Global switch: phones may reply to agents and control their terminals. */
  agentInput: z.boolean(),
  error: z.string(),
});
export type MobileStatus = z.infer<typeof mobileStatusSchema>;

export const mobilePairingRequestSchema = /*#__PURE__*/ z.object({
  requestId: z.string(),
  clientId: z.string(),
  /** Phone-reported, not verified. */
  label: z.string(),
  /** Four digits the phone shows too, to tell this request from another device's. */
  code: z.string(),
  remoteIp: z.string(),
  userAgent: z.string(),
  expiresAtMs: z.number(),
});
export type MobilePairingRequest = z.infer<typeof mobilePairingRequestSchema>;

export const mobilePairingSnapshotSchema = /*#__PURE__*/ z.object({
  pending: mobilePairingRequestSchema.nullable(),
  queued: z.number(),
});
export type MobilePairingSnapshot = z.infer<typeof mobilePairingSnapshotSchema>;

export const mobilePairingActionResultSchema = /*#__PURE__*/ z.object({
  result: /*#__PURE__*/ z.enum(['resolved', 'alreadyResolved', 'expired']),
});
export type MobilePairingActionResult = z.infer<typeof mobilePairingActionResultSchema>;

export const mobileTerminalHoldSchema = /*#__PURE__*/ z.object({
  terminalId: z.string(),
  sessionId: z.string(),
  deviceId: z.string(),
  label: z.string(),
  connected: z.boolean(),
  since: z.number(),
  /** When an offline hold falls back to the desktop; 0 while connected. */
  returnsAt: z.number(),
});
export type MobileTerminalHold = z.infer<typeof mobileTerminalHoldSchema>;
