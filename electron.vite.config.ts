import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          engine: resolve(__dirname, 'src/engine/index.ts'),
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].js',
        },
      },
    },
  },
  preload: {
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/preload/index.ts'),
        output: {
          format: 'cjs',
        },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    base: './',
    plugins: [vue(), tailwindcss()],
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        // Mirrors vite.wails.config.ts's own aliases (P57 D8) purely so this build still
        // compiles: src/renderer/bridge/{control,port}.ts are shared with the Wails build and
        // now resolve their generated-binding imports through these same two names. The
        // resulting Electron bundle is not meant to run — P57 is retiring Electron outright
        // (M7) — this keeps `bun run build` a cheap, still-passing sanity check through C1
        // (§0.3/§9 M4) rather than a functional guarantee.
        '@bindings': resolve(
          __dirname,
          'shell/frontend/bindings/github.com/kirathecat/kira-studio/shell/internal/bridge',
        ),
        '@bindings-internal': resolve(
          __dirname,
          'shell/frontend/bindings/github.com/kirathecat/kira-studio/shell/internal',
        ),
      },
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html'),
        // See vite.wails.config.ts's identical marking: bridge/{control,port}.ts import
        // '/wails/runtime.js', a path only Wails' own asset server ever resolves.
        external: [/^\/wails\//],
      },
    },
  },
});
