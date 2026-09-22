// This package's own tsconfig checks src/webview/main.ts with plain tsgo, not vue-tsc — but that
// file legitimately imports @kira/git-ui's mount(), which (via git-ui's own src/index.ts) pulls
// in .vue/.css files transitively. Without project references (D15), tsgo resolves those from
// git-ui's raw source, so this package needs the same ambient shim git-ui's own tsconfig carries
// for the same reason. The .vue files' actual internal correctness is git-ui's own vue-tsc check's
// job (typecheck:git's fourth step) — this shim only keeps a *type it never inspects* from being
// an error here.
declare module '*.vue' {
  import type { DefineComponent } from 'vue';

  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}
