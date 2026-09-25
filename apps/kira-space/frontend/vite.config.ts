import { defineAppViteConfig } from '../../../packages/workbench/src/viteAppConfig.ts';

// Root is this file's own directory (the Wails `frontend/` slot), so `dist` lands where
// apps/kira-space/main.go's `//go:embed all:frontend/dist` can reach it — Go's embed cannot
// escape its own package directory. P113 F6: the config body itself moved to workbench's own
// defineAppViteConfig, shared with kira-studio's identical copy — this app supplies only its own
// name, dev-server port (Taskfile.yml's own VITE_PORT default, 9246 — not Kira Studio's 9245, so
// both dev servers can run side by side) and `import.meta.url`.
export default defineAppViteConfig({ app: 'kira-space', port: 9246, configUrl: import.meta.url });
