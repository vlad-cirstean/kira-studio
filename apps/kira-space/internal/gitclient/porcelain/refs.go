package porcelain

import (
	"bytes"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-space/internal/gitpath"
)

// RefsFormat is refs.list's own eleven-field for-each-ref format (D10), %00-delimited (F3, not
// %1f): %(taggername) is attacker-controlled (a tag's tagger identity) and CAN carry a literal
// 0x1f — verified against real git 2.43 — which would silently shift %(taggerdate:unix) and, on
// TagRefsFormat's own extension, the annotation's subject/body after it. NUL is the one byte git
// guarantees can never appear inside any of its own field values, so it is the only delimiter safe
// in a non-last position. Records are delimited by the trailing \n for-each-ref always appends.
// Probed against real git 2.43: both %1f and %00 expand under for-each-ref's own %NN escape syntax
// (distinct from `git log --pretty`'s %x1f/%x00, which LogFormat uses instead).
const RefsFormat = "%(refname)%00%(objectname)%00%(objecttype)%00%(upstream)%00%(upstream:track)%00" +
	"%(committerdate:unix)%00%(HEAD)%00%(*objectname)%00%(worktreepath)%00%(taggername)%00%(taggerdate:unix)"

// refsFieldCount is RefsFormat's own field count.
const refsFieldCount = 11

// TagRefsFormat is the tags-only scope's own format — RefsFormat plus the annotation's
// subject/body, %00-delimited same as every other field (F3) and NUL-terminated: an annotation
// body legally contains raw newlines, so this one spawn is NUL-framed rather than LF-framed (D10).
// git still appends its own trailing "\n" after the literal %00, same as before F3 — parseRefRowsNUL's
// own doc comment covers the resulting byte layout in detail.
const TagRefsFormat = RefsFormat + "%00%(contents:subject)%00%(contents:body)%00"

// tagRefsFieldCount is TagRefsFormat's own field count.
const tagRefsFieldCount = 13

// HeadsRefsArgs is refs.list's branches+remote-branches spawn — committer-date order, upstream's
// own sort for the branch picker. --exclude (G32 round-3 functional-correctness review, finding
// #5) drops refs/remotes/<remote>/HEAD, the symbolic pointer every `git clone`d repo carries —
// left in, it showed as a phantom third badge alongside the real default branch's own remote
// tracking badge, appeared in the branch picker as a checkout-able row, and actually attempting
// that checkout failed outright ("HEAD" is not a legal branch name). Verified against real git
// 2.43: --exclude combines with the positive refs/heads/refs/remotes patterns rather than
// replacing them.
func HeadsRefsArgs() []string {
	return []string{
		"for-each-ref", "--format=" + RefsFormat, "--sort=-committerdate",
		"--exclude=refs/remotes/*/HEAD", "refs/heads", "refs/remotes",
	}
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

// parseRefRow parses one already-split for-each-ref record — fields must be exactly refsFieldCount
// (withSubject false) or tagRefsFieldCount (true) entries long, one per RefsFormat/TagRefsFormat
// field in order (F3: NUL-delimited fields arrive pre-split, never re-split here).
func parseRefRow(fields [][]byte, withSubject bool) (RefRow, error) {
	n := refsFieldCount
	if withSubject {
		n = tagRefsFieldCount
	}
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

// parseRefRowsLF splits HeadsRefsArgs/SingleRefArgs' own stream by line, then each line's own
// RefsFormat fields by NUL (F3) — a plain, exact split, no absorb-the-last-field trick needed:
// NUL cannot appear inside any git field value, so there is never a stray delimiter to worry
// about, unlike the old %1f design.
func parseRefRowsLF(raw []byte) ([]RefRow, error) {
	text := strings.TrimSuffix(string(raw), "\n")
	if text == "" {
		return nil, nil
	}
	lines := strings.Split(text, "\n")
	rows := make([]RefRow, 0, len(lines))
	for _, line := range lines {
		fields := bytes.Split([]byte(line), []byte{0})
		row, err := parseRefRow(fields, false)
		if err != nil {
			return nil, err
		}
		rows = append(rows, row)
	}
	return rows, nil
}

// parseRefRowsNUL parses TagRefsFormat's own byte stream (F3: every field, not just the record
// terminator, is now %00-delimited — field and record boundaries are the identical byte). git
// still appends its own automatic "\n" after each formatted record regardless of what --format
// contains, so the raw stream is `<f1>\0<f2>\0...\0<fN>\0\n<f1>\0...\0<fN>\0\n...`: splitting the
// WHOLE stream on NUL yields a flat token list where every tagRefsFieldCount-th token (barring the
// first record) carries a leading "\n" glued on by that automatic terminator, and the very last
// split part is exactly "\n" with nothing after it. Grouping fixed-size chunks (tagRefsFieldCount
// fields each) is what finds each record's own boundary, the same principle
// porcelain.FieldGrouper applies to LogFormat/ScanFormat.
func parseRefRowsNUL(raw []byte) ([]RefRow, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	parts := bytes.Split(raw, []byte{0})
	last := parts[len(parts)-1]
	if string(last) != "\n" {
		return nil, fmt.Errorf("porcelain: tag refs stream has unexpected trailing bytes: %q", last)
	}
	tokens := parts[:len(parts)-1]
	if len(tokens)%tagRefsFieldCount != 0 {
		return nil, fmt.Errorf("porcelain: tag refs stream has %d fields, not a multiple of %d", len(tokens), tagRefsFieldCount)
	}

	rows := make([]RefRow, 0, len(tokens)/tagRefsFieldCount)
	for i := 0; i < len(tokens); i += tagRefsFieldCount {
		group := make([][]byte, tagRefsFieldCount)
		copy(group, tokens[i:i+tagRefsFieldCount])
		if i > 0 {
			if len(group[0]) == 0 || group[0][0] != '\n' {
				return nil, fmt.Errorf("porcelain: tag refs record %d missing its leading newline", i/tagRefsFieldCount)
			}
			group[0] = group[0][1:]
		}
		row, err := parseRefRow(group, true)
		if err != nil {
			return nil, err
		}
		rows = append(rows, row)
	}
	return rows, nil
}
