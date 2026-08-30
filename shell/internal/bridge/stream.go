package bridge

import (
	"log/slog"

	"github.com/kirathecat/kira-studio/shell/internal/enginehost"
)

// StreamSession is the whole of what the engine stream handler needs from a renderer connection.
// *application.StreamConn satisfies it structurally — Send([]byte) error (stream.go:234) and
// Receive() ([]byte, error) (stream.go:274) — so this package still imports no Wails (P56 D1).
type StreamSession interface {
	Send(frame []byte) error
	Receive() ([]byte, error)
}

// StreamName is the one named stream (P52 §7.2). The renderer's replacement for
// src/renderer/bridge/port.ts opens it once per page load; Wails supersedes an older generation's
// session automatically (stream.go:747-800), which is what retires index.ts's own `generation`
// counter.
const StreamName = "engine"

// ServeEngineStream runs for the life of one connection and returns when the renderer's side
// closes (page reload, window close, app shutdown). Outbound: conn is attached as the host's Sink
// directly — Wails' Send blocks rather than returning ErrStreamFull (stream.go:234-240; TrySend is
// the non-blocking one), which is exactly P52 §7.2's backpressure policy: enginehost's bounded
// queue fills, its read loop stops draining the engine's stdout, and the OS pipe pushes back on
// the engine (P56 D15). Inbound: every frame goes to the engine's stdin verbatim. Go never
// unmarshals a data-plane frame in either direction.
func ServeEngineStream(host *enginehost.Host, conn StreamSession) {
	detach := host.AttachStream(conn)
	defer detach()
	for {
		frame, err := conn.Receive()
		if err != nil {
			return
		}
		if err := host.SendData(frame); err != nil {
			// The engine is gone. The session stays open: enginehost has already failed every
			// pending call with E_ENGINE_DOWN (P54), and the renderer's own pending map is what
			// surfaces that — closing the stream here would additionally reject frames the
			// renderer has not sent yet, which is not today's behaviour.
			slog.Warn("engine stream send failed", "scope", "stream", "err", err)
		}
	}
}
