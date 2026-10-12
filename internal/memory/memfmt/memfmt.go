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
	CommentLineSource = `^[[:space:]]*(//|#|--|;|%|<!--|/\*) (kira-memory origin=(user|agent|external source=[a-z0-9-]{1,32}) scope=(company|project|personal)( -->| \*/)?|` + FactID + ` (fact|reason): [^[:space:]].*)$`
	DocLineSource     = `^(---|kira-memory: 1|(group|title|origin|source|scope|project|session|keywords|updated): [^[:space:]].*|` + FactID + ` (fact|reason|keywords): [^[:space:]].*|#{1,6} [^[:space:]].*|)$`
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

// Fact is one fact with its reason. Line and Section are set by the parsers only.
type Fact struct {
	ID       string
	Fact     string
	Reason   string
	Keywords []string
	Line     int
	Section  string
}

// Block is one comment block: a header and its facts.
type Block struct {
	Provenance
	Facts []Fact
	Line  int
}

// Doc is one doc file.
type Doc struct {
	Group    string
	Title    string
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
