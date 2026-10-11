import { describe, expect, test } from 'bun:test';
import { type Binding, type Chord, SHORTCUTS } from '@shared/domain/shortcuts';

const chordId = (c: Chord): string =>
  [c.key, c.cmdOrCtrl && 'mod', c.ctrl && 'ctrl', c.shift && 'shift', c.alt && 'alt']
    .filter(Boolean)
    .join('+');

function conflicts(platform: 'mac' | 'other'): string[] {
  const seen = new Map<string, { id: string; scope: string }[]>();
  for (const [id, binding] of Object.entries(SHORTCUTS) as [string, Binding][]) {
    const chord = platform === 'mac' ? (binding.mac ?? binding.chord) : binding.chord;
    const key = chordId(chord);
    seen.set(key, [...(seen.get(key) ?? []), { id, scope: binding.scope }]);
  }
  const out: string[] = [];
  for (const [chord, users] of seen) {
    for (let i = 0; i < users.length; i++) {
      for (let j = i + 1; j < users.length; j++) {
        const a = users[i];
        const b = users[j];
        if (a.scope === b.scope || a.scope === 'global' || b.scope === 'global') {
          out.push(`${chord}: ${a.id} (${a.scope}) vs ${b.id} (${b.scope})`);
        }
      }
    }
  }
  return out;
}

describe('SHORTCUTS', () => {
  test('no duplicate chord inside a scope or against global, on either platform', () => {
    expect(conflicts('other')).toEqual([]);
    expect(conflicts('mac')).toEqual([]);
  });
});
