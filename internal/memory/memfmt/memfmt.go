// Package memfmt defines the grep-first doc format for memory facts, with one parser, one
// formatter and one regex, plus the shared id and text rules. A code comment cites a memory by
// fact id only. Pure: no I/O.
package memfmt

import (
	"fmt"
	"path"
	"regexp"
	"strings"
)

const (
	// FactID and GroupID are the id shapes as regex source: prefix plus 12 Crockford base32 chars.
	FactID  = `km_[0-9a-hjkmnp-tv-z]{12}`
	GroupID = `kg_[0-9a-hjkmnp-tv-z]{12}`

	// DocLineSource matches every line of a valid doc. It uses the ERE subset shared by Go RE2 and
	// grep -E. Doc rules need the parser.
	DocLineSource = `^(---|kira-memory: 2|(group|title|from|origin|source|scope|project|session|keywords|updated): [^[:space:]].*|- ` + FactID + ` [^[:space:]].*|  [^[:space:]].*|#{1,6} [^[:space:]].*|)$`
)

var DocLine = regexp.MustCompile(DocLineSource)

// IsDocPath reports whether a path is a doc file candidate (.md or .txt).
func IsDocPath(p string) bool {
	switch strings.ToLower(path.Ext(p)) {
	case ".md", ".txt":
		return true
	}
	return false
}

// Provenance is who decided the facts and where they apply.
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
