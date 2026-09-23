package shell

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
// app's own storage/model.WindowRecord, mirrored here so this package never imports a per-app
// storage package. Field-for-field identical to model.WindowBounds in both apps, so a plain Go
// struct conversion (model.WindowBounds(b) / shell.WindowBounds(b)) crosses the boundary at the
// one call site each app's main.go has.
type WindowBounds struct {
	X      float64
	Y      float64
	Width  float64
	Height float64
}

// WindowRecord is window.go's own Options/Attach fields (Key/Bounds) plus Order — openwindow.go's
// own OpenNewWindow/ReopenWindows need Order to pick a cascade position / the highest-order stored
// window; Kira Studio's own storage/model.WindowRecord alone also carries a Mode, which stays out
// of this package the same way it always has (converted at each app's own windowStore adapter
// rather than hoisting the storage model).
type WindowRecord struct {
	Key    string
	Order  int
	Bounds *WindowBounds
}

// WindowStore is exactly the method window.go's Attach calls on each app's own
// *repos.WindowsRepo — SetBounds, the one write Attach's debounced persist() makes. WindowRepo
// (openwindow.go) widens this to the full set OpenWindow/OpenNewWindow/ReopenWindows need. Each
// app's *repos.WindowsRepo takes its own model.WindowBounds, a different named type even though
// field-identical, so it does not satisfy this interface directly; main.go wraps it in a one-line
// adapter at the same call site that builds WindowDeps.
type WindowStore interface {
	SetBounds(key string, b WindowBounds) error
}
