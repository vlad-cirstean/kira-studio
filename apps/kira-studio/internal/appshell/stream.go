package appshell

import (
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapterhost"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/bridge"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// RegisterEngineStream registers the one named stream. The handler blocks for the life of the
// connection, which is what keeps it open (stream.go:162-166's StreamHandler contract). Takes the
// router, not the engine host, since M4: the data plane is a server now, not a byte forwarder
// (P58 D3).
func RegisterEngineStream(app *application.App, router *adapterhost.Router) {
	app.HandleStream(bridge.StreamName, func(c *application.StreamConn) {
		bridge.ServeEngineStream(router, c)
	})
}
