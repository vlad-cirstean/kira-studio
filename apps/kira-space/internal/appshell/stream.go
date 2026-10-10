package appshell

import (
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/bridge"
	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitrpc"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// RegisterGitStream registers the git stream — Kira Studio's own RegisterEngineStream, carrying
// gitrpc's own wire protocol read-only (bridge.ServeGitStream's own allowlist). Credential
// prompts of a connection route through relay, tagged with its window key.
func RegisterGitStream(app *application.App, router *gitrpc.Router, relay bridge.CredentialAsker) {
	app.HandleStream(bridge.GitStreamName, func(c *application.StreamConn) {
		key := ""
		if w := c.Window(); w != nil {
			key = w.Name()
		}
		bridge.ServeGitStream(router, c, key, relay)
	})
}
