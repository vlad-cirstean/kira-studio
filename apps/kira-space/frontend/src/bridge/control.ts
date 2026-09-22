// Thin re-export — Kira Studio's own control.ts, trimmed. bridge/index.ts is the composition
// root; this file exists only so an import from '.../bridge/control' (the path every moved repo
// file already uses) keeps working unchanged. Studio's own copy also re-exports `unwrap`, but
// every moved call site here imports it straight from '@workbench/bridge/rpc' (bridge/index.ts's
// own import), so this re-export stays dropped rather than kept unused.
export { control } from './index';
