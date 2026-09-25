import { defineAppViteConfig } from '../../../packages/workbench/src/viteAppConfig.ts';

// Root is this file's own directory (the Wails `frontend/` slot), so `dist` lands where
// apps/kira-studio/main.go's `//go:embed all:frontend/dist` can reach it — Go's embed cannot
// escape its own package directory. P113 F6: the config body itself moved to workbench's own
// defineAppViteConfig, shared with kira-space's identical copy — this app supplies only its own
// name, dev-server port and `import.meta.url` (every alias below resolves against the latter).
export default defineAppViteConfig({ app: 'kira-studio', port: 9245, configUrl: import.meta.url });
