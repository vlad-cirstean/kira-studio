package enginehost

import (
	"log/slog"

	"github.com/kirathecat/kira-studio/shell/internal/storage/model"
)

// configureCacheOp is ENGINE_OP.configureCache (src/shared/protocol/engine-ops.ts:18) —
// 'cache:configure', not the placeholder name earlier drafts of this plan used.
const configureCacheOp = "cache:configure"

// PushCacheConfig pushes engine-relevant settings (today: the L2 cache byte budget) into the
// engine. Failures are logged, never returned — src/main/engine-config.ts's own contract: "a
// settings save must not fail because the engine is mid-restart."
func PushCacheConfig(h *Host, settings model.Settings) {
	l2BudgetBytes := settings.Cache.L2BudgetMb * 1024 * 1024
	if _, err := h.Call(configureCacheOp, map[string]any{"l2BudgetBytes": l2BudgetBytes}); err != nil {
		slog.Warn("failed to push cache config to engine", "scope", "engine-config", "err", err)
	}
}
