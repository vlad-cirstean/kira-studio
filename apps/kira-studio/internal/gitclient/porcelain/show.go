package porcelain

import (
	"fmt"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

// ShowMetadataArgs is commit.detail's first spawn (D8): the log walk's own format, so its parser
// (ParseLogRecord) is exactly the one that already exists — F6, resolved.
func ShowMetadataArgs(sha string) []string {
	return []string{"show", "-s", "--decorate=full", "-z", "--format=" + LogFormat, sha}
}

// bodyAndSignatureFieldCount is bodyAndSignatureFormat's own field count.
const bodyAndSignatureFieldCount = 4

// bodyAndSignatureFormat is upstream's own %G?/%GS/%(trailers)/%b format — body last (probe P5),
// so a stray 0x1f inside a commit message can only ever corrupt the field that is already last.
const bodyAndSignatureFormat = "%G?%x1f%GS%x1f%(trailers:only=true,unfold=true)%x1f%b"

// ShowBodyAndSignatureArgs is commit.detail's second spawn: the minimal `show` that reads
// signature status/signer, git's own parsed trailer block, and the raw body.
func ShowBodyAndSignatureArgs(sha string) []string {
	return []string{"show", "-s", "-z", "--format=" + bodyAndSignatureFormat, sha}
}

// SignatureStatus mirrors @kira/git-ipc's own SignatureStatus — `%G?`'s raw one-letter code.
type SignatureStatus string

// CommitSignature mirrors @kira/git-ipc's own signature shape.
type CommitSignature struct {
	Status SignatureStatus `json:"status"`
	Signer string          `json:"signer"`
}

// CommitTrailer mirrors @kira/git-ipc's own CommitTrailer.
type CommitTrailer struct {
	Token string `json:"token"`
	Value string `json:"value"`
}

// CommitDetail is commit.detail's own wire result — structurally matches @kira/git-ipc's
// 'commit.detail' result field for field (D5). Files is CombineFileChanges's own output, always
// in --name-status order (D17).
type CommitDetail struct {
	SHA         string          `json:"sha"`
	Parents     []string        `json:"parents"`
	Author      CommitIdentity  `json:"author"`
	Committer   CommitIdentity  `json:"committer"`
	Subject     string          `json:"subject"`
	Body        string          `json:"body"`
	Trailers    []CommitTrailer `json:"trailers"`
	Signature   CommitSignature `json:"signature"`
	Decoration  []DecorationRef `json:"decoration"`
	ParentIndex int             `json:"parentIndex"`
	Files       []FileChange    `json:"files"`
}

// ParseTrailerBlock splits git's own `%(trailers:only=true,unfold=true)` output — one trailer per
// line, already unfolded — into structured CommitTrailer rows. Blank lines (a commit with no
// trailers produces an empty field) are skipped.
func ParseTrailerBlock(raw []byte) []CommitTrailer {
	var out []CommitTrailer
	for _, line := range strings.Split(string(raw), "\n") {
		if line == "" {
			continue
		}
		idx := strings.Index(line, ": ")
		if idx < 0 {
			// Malformed relative to git's own promised shape — kept verbatim as a valueless
			// trailer rather than dropped, so a caller still sees every line git reported.
			out = append(out, CommitTrailer{Token: line})
			continue
		}
		out = append(out, CommitTrailer{Token: line[:idx], Value: line[idx+2:]})
	}
	return out
}

var trailerLineRe = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9-]*:`)

func isFoldedContinuation(line string) bool {
	if line == "" {
		return false
	}
	r, _ := utf8.DecodeRuneInString(line)
	return unicode.IsSpace(r)
}

// SplitTrailerBlock removes the trailer paragraph `%b` still contains verbatim (D9, porting
// @kira/git-core's own model/diff.ts rule so the field means the same thing on both hops of the
// wire): take the final blank-line-separated paragraph of body; drop it iff at least one trailer
// was returned *and* every line of that paragraph either looks like a trailer
// (`^[A-Za-z][A-Za-z0-9-]*:`) or is a folded continuation (starts with whitespace). No trailers ⇒
// body returned unchanged, without inspecting it at all.
func SplitTrailerBlock(body string, trailers []CommitTrailer) string {
	if len(trailers) == 0 {
		return body
	}
	lines := strings.Split(body, "\n")
	end := len(lines)
	for end > 0 && strings.TrimSpace(lines[end-1]) == "" {
		end--
	}
	if end == 0 {
		return body
	}
	start := end
	for start > 0 && strings.TrimSpace(lines[start-1]) != "" {
		start--
	}
	paragraph := lines[start:end]
	for _, line := range paragraph {
		if !trailerLineRe.MatchString(line) && !isFoldedContinuation(line) {
			return body
		}
	}
	before := lines[:start]
	for len(before) > 0 && strings.TrimSpace(before[len(before)-1]) == "" {
		before = before[:len(before)-1]
	}
	return strings.Join(before, "\n")
}

// ParseShowBodyAndSignature parses ShowBodyAndSignatureArgs' own record: signature status/signer,
// structured trailers, and body with its trailer paragraph already removed (D9).
func ParseShowBodyAndSignature(record []byte) (CommitSignature, []CommitTrailer, string, error) {
	fields := SplitLimitedFields(record, fieldDelim, bodyAndSignatureFieldCount)
	if len(fields) != bodyAndSignatureFieldCount {
		return CommitSignature{}, nil, "", fmt.Errorf(
			"porcelain: body/signature record has %d fields, want %d", len(fields), bodyAndSignatureFieldCount,
		)
	}
	sig := CommitSignature{Status: SignatureStatus(fields[0]), Signer: string(fields[1])}
	trailers := ParseTrailerBlock(fields[2])
	body := SplitTrailerBlock(string(fields[3]), trailers)
	return sig, trailers, body, nil
}
