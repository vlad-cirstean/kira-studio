/** Pixels one arrow key moves a handle; Home/End jump to the bounds. */
export const RESIZE_KEY_STEP = 10;

export type ResizeAxis = 'x' | 'y';
export type ResizeUnit = 'px' | 'percent';
/** `reverse`: the pane sits after the handle (right of it, below it), so moving the handle toward
 *  the start of the axis grows it. */
export type ResizeDirection = 'normal' | 'reverse';

export interface ResizeBounds {
  min: number;
  max: number;
  unit: ResizeUnit;
  /** Container length along the axis in px; only a `percent` handle reads it. */
  containerPx: number;
}

export function clampSize(size: number, { min, max, unit }: ResizeBounds): number {
  const clamped = Math.min(max, Math.max(min, size));
  return unit === 'px' ? Math.round(clamped) : Math.round(clamped * 100) / 100;
}

function toUnit(deltaPx: number, { unit, containerPx }: ResizeBounds): number {
  if (unit === 'px') return deltaPx;
  return containerPx > 0 ? (deltaPx / containerPx) * 100 : 0;
}

const signOf = (direction: ResizeDirection): 1 | -1 => (direction === 'normal' ? 1 : -1);

/** Size after the pointer moved `deltaPx` along the axis from where the drag began. */
export function sizeAfterDrag(
  startSize: number,
  deltaPx: number,
  direction: ResizeDirection,
  bounds: ResizeBounds,
): number {
  return clampSize(startSize + signOf(direction) * toUnit(deltaPx, bounds), bounds);
}

/** Size after `key`, or null when the key does not resize. Arrows move the handle `stepPx` along
 *  their screen direction; Home and End jump to the bounds (End is ignored when unbounded). */
export function sizeAfterKey(
  key: string,
  size: number,
  axis: ResizeAxis,
  direction: ResizeDirection,
  stepPx: number,
  bounds: ResizeBounds,
): number | null {
  if (key === 'Home') return bounds.min;
  if (key === 'End') return Number.isFinite(bounds.max) ? bounds.max : null;
  const forward = axis === 'x' ? 'ArrowRight' : 'ArrowDown';
  const backward = axis === 'x' ? 'ArrowLeft' : 'ArrowUp';
  if (key !== forward && key !== backward) return null;
  const handleDelta = key === forward ? stepPx : -stepPx;
  return clampSize(size + signOf(direction) * toUnit(handleDelta, bounds), bounds);
}
