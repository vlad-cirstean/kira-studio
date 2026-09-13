import { z } from 'zod';

// G1 SPEC §3.3/D19: the *Connected editors* pane's own domain — a paired VS Code extension, and
// the live pairing-approval queue. Both are pure display/action types (bridge/gitclients.go never
// carries a token or a hash across this boundary), so there is nothing here to decrypt or reveal.

export const gitClientSchema = /*#__PURE__*/ z.object({
  id: z.string(),
  label: z.string(),
  createdAt: z.number(),
  lastSeenAt: z.number(),
  revokedAt: z.number().nullable(),
});
export type GitClient = z.infer<typeof gitClientSchema>;

export const gitPairingRequestSchema = /*#__PURE__*/ z.object({
  requestId: z.string(),
  clientId: z.string(),
  label: z.string(),
  expiresAtMs: z.number(),
});
export type GitPairingRequest = z.infer<typeof gitPairingRequestSchema>;

export const gitPairingSnapshotSchema = /*#__PURE__*/ z.object({
  pending: gitPairingRequestSchema.nullable(),
  queued: z.number(),
});
export type GitPairingSnapshot = z.infer<typeof gitPairingSnapshotSchema>;

// "resolved" | "alreadyResolved" | "expired" — gitsock.PairingActionResult's wire projection
// (D9): a double Approve/Deny, or one that arrived just past the 120s deadline, is a value, not
// an error.
export const gitPairingActionResultSchema = /*#__PURE__*/ z.object({
  result: /*#__PURE__*/ z.enum(['resolved', 'alreadyResolved', 'expired']),
});
export type GitPairingActionResult = z.infer<typeof gitPairingActionResultSchema>;

// G10 D14: the Install VS Code Integration button's own domain — gitvsix.Status/Result's wire
// projections. codeAvailable is advisory only (the pane's pre-click render); InstallVsCodeIntegration
// re-resolves everything itself and is the sole authority.
export const gitVsixStatusSchema = /*#__PURE__*/ z.object({
  bundled: z.boolean(),
  vsixPath: z.string(),
  codeAvailable: z.boolean(),
  probed: z.array(z.string()),
});
export type GitVsixStatus = z.infer<typeof gitVsixStatusSchema>;

// "installed" | "revealed" | "notBundled" | "installFailed" | "revealFailed" — gitvsix.Install's
// own outcome vocabulary (D12): never a rejected call, always one of these five values.
export const gitVsixInstallResultSchema = /*#__PURE__*/ z.object({
  outcome: /*#__PURE__*/ z.enum([
    'installed',
    'revealed',
    'notBundled',
    'installFailed',
    'revealFailed',
  ]),
  vsixPath: z.string(),
  detail: z.string(),
  probed: z.array(z.string()),
});
export type GitVsixInstallResult = z.infer<typeof gitVsixInstallResultSchema>;
