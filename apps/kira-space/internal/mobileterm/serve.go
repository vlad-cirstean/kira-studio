package mobileterm

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/coder/websocket"
	"golang.org/x/time/rate"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/storage/repos"
	"github.com/kirathecat/kira-studio/internal/ipcerr"
	"github.com/kirathecat/kira-studio/internal/terminal"
)

const (
	readLimit   = 64 << 10
	inputCap    = 16 << 10
	frameCap    = 32 << 10
	writeTimout = 10 * time.Second
	pingEvery   = 25 * time.Second
)

type ctrlFrame struct {
	Type   string `json:"type"`
	Cols   int    `json:"cols,omitempty"`
	Rows   int    `json:"rows,omitempty"`
	Offset *int64 `json:"offset,omitempty"`
	Reset  bool   `json:"reset,omitempty"`
}

// Serve attaches dev to the session's terminal and pumps frames until either side ends. Binary
// frames carry terminal bytes both ways; text frames are JSON control messages.
func (b *Broker) Serve(w http.ResponseWriter, r *http.Request, dev repos.MobileDeviceRow, sessionID string) {
	q := r.URL.Query()
	cols, errC := strconv.Atoi(q.Get("cols"))
	rows, errR := strconv.Atoi(q.Get("rows"))
	if errC != nil || errR != nil || !terminal.ValidDim(cols) || !terminal.ValidDim(rows) {
		writeErr(w, http.StatusBadRequest, ipcerr.New("E_BAD_REQUEST", "cols and rows are required"))
		return
	}
	from := int64(-1)
	if s := q.Get("from"); s != "" {
		v, err := strconv.ParseInt(s, 10, 64)
		if err != nil || v < 0 {
			writeErr(w, http.StatusBadRequest, ipcerr.New("E_BAD_REQUEST", "from must be a byte offset"))
			return
		}
		from = v
	}
	c, err := b.Attach(sessionID, dev, cols, rows)
	if err != nil {
		writeErr(w, statusOf(err), err)
		return
	}
	ws, err := websocket.Accept(w, r, nil)
	if err != nil {
		b.Release(c)
		return
	}
	ws.SetReadLimit(readLimit)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		defer cancel()
		b.pump(ctx, ws, c, from, cols, rows)
	}()
	b.readLoop(ctx, ws, c)
	cancel()
	_ = ws.CloseNow()
	wg.Wait()
}

func (b *Broker) readLoop(ctx context.Context, ws *websocket.Conn, c *phoneConn) {
	inLim := rate.NewLimiter(100, 200)
	rzLim := rate.NewLimiter(10, 20)
	throttled := false
	throttle := func() {
		if !throttled {
			throttled = true
			sendCtrl(ctx, ws, ctrlFrame{Type: "throttled"})
		}
	}
	for {
		typ, data, err := ws.Read(ctx)
		if err != nil {
			select {
			case <-c.Done():
			default:
				b.Disconnected(c)
			}
			return
		}
		switch typ {
		case websocket.MessageBinary:
			if len(data) > inputCap || !inLim.Allow() {
				throttle()
				continue
			}
			b.Input(c, data)
		case websocket.MessageText:
			var f ctrlFrame
			if json.Unmarshal(data, &f) != nil {
				continue
			}
			switch f.Type {
			case "resize":
				if !terminal.ValidDim(f.Cols) || !terminal.ValidDim(f.Rows) {
					continue
				}
				if !rzLim.Allow() {
					throttle()
					continue
				}
				b.Resize(c, f.Cols, f.Rows)
			case "release":
				b.Release(c)
			}
		}
	}
}

// pump streams the ring to the phone from its own offset. A phone that falls out of the window
// gets a reset and the oldest byte still held; the PTY reader is never blocked.
func (b *Broker) pump(ctx context.Context, ws *websocket.Conn, c *phoneConn, from int64, cols, rows int) {
	off := from
	if off < 0 || off > c.End() {
		off = 0
	}
	data, next, over := c.ReadFrom(off, frameCap)
	start := next - int64(len(data))
	if !sendCtrl(ctx, ws, ctrlFrame{Type: "hello", Offset: &start, Cols: cols, Rows: rows, Reset: over && from >= 0}) {
		return
	}
	if !sendData(ctx, ws, data) {
		return
	}
	off = next
	tick := time.NewTicker(pingEvery)
	defer tick.Stop()
	for {
		data, next, over := c.ReadFrom(off, frameCap)
		if over {
			start := next - int64(len(data))
			if !sendCtrl(ctx, ws, ctrlFrame{Type: "reset", Offset: &start}) {
				return
			}
		}
		if len(data) > 0 {
			if !sendData(ctx, ws, data) {
				return
			}
			off = next
			continue
		}
		select {
		case <-c.notify:
		case <-tick.C:
			pctx, cancel := context.WithTimeout(ctx, writeTimout)
			err := ws.Ping(pctx)
			cancel()
			if err != nil {
				return
			}
		case <-c.Done():
			_ = ws.Close(websocket.StatusCode(c.Code()), c.Reason())
			return
		case <-ctx.Done():
			return
		}
	}
}

func sendData(ctx context.Context, ws *websocket.Conn, b []byte) bool {
	if len(b) == 0 {
		return true
	}
	wctx, cancel := context.WithTimeout(ctx, writeTimout)
	defer cancel()
	return ws.Write(wctx, websocket.MessageBinary, b) == nil
}

func sendCtrl(ctx context.Context, ws *websocket.Conn, f ctrlFrame) bool {
	b, err := json.Marshal(f)
	if err != nil {
		return false
	}
	wctx, cancel := context.WithTimeout(ctx, writeTimout)
	defer cancel()
	return ws.Write(wctx, websocket.MessageText, b) == nil
}

func statusOf(err error) int {
	var ie *ipcerr.Error
	if errors.As(err, &ie) && ie.Code == "E_NOT_FOUND" {
		return http.StatusNotFound
	}
	return http.StatusConflict
}

func writeErr(w http.ResponseWriter, status int, err error) {
	var ie *ipcerr.Error
	if !errors.As(err, &ie) {
		slog.Warn("mobileterm: attach", "scope", "mobileweb", "err", err)
		ie = ipcerr.New("E_INTERNAL", "internal error")
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]string{"code": ie.Code, "message": ie.Message})
}
