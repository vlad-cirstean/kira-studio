package repomap

import (
	"bufio"
	"bytes"
	"context"
	"fmt"
	"os"
	"sort"
	"strings"
	"unicode/utf8"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/codegraph"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/pathsafe"
)

// sourceLineMaxBytes is the per-line display cap (C8 plan D3): truncate, never omit, cutting on a
// UTF-8 rune boundary. This bounds what goes into an LLM's context, not memory — see
// sourceReadBufBytes for that.
const sourceLineMaxBytes = 512

// sourceReadBufBytes is readRows' own bufio.Reader size. It bounds peak memory per file at 64 KiB
// regardless of a line's own length, since an over-long line is drained via ReadSlice, never
// buffered whole (readLine's own doc comment).
const sourceReadBufBytes = 64 * 1024

// sourceLine is one hit's own line of code as read from disk — or the honest reason it is absent
// (C8 plan D5).
type sourceLine struct {
	Text      string // trimmed, truncated and sanitised; empty when Note is set
	Truncated bool   // Text was cut at sourceLineMaxBytes
	Stale     bool   // the file on disk no longer matches the row the index was built from
	Note      string // non-empty means no line: "file not found", "unreadable", ...
}

// sourceLines is path -> 0-based row -> line. A nil map answers "not found" for everything, which
// is exactly what every renderer does with a missing entry: print nothing extra.
type sourceLines map[string]map[int]sourceLine

// at looks up path/row, answering false for a nil map, a missing path, or a missing row alike —
// callers never need to distinguish those.
func (s sourceLines) at(path string, row int) (sourceLine, bool) {
	if s == nil {
		return sourceLine{}, false
	}
	rows, ok := s[path]
	if !ok {
		return sourceLine{}, false
	}
	ln, ok := rows[row]
	return ln, ok
}

// hitPos is one position a renderer is about to print — the (path, row) pair position() renders.
type hitPos struct {
	Path string
	Row  int // 0-based, as codegraph stores it
}

// readLine returns one line's first sourceLineMaxBytes bytes (EOL excluded), whether it was cut,
// and whether EOF ended the file before any byte of this line was read. An over-long line is
// drained, never buffered whole — peak memory is sourceReadBufBytes, not the line's own length.
//
// Deliberately bufio.Reader.ReadSlice, not bufio.Scanner: Scanner aborts the whole scan with
// ErrTooLong on the first over-long line, which would silently drop the source line of every later
// hit in the same file — exactly the failure a minified vendored file in the middle of a
// search_symbols response would cause. ReadSlice returns ErrBufferFull and lets the caller keep
// going.
func readLine(r *bufio.Reader) (buf []byte, truncated bool, eof bool) {
	var kept []byte
	sawAny := false
	for {
		chunk, err := r.ReadSlice('\n')
		sawAny = sawAny || len(chunk) > 0

		// ReadSlice returns nil err only once it has found the delimiter, with the delimiter as
		// chunk's own last byte — drop it here so callers never see it (a CRLF line's own '\r'
		// stays; sanitiseLine strips that separately).
		content := chunk
		gotEOL := err == nil
		if gotEOL {
			content = content[:len(content)-1]
		}

		if len(kept) < sourceLineMaxBytes {
			room := sourceLineMaxBytes - len(kept)
			take := content
			if len(take) > room {
				take = take[:room]
				truncated = true
			}
			// ReadSlice's returned slice is only valid until the next read; copy what is kept.
			kept = append(kept, take...)
		} else if len(content) > 0 {
			truncated = true
		}

		switch err {
		case nil:
			return kept, truncated, false
		case bufio.ErrBufferFull:
			// No '\n' yet within this internal buffer's capacity; loop for more of the same line.
			continue
		default:
			// EOF (or another read error, treated the same): this line ends here, no trailing
			// newline. eof-with-no-bytes-at-all means there was no such line to read.
			return kept, truncated, !sawAny
		}
	}
}

// readRows walks f from row 0 in one forward pass, capturing the lines named by rows (any order,
// duplicates fine) and stopping once the highest requested row has been read. EOF before a wanted
// row — including every row after it — gets Note: "line N past end of file" (1-based in the
// message, matching every other 1-based position this server prints).
func readRows(f *os.File, rows []int) map[int]sourceLine {
	wanted := make([]int, len(rows))
	copy(wanted, rows)
	sort.Ints(wanted)

	out := make(map[int]sourceLine, len(wanted))
	if len(wanted) == 0 {
		return out
	}
	last := wanted[len(wanted)-1]

	r := bufio.NewReaderSize(f, sourceReadBufBytes)
	wi := 0
	for row := 0; row <= last; row++ {
		buf, truncated, eof := readLine(r)
		if eof && len(buf) == 0 {
			for ; wi < len(wanted) && wanted[wi] <= last; wi++ {
				w := wanted[wi]
				if _, already := out[w]; already {
					continue
				}
				out[w] = sourceLine{Note: fmt.Sprintf("line %d past end of file", w+1)}
			}
			return out
		}
		for wi < len(wanted) && wanted[wi] == row {
			// A line empty after sanitising (Text == "" and Note == "") gets no entry at all —
			// nothing to say, and sourceLines.at's caller treats a missing entry and an empty
			// one identically anyway (C8 plan §4.4 step 6).
			if ln := sanitiseLine(buf, truncated); ln.Text != "" || ln.Note != "" {
				out[row] = ln
			}
			wi++
		}
	}
	return out
}

// sanitiseLine applies C8 plan §4.4's sanitising order to one raw line (EOL not yet stripped by
// the caller — readLine's own contract keeps a trailing '\n' out, but a CRLF file's '\r' is still
// present and stripped here).
func sanitiseLine(raw []byte, truncated bool) sourceLine {
	raw = bytes.TrimSuffix(raw, []byte("\r"))

	if bytes.IndexByte(raw, 0x00) >= 0 {
		return sourceLine{Note: "binary content"}
	}

	if len(raw) > sourceLineMaxBytes {
		raw = raw[:sourceLineMaxBytes]
		truncated = true
	}
	if truncated {
		// Back off to the last full rune so a multi-byte character straddling the cut is never
		// halved into invalid UTF-8.
		for len(raw) > 0 && !utf8.RuneStart(raw[len(raw)-1]) {
			raw = raw[:len(raw)-1]
		}
		if len(raw) > 0 {
			if r, size := utf8.DecodeLastRune(raw); r == utf8.RuneError && size == 1 {
				// Truncation landed on an incomplete final rune even after backing off to the
				// last start byte (a multi-byte sequence with room for its lead byte only) —
				// drop that lead byte too.
				raw = raw[:len(raw)-1]
			}
		}
	}

	text := strings.TrimSpace(string(raw))
	if text == "" {
		return sourceLine{}
	}

	var b strings.Builder
	b.Grow(len(text))
	for _, r := range text {
		switch {
		case r == '\t':
			b.WriteByte(' ')
		case r < 0x20 || r == 0x7f:
			b.WriteRune('�')
		default:
			b.WriteRune(r)
		}
	}
	text = b.String()
	if text == "" {
		return sourceLine{}
	}
	return sourceLine{Text: text, Truncated: truncated}
}

// sourceFor reads the literal source line at each of hits' positions (C8 plan §4.2): group by
// file, one open, one forward pass per file (D1), staleness stamped against the indexed row (D4).
// Never returns an error — a path or store failure degrades one file's lines, never the response.
func (s *Server) sourceFor(ctx context.Context, hits []hitPos) sourceLines {
	byPath := make(map[string][]int)
	order := make([]string, 0, len(hits))
	for _, h := range hits {
		if _, ok := byPath[h.Path]; !ok {
			order = append(order, h.Path)
		}
		byPath[h.Path] = append(byPath[h.Path], h.Row)
	}

	out := make(sourceLines, len(order))
	for _, path := range order {
		if ctx.Err() != nil {
			return out
		}
		out[path] = s.sourceForOneFile(ctx, path, byPath[path])
	}
	return out
}

// sourceForOneFile resolves, opens, stats and reads one file's wanted rows, applying D5's whole
// safe-failure table on any step that fails.
func (s *Server) sourceForOneFile(ctx context.Context, path string, rows []int) map[int]sourceLine {
	noteAll := func(reason string) map[int]sourceLine {
		out := make(map[int]sourceLine, len(rows))
		for _, row := range rows {
			out[row] = sourceLine{Note: reason}
		}
		return out
	}

	abs, err := pathsafe.ValidateRelPath(s.root, path)
	if err != nil {
		return noteAll("path outside repository")
	}

	// A missing or errored index row leaves staleness simply unknown — read the line anyway,
	// unstamped: an unknown is not a lie, and the index having no row yet for a path it just
	// returned a hit from is itself a transient, not a fault (C8 plan §4.2 step b).
	row, hadRow, _ := s.store.GetFile(ctx, s.repoID, path)

	f, err := os.Open(abs) //nolint:gosec // abs already validated (pathsafe.ValidateRelPath).
	if err != nil {
		if os.IsNotExist(err) {
			return noteAll("file not found")
		}
		return noteAll("unreadable")
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return noteAll("unreadable")
	}
	if !info.Mode().IsRegular() {
		return noteAll("not a regular file")
	}

	stale := hadRow && !row.MatchesDisk(info)

	lines := readRows(f, rows)
	if stale {
		for r, ln := range lines {
			if ln.Note == "" {
				ln.Stale = true
				lines[r] = ln
			}
		}
	}
	return lines
}

// sourceForTargets adapts a Target slice (find_definition, find_implementations, search_symbols,
// and the ambiguous-candidates list) to sourceFor, reading each target's own NameSpan — the
// position position() renders, so the printed line number and the printed text can never disagree
// (C8 plan §5). Returns nil immediately when omit is set (D8's opt-out), so a caller that wants the
// old compact shape pays nothing for it.
func (s *Server) sourceForTargets(ctx context.Context, omit bool, targets []codegraph.Target) sourceLines {
	if omit || len(targets) == 0 {
		return nil
	}
	hits := make([]hitPos, len(targets))
	for i, t := range targets {
		hits[i] = hitPos{Path: t.Path, Row: t.NameSpan.Start.Row}
	}
	return s.sourceFor(ctx, hits)
}

// sourceForSites adapts a Site slice (find_references) to sourceFor — Site's own peer of
// sourceForTargets.
func (s *Server) sourceForSites(ctx context.Context, omit bool, sites []codegraph.Site) sourceLines {
	if omit || len(sites) == 0 {
		return nil
	}
	hits := make([]hitPos, len(sites))
	for i, site := range sites {
		hits[i] = hitPos{Path: site.Path, Row: site.NameSpan.Start.Row}
	}
	return s.sourceFor(ctx, hits)
}
