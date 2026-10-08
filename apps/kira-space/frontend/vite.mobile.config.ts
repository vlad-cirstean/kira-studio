import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

const at = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

// The phone app: a second build of this frontend, served by the Go mobileweb server. No `@bindings`
// alias and no Wails runtime, so an accidental import of the desktop `control` bridge fails the
// build instead of shipping a broken bundle.
export default defineConfig({
  root: at('./mobile'),
  base: '/',
  plugins: [vue(), tailwindcss()],
  server: { host: '127.0.0.1', port: 9247, strictPort: true },
  resolve: {
    alias: {
      '@': at('./src'),
      '@ade': at('./src/ade/v2'),
      '@shared': at('../../../packages/shared'),
      '@theme': at('../../../packages/theme/src'),
      '@workbench': at('../../../packages/workbench/src'),
    },
  },
  define: { __KIRA_DEBUG_HOOKS__: 'false' },
  build: {
    outDir: at('./dist-mobile'),
    emptyOutDir: true,
    rolldownOptions: {
      input: { index: at('./mobile/index.html') },
    },
  },
});
