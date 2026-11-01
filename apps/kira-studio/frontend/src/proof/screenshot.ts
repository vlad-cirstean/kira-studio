import { domToCanvas } from 'modern-screenshot';
import { TOOLTIP_CLASS } from './chartOption';

const SEPARATOR_PX = 8;

/** Every real CSS property, none of the custom ones. The page defines thousands of `--kira-*` and
 *  `--tw-*` properties that every element inherits; copying them into each clone made a capture
 *  take minutes, and the resolved values are already on the real properties. */
function paintedProperties(): string[] {
  const style = getComputedStyle(document.documentElement);
  return Array.from({ length: style.length }, (_, i) => style.item(i)).filter(
    (name) => !name.startsWith('--'),
  );
}

/** Renders the element as it is on screen, scrolled lists included: `restoreScrollPosition` shifts
 *  each scrolled container's children by its offset in the clone. */
export function captureElement(el: HTMLElement): Promise<HTMLCanvasElement> {
  return domToCanvas(el, {
    scale: window.devicePixelRatio || 1,
    backgroundColor: getComputedStyle(el).backgroundColor,
    includeStyleProperties: paintedProperties(),
    features: { restoreScrollPosition: true },
    filter: (node) => !(node instanceof Element && node.classList.contains(TOOLTIP_CLASS)),
  });
}

/** Stacks captures top to bottom, a themed gap between each. */
export function stackCanvases(canvases: HTMLCanvasElement[], gapColor: string): HTMLCanvasElement {
  const scale = window.devicePixelRatio || 1;
  const gap = Math.round(SEPARATOR_PX * scale);
  const width = Math.max(...canvases.map((c) => c.width));
  const height = canvases.reduce((sum, c) => sum + c.height, 0) + gap * (canvases.length - 1);
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('stackCanvases: no 2d context');
  ctx.fillStyle = gapColor;
  ctx.fillRect(0, 0, width, height);
  let y = 0;
  for (const c of canvases) {
    ctx.drawImage(c, 0, y);
    y += c.height + gap;
  }
  return out;
}

export function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('canvasToPng: encode failed'))),
      'image/png',
    );
  });
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** A file-name-safe slug of a session or step name. */
export function fileSlug(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[^\w.-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'proof'
  );
}
