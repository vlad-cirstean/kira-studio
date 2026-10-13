export const REPO_URL = 'https://github.com/vlad-cirstean/kira-studio';

export interface NavLink {
  readonly label: string;
  readonly href: string;
  readonly external?: boolean;
}

export const NAV: readonly NavLink[] = [
  { label: 'Studio', href: '#studio' },
  { label: 'Space', href: '#space' },
  { label: 'Install', href: '#install' },
  { label: 'GitHub', href: REPO_URL, external: true },
];
