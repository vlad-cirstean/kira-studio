// Package memfmt defines the two grep-first text formats for memory facts, a code comment block
// and a doc file, with one parser, one formatter and one regex per format. Pure: no I/O.
package memfmt

import (
	"fmt"
	"regexp"
)

const (
	// FactID and GroupID are the id shapes as regex source: prefix plus 12 Crockford base32 chars.
	FactID  = `km_[0-9a-hjkmnp-tv-z]{12}`
	GroupID = `kg_[0-9a-hjkmnp-tv-z]{12}`

	// CommentLineSource and DocLineSource match every line of a valid block or doc. They use the
	// ERE subset shared by Go RE2 and grep -E. Block and doc rules need the parser.
	CommentLineSource = `^[[:space:]]*(//|#|--|;|%|<!--|/\*) (kira-memory origin=(user|agent|external source=[a-z0-9-]{1,32}) scope=(company|project|personal)( -->| \*/)?|` + FactID + ` [^[:space:]].*|  [^[:space:]].*)$`
	DocLineSource     = `^(---|kira-memory: 2|(group|title|from|origin|source|scope|project|session|keywords|updated): [^[:space:]].*|- ` + FactID + ` [^[:space:]].*|  [^[:space:]].*|#{1,6} [^[:space:]].*|)$`
)

var (
	CommentLine = regexp.MustCompile(CommentLineSource)
	DocLine     = regexp.MustCompile(DocLineSource)
)

// Provenance is who decided the facts and where they apply. Comments carry origin, source and
// scope only; docs carry all five.
type Provenance struct {
	Origin  string
	Source  string
	Scope   string
	Project string
	Session string
}

// Fact is one fact with its optional reason. Line and Section are set by the parsers only.
type Fact struct {
	ID      string
	Fact    string
	Reason  string
	Line    int
	Section string
}

// Block is one comment block: a header and its facts.
type Block struct {
	Provenance
	Facts []Fact
	Line  int
}

// Doc is one doc file. From is the job-relative path of the source its facts were stated in. Version
// is the format version the parser read (2; 1 for the retired format, which yields no facts).
type Doc struct {
	Group    string
	Title    string
	From     string
	Version  int
	Keywords []string
	Updated  string
	Provenance
	Facts []Fact
}

// Problem is one rule violation at a 1-based line.
type Problem struct {
	Line int
	Msg  string
}

func (p Problem) String() string { return fmt.Sprintf("%d: %s", p.Line, p.Msg) }
