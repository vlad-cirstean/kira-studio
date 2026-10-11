import { describe, expect, test } from 'bun:test';
import { clampSize, type ResizeBounds, sizeAfterDrag, sizeAfterKey } from './paneResizeMath';

const px: ResizeBounds = { min: 100, max: 400, unit: 'px', containerPx: 1000 };
const pct: ResizeBounds = { min: 10, max: 60, unit: 'percent', containerPx: 800 };

describe('clampSize', () => {
  test('clamps to bounds; px rounds to whole, percent to 2 decimals', () => {
    expect(clampSize(50, px)).toBe(100);
    expect(clampSize(999, px)).toBe(400);
    expect(clampSize(150.6, px)).toBe(151);
    expect(clampSize(33.3333, pct)).toBe(33.33);
  });
});

describe('sizeAfterDrag', () => {
  test('normal direction grows with the pointer, reverse shrinks', () => {
    expect(sizeAfterDrag(200, 30, 'normal', px)).toBe(230);
    expect(sizeAfterDrag(200, 30, 'reverse', px)).toBe(170);
  });

  test('stops at the bounds', () => {
    expect(sizeAfterDrag(200, 900, 'normal', px)).toBe(400);
    expect(sizeAfterDrag(200, 900, 'reverse', px)).toBe(100);
  });

  test('percent converts the pixel delta through the container size', () => {
    expect(sizeAfterDrag(30, 80, 'normal', pct)).toBe(40);
    expect(sizeAfterDrag(30, 80, 'normal', { ...pct, containerPx: 400 })).toBe(50);
  });

  test('percent with a zero-width container does not move', () => {
    expect(sizeAfterDrag(30, 80, 'normal', { ...pct, containerPx: 0 })).toBe(30);
  });

  test('zero delta returns the start size (cancel restore value)', () => {
    expect(sizeAfterDrag(250, 0, 'reverse', px)).toBe(250);
  });
});

describe('sizeAfterKey', () => {
  test('arrows follow the axis; reverse inverts the size change', () => {
    expect(sizeAfterKey('ArrowRight', 200, 'x', 'normal', 10, px)).toBe(210);
    expect(sizeAfterKey('ArrowLeft', 200, 'x', 'normal', 10, px)).toBe(190);
    expect(sizeAfterKey('ArrowRight', 200, 'x', 'reverse', 10, px)).toBe(190);
    expect(sizeAfterKey('ArrowDown', 200, 'y', 'normal', 10, px)).toBe(210);
    expect(sizeAfterKey('ArrowUp', 200, 'y', 'normal', 10, px)).toBe(190);
  });

  test('arrows of the other axis and other keys do not resize', () => {
    expect(sizeAfterKey('ArrowUp', 200, 'x', 'normal', 10, px)).toBeNull();
    expect(sizeAfterKey('ArrowRight', 200, 'y', 'normal', 10, px)).toBeNull();
    expect(sizeAfterKey('a', 200, 'x', 'normal', 10, px)).toBeNull();
  });

  test('step at a bound stays at the bound', () => {
    expect(sizeAfterKey('ArrowRight', 400, 'x', 'normal', 10, px)).toBe(400);
    expect(sizeAfterKey('ArrowLeft', 100, 'x', 'normal', 10, px)).toBe(100);
  });

  test('Home/End jump to the bounds; End ignored when unbounded', () => {
    expect(sizeAfterKey('Home', 200, 'x', 'normal', 10, px)).toBe(100);
    expect(sizeAfterKey('End', 200, 'x', 'normal', 10, px)).toBe(400);
    expect(sizeAfterKey('End', 200, 'x', 'normal', 10, { ...px, max: Infinity })).toBeNull();
  });

  test('percent step converts through the container', () => {
    expect(sizeAfterKey('ArrowRight', 30, 'x', 'normal', 40, pct)).toBe(35);
  });
});
