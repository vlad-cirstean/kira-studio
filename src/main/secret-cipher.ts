import { safeStorage } from 'electron';
import type { SecretStorageStatus } from '../shared/domain/secrets';
import { log } from './log';

const ENVELOPE_PREFIX = 'kira:v1:';

// The only file in the repo that imports `safeStorage` (P25 D1). `storage/repos/secrets.ts`
// stays the only file that reads or writes `connections.password` — this file only ever sees a
// plain string in, a plain string out.
export class SecretStoreError extends Error {
  readonly code = 'E_SECRET_STORE';
}

export interface SecretCipher {
  readonly status: SecretStorageStatus;
  /** `kira:v1:<base64>`. Throws SecretStoreError when `status.available` is false. */
  encrypt(plain: string): string;
  /** Enveloped -> decrypted. Not enveloped -> returned verbatim (pre-P25 plaintext, D10).
   *  Throws SecretStoreError when an enveloped value cannot be decrypted. */
  decrypt(stored: string): string;
  isEnveloped(stored: string): boolean;
}

function isEnvelopedValue(stored: string): boolean {
  return stored.startsWith(ENVELOPE_PREFIX);
}

// Linux never reports real OS-backed storage: without KIRA_INSECURE_SECRETS it is always
// `unavailable`, and with it, it is always the obfuscated `basic_text` fallback (D13) — this app
// targets macOS only (SPEC §1/§27, D2), so Linux exists here purely as this repo's dev/CI
// environment, never as a second supported backend. A genuinely working Linux keyring (a real
// gnome-keyring/kwallet daemon) is deliberately not detected or used — D2 rules out a runtime
// platform switch beyond this one explicit development fallback.
function probeStatus(): SecretStorageStatus {
  if (process.platform === 'darwin') {
    if (safeStorage.isEncryptionAvailable()) {
      return { available: true, backend: 'keychain', insecureFallback: false, reason: null };
    }
    return {
      available: false,
      backend: 'unavailable',
      insecureFallback: false,
      reason:
        'The macOS Keychain is unavailable, so passwords cannot be saved. Everything else about this connection can be.',
    };
  }

  if (process.platform === 'linux') {
    if (process.env.KIRA_INSECURE_SECRETS) {
      // Idempotent, and honoured by isEncryptionAvailable() itself for the `basic_text` backend
      // (Electron v43 source, F10) — safe to call even if it was already true.
      safeStorage.setUsePlainTextEncryption(true);
      if (safeStorage.isEncryptionAvailable()) {
        return { available: true, backend: 'basic_text', insecureFallback: true, reason: null };
      }
    }
    return {
      available: false,
      backend: 'unavailable',
      insecureFallback: false,
      reason:
        'No system keychain is available on Linux in this build. Set KIRA_INSECURE_SECRETS=1 for local development, or run on macOS.',
    };
  }

  return {
    available: false,
    backend: 'unavailable',
    insecureFallback: false,
    reason: 'Credential storage is only supported on macOS in this build.',
  };
}

/** Called once, after `app.whenReady()` (F10/D1). Probes availability, applies the Linux
 *  development fallback if and only if it is enabled (D13), and logs the outcome. */
export function createSecretCipher(): SecretCipher {
  const status = probeStatus();
  log(
    status.insecureFallback ? 'warn' : 'info',
    'secrets',
    `secret storage: backend=${status.backend} available=${status.available}${
      status.insecureFallback
        ? ' — Linux development fallback (KIRA_INSECURE_SECRETS=1): credentials are obfuscated with a hardcoded key, not a real keychain'
        : ''
    }`,
  );

  function encrypt(plain: string): string {
    if (!status.available) {
      throw new SecretStoreError(status.reason ?? 'Secret storage is unavailable.');
    }
    return `${ENVELOPE_PREFIX}${safeStorage.encryptString(plain).toString('base64')}`;
  }

  function decrypt(stored: string): string {
    if (!isEnvelopedValue(stored)) return stored;
    if (!status.available) {
      throw new SecretStoreError(status.reason ?? 'Secret storage is unavailable.');
    }
    try {
      const buf = Buffer.from(stored.slice(ENVELOPE_PREFIX.length), 'base64');
      return safeStorage.decryptString(buf);
    } catch (err) {
      throw new SecretStoreError(
        `The stored credential could not be decrypted (${err instanceof Error ? err.message : String(err)}). It may have been written on a different machine or after a keychain reset — re-enter it to fix this connection.`,
      );
    }
  }

  return { status, encrypt, decrypt, isEnveloped: isEnvelopedValue };
}
