import { t } from '@theme/i18n';
import { useAsyncAction } from '@workbench/behaviour/asyncAction';
import { copyImageOrReportErrorLazy } from '@workbench/behaviour/clipboard';
import { announceApp } from '@workbench/behaviour/liveRegion';
import { type MaybeRefOrGetter, nextTick, toValue } from 'vue';
import { control } from '../bridge/control';
import { blobToBase64, canvasToPng, captureElement, fileSlug, stackCanvases } from './screenshot';
import { useProofWindowStore } from './state';
import type { ProofTab } from './tabHost';

const READY_TIMEOUT_MS = 15_000;

const frames = (n: number): Promise<void> =>
  new Promise((resolve) => {
    const step = (left: number): void => {
      if (left === 0) resolve();
      else requestAnimationFrame(() => step(left - 1));
    };
    step(n);
  });

/** Resolves once every step view under `root` has restored its saved scroll and highlight and
 *  painted, so the capture shows exactly what the screen settles on. */
async function whenSettled(root: HTMLElement): Promise<void> {
  const deadline = performance.now() + READY_TIMEOUT_MS;
  for (;;) {
    const views = root.querySelectorAll('[data-step-key]');
    if (views.length > 0 && [...views].every((v) => v.getAttribute('data-ready') === 'true')) break;
    if (performance.now() > deadline) throw new Error(t('studio.proof.shot.notSettled.error'));
    await frames(1);
  }
  await frames(2);
}

interface Source {
  /** The pane to photograph: tab strip and body. */
  target: MaybeRefOrGetter<HTMLElement | null>;
  tabs: MaybeRefOrGetter<ProofTab[]>;
  sessionName: MaybeRefOrGetter<string>;
}

/** One tab or all tabs in order, to the clipboard or to a PNG on disk. */
export function useProofScreenshot(source: Source) {
  const store = useProofWindowStore();

  async function shoot(tabs: ProofTab[]): Promise<HTMLCanvasElement> {
    const el = toValue(source.target);
    if (!el) throw new Error('shoot: no target');
    const original = store.activeId;
    const shots: HTMLCanvasElement[] = [];
    try {
      for (const tab of tabs) {
        if (tabs.length > 1) {
          store.activeId = tab.id;
          await nextTick();
        }
        await whenSettled(el);
        shots.push(await captureElement(el));
      }
    } finally {
      if (tabs.length > 1) store.activeId = original;
    }
    if (shots.length === 1) return shots[0] as HTMLCanvasElement;
    return stackCanvases(shots, getComputedStyle(el).borderTopColor);
  }

  async function copy(tabs: ProofTab[]): Promise<void> {
    let failure: string | null = null;
    await copyImageOrReportErrorLazy(shoot(tabs).then(canvasToPng), (message) => {
      failure = message;
    });
    if (failure) throw new Error(failure);
    announceApp(t('studio.proof.shot.copied.announce'));
  }

  async function save(tabs: ProofTab[], all: boolean): Promise<void> {
    const png = await canvasToPng(await shoot(tabs));
    const base = fileSlug(toValue(source.sessionName));
    const only = tabs[0];
    const name =
      all || !only ? base : `${base}-${String(only.state.meta.ordinal).padStart(2, '0')}`;
    const result = await control.proofSavePng(`${name}.png`, await blobToBase64(png));
    if (result.saved && result.path) {
      announceApp(t('studio.proof.shot.saved.announce', { path: result.path }));
    }
  }

  const action = useAsyncAction(async (mode: 'copy' | 'save', all: boolean) => {
    const tabs = toValue(source.tabs);
    const picked = all ? tabs : tabs.filter((tab) => tab.active);
    if (mode === 'copy') await copy(picked);
    else await save(picked, all);
  });

  async function run(mode: 'copy' | 'save', all: boolean): Promise<void> {
    if (action.pending.value) return;
    if (!(await action.run(mode, all))) {
      announceApp(t('studio.proof.shot.failed.error', { error: action.error.value ?? '' }));
    }
  }

  return {
    busy: action.pending,
    copy: (all: boolean) => run('copy', all),
    save: (all: boolean) => run('save', all),
  };
}
