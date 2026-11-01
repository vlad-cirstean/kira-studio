import { formatBytes } from '@theme/format';
import { t } from '@theme/i18n';
import type { HostViewCompose } from './wire';

/** The file's bytes as standard base64, without the data URL prefix. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(file.name));
    reader.onload = () => {
      const url = String(reader.result ?? '');
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.readAsDataURL(file);
  });
}

export interface Held {
  size: number;
}

/**
 * Why `file` cannot join the files already held, or null. Mirrors the Go checks so a refusal costs
 * no round trip; Go stays authoritative.
 */
export function checkFile(
  file: File,
  compose: HostViewCompose,
  held: readonly Held[],
): string | null {
  const ext = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() : '';
  if (held.length >= compose.maxAttachments) {
    return t('space.hostView.compose.tooMany.error', { max: compose.maxAttachments });
  }
  if (!ext || !compose.allowedExtensions.includes(ext)) {
    return t('space.hostView.compose.type.error', { name: file.name });
  }
  if (file.size > compose.maxAttachmentBytes) {
    return t('space.hostView.compose.tooLarge.error', {
      name: file.name,
      max: formatBytes(compose.maxAttachmentBytes),
    });
  }
  const total = held.reduce((sum, h) => sum + h.size, 0) + file.size;
  if (total > compose.maxAttachmentTotalBytes) {
    return t('space.hostView.compose.total.error', {
      max: formatBytes(compose.maxAttachmentTotalBytes),
    });
  }
  return null;
}
