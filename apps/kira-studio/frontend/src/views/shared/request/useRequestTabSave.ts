export interface UseRequestTabSaveOptions<T> {
  tabId: () => string;
  incognito: () => boolean;
  itemId: () => string | null;
  /** The tab's own currently-saved record, or null when it isn't bound to one (a fresh tab, or
   *  D14's orphan case — a row deleted in this window or another). Presence alone decides Save vs.
   *  Save as…, its own content is never read here. */
  saved: () => unknown | null;
  name: () => string;
  toSaved: () => T;
  save: (itemId: string, name: string, body: T) => void | Promise<void>;
  openSaveDialog: (tabId: string, name: string, body: T) => void;
}

/** P107 T1-16: HttpRequestView.vue's and GrpcRequestView.vue's own onSave/onSaveAs pair — byte-
 *  identical apart from which store method/converter each calls. P71 §3.2: an incognito tab has no
 *  route into a persisting editor — both no-op, which also covers each view's own
 *  registerCommand('api.save', onSave) and the command palette entry it registers. */
export function useRequestTabSave<T>(options: UseRequestTabSaveOptions<T>) {
  function onSave(): void {
    if (options.incognito()) return;
    const itemId = options.itemId();
    if (!itemId || options.saved() === null) {
      onSaveAs();
      return;
    }
    void options.save(itemId, options.name(), options.toSaved());
  }

  function onSaveAs(): void {
    if (options.incognito()) return;
    options.openSaveDialog(options.tabId(), options.name(), options.toSaved());
  }

  return { onSave, onSaveAs };
}
