import type { PageSize } from '@shared/domain/tabs';

// P39 F14: the same 10/100/1000/10000 + '10'/'100'/'1k'/'10k' literal, once, differing only in
// each view's own testid prefix.
export function pageSizeOptions(
  testidPrefix: '' | 'document-' | 'keyvalue-' | 'stream-',
): { value: PageSize; label: string; testid: string }[] {
  return [
    { value: 10, label: '10', testid: `${testidPrefix}page-size-10` },
    { value: 100, label: '100', testid: `${testidPrefix}page-size-100` },
    { value: 1000, label: '1k', testid: `${testidPrefix}page-size-1000` },
    { value: 10000, label: '10k', testid: `${testidPrefix}page-size-10000` },
  ];
}
