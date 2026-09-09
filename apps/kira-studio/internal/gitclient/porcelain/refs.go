package porcelain

import (
	"bytes"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitpath"
)

// RefsFormat is refs.list's own eleven-field for-each-ref format (D10) — %1f between fields,
// records delimited by the trailing \n for-each-ref always appends. Probed against real git 2.43:
// both %1f and %00 expand under for-each-ref's own %NN escape syntax (distinct from `git log
// --pretty`'s %x1f, which G3 D9's narrower RefSnapshotArgs uses instead).
const RefsFormat = "%(refname)%1f%(objectname)%1f%(objecttype)%1f%(upstream)%1f%(upstream:track)%1f" +
	"%(committerdate:unix)%1f%(HEAD)%1f%(*objectname)%1f%(worktreepath)%1f%(taggername)%1f%(taggerdate:unix)"

// refsFieldCount is RefsFormat's own field count.
const refsFieldCount = 11

// TagRefsFormat is the tags-only scope's own format — RefsFormat plus the annotation's
// subject/body, NUL-terminated: an annotation body legally contains raw newlines, so this one
// spawn is NUL-framed rather than LF-framed (D10). git still appends its own trailing "\n" after
// the literal %00, so ParseRefRows' NUL branch strips a leading "\n" from every record after the
// first and requires the flush remainder to be exactly "\n".
const TagRefsFormat = RefsFormat + "%1f%(contents:subject)%1f%(contents:body)%00"

// tagRefsFieldCount is TagRefsFormat's own field count.
const tagRefsFieldCount = 13

// HeadsRefsArgs is refs.list's branches+remote-branches spawn — committer-date order, upstream's
// own sort for the branch picker.
func HeadsRefsArgs() []string {
	return []string{"for-each-ref", "--format=" + RefsFormat, "--sort=-committerdate", "refs/heads", "refs/remotes"}
}

// TagRefsArgs is refs.list's tags-only spawn — version-aware sort (§7.9: v10 after v9, which git
// does correctly and no client-side sort should reimplement).
func TagRefsArgs() []string {
	return []string{"for-each-ref", "--format=" + TagRefsFormat, "--sort=-v:refname", "refs/tags"}
}

// SingleRefArgs is one for-each-ref record for exactly one refname — the undo capture's own read
// (D7's tag-delete capture), never NUL-framed since it never needs an annotation body.
func SingleRefArgs(refname string) []string {
	return []string{"for-each-ref", "--format=" + RefsFormat, refname}
}

// RefTrack mirrors @kira/git-ipc's own RefTrack — ahead/behind counts against an upstream.
type RefTrack struct {
	Ahead  int `json:"ahead"`
	Behind int `json:"behind"`
}

// TagAnnotation mirrors @kira/git-ipc's own TagAnnotation — present only for an annotated tag
// (probe P3: a lightweight tag's %(contents:subject) borrows the pointed-at commit's subject,
// which this type must never store).
type TagAnnotation struct {
	Tagger  string `json:"tagger"`
	Date    int64  `json:"date"`
	Subject string `json:"subject"`
	Body    string `json:"body"`
}

// RefRow mirrors @kira/git-ipc's own RefRow field for field (D5's encoding rule: undefined fields
// are omitted, never present-and-null). ObjectType is parsed but never crosses the wire (json:"-")
// — its one consumer is the tag-delete undo capture, which needs it to choose the replay sha.
type RefRow struct {
	Refname        string  `json:"refname"`
	Kind           string  `json:"kind"` // "branch" | "remoteBranch" | "tag"
	ShortName      string  `json:"shortName"`
	ObjectID       string  `json:"objectId"`
	PeeledObjectID *string `json:"peeledObjectId,omitempty"`
	Upstream       *string `json:"upstream,omitempty"`
	// Track is RefTrack{...}, the string "gone", or nil (omitted) — a three-way union Go has no
	// direct equivalent for; `any` reproduces the wire shape byte-identically at the cost of a
	// caller-visible type switch, which this field's one caller (refs.list's handler) already does.
	Track         any            `json:"track,omitempty"`
	CommitterDate int64          `json:"committerDate"`
	IsHead        bool           `json:"isHead"`
	CheckedOutIn  *string        `json:"checkedOutIn,omitempty"`
	Annotation    *TagAnnotation `json:"annotation,omitempty"`

	ObjectType string `json:"-"`
}

var trackAheadRe = regexp.MustCompile(`ahead (\d+)`)
var trackBehindRe = regexp.MustCompile(`behind (\d+)`)

func parseTrack(raw string) any {
	if raw == "" {
		return nil
	}
	if raw == "[gone]" {
		return "gone"
	}
	track := RefTrack{}
	if m := trackAheadRe.FindStringSubmatch(raw); m != nil {
		track.Ahead, _ = strconv.Atoi(m[1])
	}
	if m := trackBehindRe.FindStringSubmatch(raw); m != nil {
		track.Behind, _ = strconv.Atoi(m[1])
	}
	return track
}

func classifyRef(refname string) (kind, shortName string) {
	switch {
	case strings.HasPrefix(refname, "refs/heads/"):
		return "branch", refname[len("refs/heads/"):]
	case strings.HasPrefix(refname, "refs/remotes/"):
		return "remoteBranch", refname[len("refs/remotes/"):]
	default:
		return "tag", strings.TrimPrefix(refname, "refs/tags/")
	}
}

func nonEmptyPtr(s string) *string {
	if s == "" {
		return nil
	}
	v := s
	return &v
}

// parseRefRow parses one already-delimited for-each-ref record. withSubject must match which spawn
// produced it — true only for TagRefsArgs' own TagRefsFormat records.
func parseRefRow(record []byte, withSubject bool) (RefRow, error) {
	n := refsFieldCount
	if withSubject {
		n = tagRefsFieldCount
	}
	fields := SplitLimitedFields(record, fieldDelim, n)
	if len(fields) != n {
		return RefRow{}, fmt.Errorf("porcelain: ref record has %d fields, want %d", len(fields), n)
	}

	refname := string(fields[0])
	objectID := string(fields[1])
	objectType := string(fields[2])
	upstream := string(fields[3])
	trackRaw := string(fields[4])
	committerDate, _ := strconv.ParseInt(string(fields[5]), 10, 64)
	headMarker := string(fields[6])
	peeled := string(fields[7])
	// G27 D5c: %(worktreepath) is an absolute worktree directory (D2 tier 1), not a repository-
	// relative file path -- normalized to NFC so it agrees with Identify's own already-composed
	// Root (D5a) when gitsession's subtractOwnWorktree compares the two (F4).
	worktreePath := gitpath.NFC(string(fields[8]))
	taggerName := string(fields[9])
	taggerDate := string(fields[10])
	var subject, body string
	if withSubject {
		subject = string(fields[11])
		body = string(fields[12])
	}

	kind, shortName := classifyRef(refname)
	isTag := objectType == "tag"

	var annotation *TagAnnotation
	if isTag && taggerName != "" {
		date, _ := strconv.ParseInt(taggerDate, 10, 64)
		annotation = &TagAnnotation{Tagger: taggerName, Date: date, Subject: subject, Body: body}
	}

	return RefRow{
		Refname: refname, Kind: kind, ShortName: shortName,
		ObjectID: objectID, PeeledObjectID: nonEmptyPtr(peeled),
		Upstream: nonEmptyPtr(upstream), Track: parseTrack(trackRaw),
		CommitterDate: committerDate, IsHead: headMarker == "*",
		CheckedOutIn: nonEmptyPtr(worktreePath), Annotation: annotation,
		ObjectType: objectType,
	}, nil
}

// ParseRefRows parses HeadsRefsArgs/SingleRefArgs' own LF-framed stream (withSubject=false) or
// TagRefsArgs' own NUL-framed one (withSubject=true, probe P1). The two framings differ because an
// annotation body can contain a raw newline the LF framing cannot carry.
func ParseRefRows(raw []byte, withSubject bool) ([]RefRow, error) {
	if withSubject {
		return parseRefRowsNUL(raw)
	}
	return parseRefRowsLF(raw)
}

func parseRefRowsLF(raw []byte) ([]RefRow, error) {
	text := strings.TrimSuffix(string(raw), "\n")
	if text == "" {
		return nil, nil
	}
	lines := strings.Split(text, "\n")
	rows := make([]RefRow, 0, len(lines))
	for _, line := range lines {
		row, err := parseRefRow([]byte(line), false)
		if err != nil {
			return nil, err
		}
		rows = append(rows, row)
	}
	return rows, nil
}

// parseRefRowsNUL parses TagRefsFormat's own byte stream: git terminates each record with the
// format's own literal %00, then unconditionally appends its own "\n" — so the stream is
// `<rec>\0\n<rec>\0\n…<rec>\0\n`, splitting on NUL leaves a leading "\n" on every record but the
// first, and the final split's remainder must be exactly "\n" (probe P1). Anything else is a
// malformed stream and an error, not a silent skip.
func parseRefRowsNUL(raw []byte) ([]RefRow, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	parts := bytes.Split(raw, []byte{0x00})
	last := parts[len(parts)-1]
	if string(last) != "\n" {
		return nil, fmt.Errorf("porcelain: tag refs stream has unexpected trailing bytes: %q", last)
	}
	recs := parts[:len(parts)-1]
	rows := make([]RefRow, 0, len(recs))
	for i, rec := range recs {
		if i > 0 {
			if len(rec) == 0 || rec[0] != '\n' {
				return nil, fmt.Errorf("porcelain: tag refs record %d missing its leading newline", i)
			}
			rec = rec[1:]
		}
		row, err := parseRefRow(rec, true)
		if err != nil {
			return nil, err
		}
		rows = append(rows, row)
	}
	return rows, nil
}
