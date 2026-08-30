import { describe, expect, mock, test } from 'bun:test';

// buildMenu's only electron imports are app.name (a string), BrowserWindow.getFocusedWindow (never
// called at build time — only inside a click handler) and Menu.buildFromTemplate, which this mock
// returns the template from unchanged so the test can walk it directly (P46 D81).
mock.module('electron', () => ({
  app: { name: 'Kira Studio' },
  BrowserWindow: { getFocusedWindow: () => null },
  Menu: {
    buildFromTemplate: (template: unknown) => template,
  },
}));

const { buildMenu } = await import('../../src/main/menu');

interface MenuNode {
  role?: string;
  label?: string;
  submenu?: MenuNode[];
}

function findRoles(nodes: MenuNode[]): Set<string> {
  const roles = new Set<string>();
  for (const node of nodes) {
    if (node.role) roles.add(node.role);
    if (node.submenu) for (const role of findRoles(node.submenu)) roles.add(role);
  }
  return roles;
}

describe('src/main/menu.ts — buildMenu({ isDev }) (P46 D70/D73)', () => {
  test('1. a packaged build has no reload or toggleDevTools role anywhere in the menu', () => {
    const template = buildMenu({ isDev: false }) as unknown as MenuNode[];
    const roles = findRoles(template);
    expect(roles.has('reload')).toBe(false);
    expect(roles.has('toggleDevTools')).toBe(false);
  });

  test('2. a dev build has both', () => {
    const template = buildMenu({ isDev: true }) as unknown as MenuNode[];
    const roles = findRoles(template);
    expect(roles.has('reload')).toBe(true);
    expect(roles.has('toggleDevTools')).toBe(true);
  });
});
