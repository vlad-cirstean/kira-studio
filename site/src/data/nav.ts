export const REPO_URL = 'https://github.com/vlad-cirstean/kira-studio';

/** Joins a site-relative path to the Pages base path. */
export function href(path = ''): string {
  return `${import.meta.env.BASE_URL.replace(/\/$/, '')}/${path}`;
}

export interface NavLink {
  readonly label: string;
  readonly href: string;
  readonly external?: boolean;
}

export const NAV: readonly NavLink[] = [
  { label: 'Install', href: '#install' },
  { label: 'Docs', href: href('docs/') },
  { label: 'GitHub', href: REPO_URL, external: true },
];
