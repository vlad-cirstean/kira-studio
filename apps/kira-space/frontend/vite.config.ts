import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

// Root is this file's own directory (the Wails `frontend/` slot), so `dist` lands where
// apps/kira-space/main.go's `//go:embed all:frontend/dist` can reach it — Go's embed cannot
// escape its own package directory. Mirrors apps/kira-studio/frontend/vite.config.ts exactly
// (P100 Part 2), differing only in the port and the bindings path.
export default defineConfig(({ command }) => {
  const debugHooks = command === 'serve' || process.env.KIRA_DEBUG_HOOKS === '1';
  return {
    base: './',
    plugins: [vue(), tailwindcss()],
    // Taskfile.yml's own VITE_PORT default is 9246, not Kira Studio's 9245 — the two dev servers
    // must be able to run side by side (plan §4.1).
    server: {
      host: '127.0.0.1',
      port: Number(process.env.WAILS_VITE_PORT) || 9246,
      strictPort: true,
    },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
        '@shared': fileURLToPath(new URL('../../../packages/shared', import.meta.url)),
        // P103 (byte-identical tier, folded into this pass): the confirmed byte-identical CSS/
        // shadcn-vue/primitive files this app shared verbatim with Kira Studio, hoisted out of both
        // apps' own src/ into one real location — this app importing, not owning, its own copy.
        '@theme': fileURLToPath(new URL('../../../packages/theme/src', import.meta.url)),
        // P103 Part 1: the byte-identical/code-identical workbench tier hoisted out of both apps'
        // own src/ into one real location — this app importing, not owning, its own copy. Follows
        // @theme's own alias shape exactly (not packages/git-ui's exports-map precedent), since
        // these files import @theme/*/@shared/* themselves, which only resolve through this app's
        // own alias table.
        '@workbench': fileURLToPath(new URL('../../../packages/workbench/src', import.meta.url)),
        // The module path stays "kira-studio" — that is the Go module name (go.mod), not the app
        // name (plan §5.1) — do not "fix" it.
        '@bindings': fileURLToPath(
          new URL(
            './bindings/github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge',
            import.meta.url,
          ),
        ),
        '@bindings-internal': fileURLToPath(
          new URL(
            './bindings/github.com/kirathecat/kira-studio/apps/kira-space/internal',
            import.meta.url,
          ),
        ),
      },
    },
    define: {
      __KIRA_DEBUG_HOOKS__: JSON.stringify(debugHooks),
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rolldownOptions: {
        external: [/^\/wails\//],
      },
    },
  };
});
