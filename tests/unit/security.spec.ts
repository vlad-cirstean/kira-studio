import { describe, expect, test } from 'bun:test';
import { rendererWebPreferences } from '../../src/main/security';

describe('src/main/security.ts — rendererWebPreferences (P46 D69/D73)', () => {
  test('1. returns exactly the renderer web preferences this app sets — no more, no less', () => {
    expect(rendererWebPreferences({ preload: '/preload.js', isDev: true })).toEqual({
      preload: '/preload.js',
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    });
  });

  test('2. isDev does not (yet) change the returned preferences', () => {
    const dev = rendererWebPreferences({ preload: '/preload.js', isDev: true });
    const packaged = rendererWebPreferences({ preload: '/preload.js', isDev: false });
    expect(dev).toEqual(packaged);
  });
});
