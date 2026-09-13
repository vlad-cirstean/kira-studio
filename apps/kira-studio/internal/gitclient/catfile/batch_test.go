package catfile

import (
	"bufio"
	"io"
	"strings"
	"testing"
)

// dripReader releases at most n bytes per Read call regardless of how much the caller asked for —
// simulating a response split across arbitrary socket/pipe read boundaries, the case
// readHeader/readContent's own io.ReadFull-based framing exists to survive.
type dripReader struct {
	data []byte
	n    int
}

func (d *dripReader) Read(p []byte) (int, error) {
	if len(d.data) == 0 {
		return 0, io.EOF
	}
	k := d.n
	if k > len(p) {
		k = len(p)
	}
	if k > len(d.data) {
		k = len(d.data)
	}
	if k == 0 {
		k = 1
	}
	n := copy(p, d.data[:k])
	d.data = d.data[n:]
	return n, nil
}

func TestBatchFraming_ResponseSplitAcrossArbitraryReadBoundaries(t *testing.T) {
	header := "0123456789abcdef0123456789abcdef01234567 blob 5\n"
	content := "hello"
	raw := header + content + "\n"
	r := bufio.NewReader(&dripReader{data: []byte(raw), n: 3})

	info, found, err := readHeader(r)
	if err != nil || !found {
		t.Fatalf("readHeader: found=%v err=%v", found, err)
	}
	if info.OID != "0123456789abcdef0123456789abcdef01234567" || info.Type != "blob" || info.Size != 5 {
		t.Fatalf("info = %+v", info)
	}
	got, err := readContent(r, info.Size)
	if err != nil {
		t.Fatalf("readContent: %v", err)
	}
	if string(got) != content {
		t.Fatalf("content = %q, want %q", got, content)
	}
}

func TestBatchFraming_MissingWithSpacesInEchoedInput(t *testing.T) {
	r := bufio.NewReader(&dripReader{data: []byte("HEAD:a file with spaces.txt missing\n"), n: 1})
	_, found, err := readHeader(r)
	if err != nil {
		t.Fatalf("readHeader: %v", err)
	}
	if found {
		t.Fatal("expected found=false for a 'missing' reply")
	}
}

func TestBatchFraming_ContentMissingTrailingLF(t *testing.T) {
	r := bufio.NewReader(strings.NewReader("hello"))
	if _, err := readContent(r, 5); err == nil {
		t.Fatal("expected an error when content is not followed by the protocol's trailing LF")
	}
}
