package catfile

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"strconv"
	"strings"
)

// ObjectInfo is one found `cat-file --batch[-check]` response header.
type ObjectInfo struct {
	OID  string
	Type string
	Size int64
}

// ErrMissing is the outcome for a revision git could not resolve — a normal, expected answer, not
// a process failure.
var ErrMissing = errors.New("catfile: object missing")

// readHeader reads one response's header line (up to LF) and reports whether the object was
// found. Missing is recognised by the line's own " missing" suffix, not by counting fields: git
// echoes the *input* verbatim ahead of it (`<input> missing`), and the input for a `<rev>:<path>`
// request can itself contain spaces, so a naive field-count/split heuristic cannot tell a found
// line from a missing one reliably. The suffix can: a found line's third field is always numeric
// and can never literally read "missing".
func readHeader(r *bufio.Reader) (ObjectInfo, bool, error) {
	line, err := r.ReadString('\n')
	if err != nil {
		return ObjectInfo{}, false, err
	}
	line = strings.TrimSuffix(line, "\n")
	if strings.HasSuffix(line, " missing") {
		return ObjectInfo{}, false, nil
	}
	fields := strings.SplitN(line, " ", 3)
	if len(fields) != 3 {
		return ObjectInfo{}, false, fmt.Errorf("catfile: unrecognised batch header %q", line)
	}
	size, err := strconv.ParseInt(fields[2], 10, 64)
	if err != nil {
		return ObjectInfo{}, false, fmt.Errorf("catfile: unrecognised size in header %q: %w", line, err)
	}
	return ObjectInfo{OID: fields[0], Type: fields[1], Size: size}, true, nil
}

// readContent reads exactly n bytes of object content plus the protocol's own trailing LF —
// `--batch`'s framing after a found header (catFile.ts's own two-phase state machine, ported).
func readContent(r *bufio.Reader, n int64) ([]byte, error) {
	buf := make([]byte, n)
	if _, err := io.ReadFull(r, buf); err != nil {
		return nil, err
	}
	var trailer [1]byte
	if _, err := io.ReadFull(r, trailer[:]); err != nil {
		return nil, err
	}
	if trailer[0] != '\n' {
		return nil, fmt.Errorf("catfile: expected a trailing LF after %d content bytes, got %q", n, trailer[0])
	}
	return buf, nil
}
