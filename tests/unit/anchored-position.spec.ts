import { describe, expect, test } from 'bun:test';
import { anchoredPosition } from '../../src/renderer/theme/anchoredPosition';

const viewport = { width: 1000, height: 800 };

describe('anchoredPosition (P49 D12) — the flip/clamp arithmetic behind three overlay callers', () => {
  describe("strategy: 'callout' (AppTooltip.vue / ErrorPopover.vue's own default)", () => {
    test('1. fits below-left of the anchor: no clamp, no flip', () => {
      const anchor = { left: 100, right: 150, top: 50, bottom: 70 };
      expect(anchoredPosition(anchor, { width: 200, height: 100 }, viewport)).toEqual({
        left: 100,
        top: 74,
      });
    });

    test('2. right-edge overflow pulls left back to the viewport edge, unconditionally clamped', () => {
      const anchor = { left: 950, right: 980, top: 50, bottom: 70 };
      expect(anchoredPosition(anchor, { width: 200, height: 100 }, viewport)).toEqual({
        left: 796,
        top: 74,
      });
    });

    test('3. bottom-edge overflow flips the panel above the anchor', () => {
      const anchor = { left: 100, right: 150, top: 750, bottom: 770 };
      expect(anchoredPosition(anchor, { width: 200, height: 100 }, viewport)).toEqual({
        left: 100,
        top: 646,
      });
    });

    test('4. an anchor already off-screen to the left is left un-clamped — byte-for-byte the original AppTooltip/ErrorPopover behavior, not a new fix', () => {
      const anchor = { left: -40, right: -10, top: 50, bottom: 70 };
      expect(anchoredPosition(anchor, { width: 200, height: 100 }, viewport).left).toBe(-40);
    });
  });

  describe("strategy: 'menu' (PopoverPanel.vue's own default)", () => {
    test("5. fits below, align: 'left': clamps computed but does not move a value already in bounds", () => {
      const anchor = { left: 100, right: 150, top: 50, bottom: 70 };
      expect(
        anchoredPosition(anchor, { width: 200, height: 150 }, viewport, { strategy: 'menu' }),
      ).toEqual({ left: 100, top: 74 });
    });

    test("6. align: 'right' hangs the panel off the anchor's right edge, clamped to the gap floor when that runs negative", () => {
      const anchor = { left: 100, right: 150, top: 50, bottom: 70 };
      expect(
        anchoredPosition(anchor, { width: 200, height: 100 }, viewport, {
          strategy: 'menu',
          align: 'right',
        }).left,
      ).toBe(4);
    });

    test('7. more room above than below, and the panel does not fit below: opens upward', () => {
      const anchor = { left: 100, right: 150, top: 700, bottom: 720 };
      expect(
        anchoredPosition(anchor, { width: 200, height: 150 }, viewport, { strategy: 'menu' }),
      ).toEqual({ left: 100, top: 546 });
    });

    test('8. neither side fully fits: still picks the roomier side, then clamps fully on-screen rather than running off the top', () => {
      const anchor = { left: 100, right: 150, top: 400, bottom: 420 };
      expect(
        anchoredPosition(anchor, { width: 200, height: 750 }, viewport, { strategy: 'menu' }).top,
      ).toBe(4);
    });
  });

  test('9. a custom gap is honoured on both axes', () => {
    const anchor = { left: 100, right: 150, top: 50, bottom: 70 };
    expect(anchoredPosition(anchor, { width: 200, height: 100 }, viewport, { gap: 10 })).toEqual({
      left: 100,
      top: 80,
    });
  });
});
