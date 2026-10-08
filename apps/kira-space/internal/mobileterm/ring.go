// Package mobileterm lets a phone drive a claude-code agent terminal over a WebSocket while the
// desktop window keeps its own view. One Broker is the terminal.Arbiter for those terminals.
package mobileterm

// ringCap is the replay window per terminal.
const ringCap = 1 << 20

// Ring keeps the last ringCap bytes of a terminal's output under absolute offsets, so a
// reconnecting phone resumes from where it stopped. Not safe for concurrent use.
type Ring struct {
	buf []byte
	end int64
	cap int64
}

func newRing(capacity int) *Ring {
	return &Ring{buf: make([]byte, capacity), cap: int64(capacity)}
}

func (r *Ring) start() int64 { return max(0, r.end-r.cap) }

// End is the offset one past the newest byte.
func (r *Ring) End() int64 { return r.end }

// Append stores b, dropping the oldest bytes once full.
func (r *Ring) Append(b []byte) {
	if int64(len(b)) > r.cap {
		r.end += int64(len(b)) - r.cap
		b = b[int64(len(b))-r.cap:]
	}
	for len(b) > 0 {
		pos := int(r.end % r.cap)
		n := copy(r.buf[pos:], b)
		r.end += int64(n)
		b = b[n:]
	}
}

// ReadFrom returns up to limit bytes from off. When off fell out of the window it starts at the
// oldest byte and reports overrun. next is the offset after the returned data.
func (r *Ring) ReadFrom(off int64, limit int) (data []byte, next int64, overrun bool) {
	if s := r.start(); off < s {
		off, overrun = s, true
	}
	if off > r.end {
		off = r.end
	}
	n := min(int64(limit), r.end-off)
	if n <= 0 {
		return nil, off, overrun
	}
	data = make([]byte, 0, n)
	for int64(len(data)) < n {
		pos := int((off + int64(len(data))) % r.cap)
		chunk := min(n-int64(len(data)), r.cap-int64(pos))
		data = append(data, r.buf[pos:pos+int(chunk)]...)
	}
	return data, off + n, overrun
}

// Snapshot returns the whole window and the offset after it.
func (r *Ring) Snapshot() ([]byte, int64) {
	data, next, _ := r.ReadFrom(0, int(r.cap))
	return data, next
}
