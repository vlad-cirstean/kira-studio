// Package secrets is the Go analogue of src/main/secret-cipher.ts, resolved per P52 §6: one
// AES-256-GCM key held in the macOS Keychain (github.com/keybase/go-keychain), a kira:v2:
// envelope in the connections.password column, and the same per-platform
// SecretStorageStatus probe/reason strings the connection dialog already renders.
package secrets

// Backend values mirror src/shared/domain/secrets.ts's secretStorageStatusSchema.
const (
	BackendKeychain    = "keychain"
	BackendBasicText   = "basic_text"
	BackendUnavailable = "unavailable"
)

// Status mirrors secretStorageStatusSchema byte for byte — the shape
// shell/internal/bridge/connections.go carried as a P52-walking-skeleton stub; this is that
// struct, moved here unchanged.
type Status struct {
	Available        bool    `json:"available"`
	Backend          string  `json:"backend"`
	InsecureFallback bool    `json:"insecureFallback"`
	Reason           *string `json:"reason"`
}

func reason(s string) *string { return &s }

const (
	darwinUnavailableReason = "The macOS Keychain is unavailable, so passwords cannot be saved. Everything else about this connection can be."
	linuxUnavailableReason  = "No system keychain is available on Linux in this build. Set KIRA_INSECURE_SECRETS=1 for local development, or run on macOS."
	otherPlatformReason     = "Credential storage is only supported on macOS in this build."
)
