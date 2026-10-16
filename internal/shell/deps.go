package shell

import "github.com/kirathecat/kira-studio/internal/appstorage"

// Config is the one per-app string this package's window/menu building needs — P103 Part 3's own
// seam replacing the two hardcoded "Kira Studio" literals window.go/menu.go used to carry.
type Config struct {
	AppName     string // menu title
	WindowTitle string // "Kira Studio" / "Kira Space" — window.go's one divergent line
}

// Signaller is the subset of *appevent.Events the quit and close-flush handshakes actually call —
// both apps' own bridge.Events satisfies it (by embedding *appevent.Events), so main.go passes its
// existing *bridge.Events straight through with no adapter.
type Signaller interface {
	Broadcast(channel string)
	SignalTo(windowKey, channel string)
}

// WindowBounds is a plain screen rectangle — the two fields window.go actually reads off each
// app's own storage/model.WindowRecord. A plain alias of appstorage.WindowBounds (P107 I2-3;
// field-for-field identical to begin with), so this package still never imports a per-app storage
// package, and every WindowBounds value crosses this boundary with no conversion at all.
type WindowBounds = appstorage.WindowBounds

// WindowRecord is window.go's own Options/Attach fields (Key/Bounds) plus Order — openwindow.go's
// own OpenNewWindow/ReopenWindows need Order to pick a cascade position / the highest-order stored
// window; Kira Studio's own storage/model.WindowRecord alone also carries a Mode, which stays out
// of this package the same way it always has. A plain alias of appstorage.WindowRecord (P107
// I2-3), same reasoning as WindowBounds above.
type WindowRecord = appstorage.WindowRecord

// WindowStore is exactly the method window.go's Attach calls on each app's own
// *repos.WindowsRepo — SetBounds, the one write Attach's debounced persist() makes. WindowRepo
// (openwindow.go) widens this to the full set OpenWindow/OpenNewWindow/ReopenWindows need. Since
// WindowBounds/WindowRecord above are now plain aliases of appstorage's own (P107 I2-3), Kira
// Space's own *repos.WindowsRepo — whose WindowRecord has no Mode column to convert — satisfies
// both interfaces directly, so its main.go passes one straight through with no adapter. Kira
// Studio's own model.WindowRecord still carries Mode (P22 D12), so its *repos.WindowsRepo does
// not satisfy WindowRepo directly; its main.go keeps a one-line windowStore adapter for that.
type WindowStore interface {
	SetBounds(key string, b WindowBounds) error
}
