import { getImage } from 'astro:assets';
import type { ImageMetadata } from 'astro';
import { SHOTS, type ShotDef } from '../data/shots';

type Glob = Record<string, { default: ImageMetadata }>;

const framed: Glob = import.meta.glob('../../../screenshots/framed/*.png', { eager: true });
const detail: Glob = import.meta.glob('../../../screenshots/*-detail.png', { eager: true });

function find(glob: Glob, file: string): ImageMetadata {
  const hit = Object.entries(glob).find(([path]) => path.endsWith(`/${file}`));
  if (!hit) throw new Error(`Missing screenshot ${file}. Run: bun run screenshots`);
  return hit[1].default;
}

export interface ResolvedShot extends ShotDef {
  readonly framedWebp: string;
  readonly framedPng: string;
  readonly detailWebp: string;
  readonly detailPng: string;
  readonly detailWidth: number;
  readonly detailHeight: number;
}

async function urls(src: ImageMetadata) {
  const [webp, png] = await Promise.all([
    getImage({ src, format: 'webp', quality: 88 }),
    getImage({ src, format: 'png' }),
  ]);
  return { webp: webp.src, png: png.src };
}

/** Resolves one listed shot; throws at build time when a file is missing. */
async function resolveShot(id: string): Promise<ResolvedShot> {
  const def = SHOTS.find((s) => s.id === id);
  if (!def) throw new Error(`Unknown shot ${id}`);
  const f = await urls(find(framed, `${id}.png`));
  const detailMeta = find(detail, `${id}-detail.png`);
  const d = await urls(detailMeta);
  return {
    ...def,
    framedWebp: f.webp,
    framedPng: f.png,
    detailWebp: d.webp,
    detailPng: d.png,
    detailWidth: detailMeta.width,
    detailHeight: detailMeta.height,
  };
}

/** Fails the build when any listed shot has no file. */
export async function resolveAllShots(): Promise<ResolvedShot[]> {
  return Promise.all(SHOTS.map((s) => resolveShot(s.id)));
}
