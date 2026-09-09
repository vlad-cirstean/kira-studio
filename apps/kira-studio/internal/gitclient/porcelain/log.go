package porcelain

import (
	"fmt"
	"strconv"
	"strings"
)

// LogFormat is upstream's own ten-%x1f-separated-field format string, subject last so it can
// safely absorb a stray 0x1f or a run of extra fields (SplitLimitedFields) — never reordered
// without also updating FieldCount and ParseLogRecord's own field indices below.
const LogFormat = "%H%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%cn%x1f%ce%x1f%ct%x1f%D%x1f%s"

// FieldCount is LogFormat's own field count.
const FieldCount = 10

// logBaseArgs is the walk's fixed argv prefix, shared by every consumer of LogFormat: decorate=
// full is load-bearing (short ref names cannot be classified — see parseDecorationToken),
// topo-order is what makes the graph's lanes meaningful, and -z is what makes RecordSplitter's
// NUL-delimited framing correct.
func logBaseArgs() []string {
	return []string{"log", "--decorate=full", "--topo-order", "-z", "--format=" + LogFormat}
}

// RangeToken builds a RangeSpec's own two-dot `<base>..<branch>` token — the range walk's and
// CountRangeArgs' shared construction site (D7b/upstream's own W2), so no call site can drift to
// three-dot.
func RangeToken(r RangeSpec) string {
	return r.Base + ".." + r.Branch
}

// RevSetArgs returns the argv fragment selecting spec's rev set — shared by the paged walk, the
// remaining-count query (`rev-list --count`) and G23's tail scan (LogScanArgs), so all three agree
// on exactly the same commits in exactly the same order (D8/D21). G3 always passes
// spec.IncludeStash=false (WalkArgs(spec) is then just `["--all"]` or `["HEAD"]`); G8 supplies
// real stash shas.
func RevSetArgs(spec WalkSpec) []string {
	var args []string
	switch {
	case spec.Range != nil:
		args = append(args, RangeToken(*spec.Range))
	case spec.Scope == "head":
		args = append(args, "HEAD")
	default: // "all", or unset -- "all" is the server's own default scope (D14).
		args = append(args, "--all")
	}
	if spec.IncludeStash {
		args = append(args, spec.StashShas...)
	}
	return args
}

// WalkArgs is RevSetArgs under the name every log/rev-list/scan argv builder below actually
// calls, matching upstream's own walkArgs/revSetArgs split.
func WalkArgs(spec WalkSpec) []string { return RevSetArgs(spec) }

// LogSessionArgs is the paged walk's full argv: the fixed log vocabulary plus spec's rev set.
func LogSessionArgs(spec WalkSpec) []string {
	return append(logBaseArgs(), WalkArgs(spec)...)
}

// LogSessionSkipArgs is LogSessionArgs with a `--skip` — the paged walk's resume-by-respawn argv
// (logsession's own reclaim path, D10).
func LogSessionSkipArgs(spec WalkSpec, skip int) []string {
	args := logBaseArgs()
	args = append(args, "--skip="+strconv.Itoa(skip))
	return append(args, WalkArgs(spec)...)
}

// ScanFormat is LogFormat plus the raw body, LAST — so SplitLimitedFields' "the final field
// absorbs every extra delimiter" rule keeps a body containing a stray 0x1f harmless, exactly why
// %s is last in LogFormat itself (G23 D1).
const ScanFormat = LogFormat + "%x1f%b"

// ScanFieldCount is ScanFormat's own field count.
const ScanFieldCount = 11

// LogScanArgs is G23's tail-scan argv: the same log vocabulary and the same WalkArgs(spec) call
// LogSessionArgs makes, with ScanFormat in place of LogFormat — this is what makes upstream probe
// 11's ordering property hold: the paging walk and the scan are the same --topo-order walk over
// the same rev set, so the loaded rows are a PREFIX of the scan's sequence and git-ui's
// buildCommitHits can concatenate the two halves without sorting anything. --decorate=full is kept
// even though ParseScanRecord discards %D unparsed (D2) — dropping it would change %D's own
// *content*, and the whole point of this function is that its argv differs from LogSessionArgs' in
// exactly one token (the format string).
func LogScanArgs(spec WalkSpec) []string {
	args := []string{"log", "--decorate=full", "--topo-order", "-z", "--format=" + ScanFormat}
	return append(args, WalkArgs(spec)...)
}

// ParseLogRecord parses one NUL-delimited record (as RecordSplitter returns it) against
// LogFormat's ten %x1f-separated fields.
func ParseLogRecord(record []byte) (CommitRecord, error) {
	fields := SplitLimitedFields(record, fieldDelim, FieldCount)
	if len(fields) != FieldCount {
		return CommitRecord{}, fmt.Errorf("porcelain: log record has %d fields, want %d", len(fields), FieldCount)
	}

	authorTime, err := parseUnixSeconds(fields[4])
	if err != nil {
		return CommitRecord{}, fmt.Errorf("porcelain: author time: %w", err)
	}
	committerTime, err := parseUnixSeconds(fields[7])
	if err != nil {
		return CommitRecord{}, fmt.Errorf("porcelain: committer time: %w", err)
	}
	decoration, err := parseDecoration(string(fields[8]))
	if err != nil {
		return CommitRecord{}, err
	}

	return CommitRecord{
		SHA:     string(fields[0]),
		Parents: parseParents(fields[1]),
		Author: CommitIdentity{
			Name: string(fields[2]), Email: string(fields[3]), Timestamp: authorTime,
		},
		Committer: CommitIdentity{
			Name: string(fields[5]), Email: string(fields[6]), Timestamp: committerTime,
		},
		Decoration: decoration,
		Subject:    string(fields[9]),
	}, nil
}

// ScanRecord is one G23 tail-scan record: every field gitsearch matches on, and nothing else.
type ScanRecord struct {
	SHA       string
	Subject   string
	Body      string
	Author    CommitIdentity
	Committer CommitIdentity
}

// ParseScanRecord splits ScanFormat's eleven %x1f fields. Deliberately leaner than
// ParseLogRecord: %P and %D are split off positionally and then DROPPED unparsed, because this
// backend never walks refs/stash — WalkSpec.IncludeStash is false at every call site in this repo
// (G17 D1) — so there is nothing to filter and no reason to pay parseDecoration per record over a
// 100k-commit walk. The field INDICES still track LogFormat exactly (G23 D2).
func ParseScanRecord(record []byte) (ScanRecord, error) {
	fields := SplitLimitedFields(record, fieldDelim, ScanFieldCount)
	if len(fields) != ScanFieldCount {
		return ScanRecord{}, fmt.Errorf("porcelain: scan record has %d fields, want %d", len(fields), ScanFieldCount)
	}

	authorTime, err := parseUnixSeconds(fields[4])
	if err != nil {
		return ScanRecord{}, fmt.Errorf("porcelain: author time: %w", err)
	}
	committerTime, err := parseUnixSeconds(fields[7])
	if err != nil {
		return ScanRecord{}, fmt.Errorf("porcelain: committer time: %w", err)
	}

	// git emits a trailing "\n" before the record's own NUL terminator; trimmed here, exactly
	// once (upstream probe 11 / parseScanRecord.ts's own contract) — a body with a genuine
	// trailing blank line keeps every newline but the one git's own format machinery appended.
	body := string(fields[10])
	body = strings.TrimSuffix(body, "\n")

	return ScanRecord{
		SHA:     string(fields[0]),
		Subject: string(fields[9]),
		Body:    body,
		Author: CommitIdentity{
			Name: string(fields[2]), Email: string(fields[3]), Timestamp: authorTime,
		},
		Committer: CommitIdentity{
			Name: string(fields[5]), Email: string(fields[6]), Timestamp: committerTime,
		},
	}, nil
}

// parseParents splits %P's own space-separated sha list — empty for a root commit.
func parseParents(field []byte) []string {
	trimmed := strings.TrimSpace(string(field))
	if trimmed == "" {
		return nil
	}
	return strings.Fields(trimmed)
}

func parseUnixSeconds(field []byte) (int64, error) {
	return strconv.ParseInt(string(field), 10, 64)
}

// parseDecoration splits %D's own ", "-separated list and classifies each token — empty for a
// commit with no ref pointing at it directly.
func parseDecoration(raw string) ([]DecorationRef, error) {
	if raw == "" {
		return nil, nil
	}
	tokens := strings.Split(raw, ", ")
	refs := make([]DecorationRef, 0, len(tokens))
	for _, token := range tokens {
		ref, err := parseDecorationToken(token)
		if err != nil {
			return nil, err
		}
		refs = append(refs, ref)
	}
	return refs, nil
}

// parseDecorationToken classifies one `%D` token, prefix by prefix, exactly the way `--decorate=
// full`'s full ref names make possible (short names collapse "refs/heads/x" and "refs/tags/x"
// into the same "x" and cannot be told apart — the reason --decorate=full is load-bearing, not
// cosmetic). An unrecognised "refs/" namespace (replace, notes, a future git feature) is kept
// rather than dropped: classified as a branch-shaped decoration carrying its full ref path, so a
// caller sees every ref pointing at a commit even when this classifier does not have a dedicated
// bucket for it.
func parseDecorationToken(token string) (DecorationRef, error) {
	switch {
	case token == "HEAD":
		return DecorationRef{Kind: DecorationHead}, nil
	case strings.HasPrefix(token, "HEAD -> "):
		name := strings.TrimPrefix(token, "HEAD -> ")
		name = strings.TrimPrefix(name, "refs/heads/")
		return DecorationRef{Kind: DecorationBranch, Name: name, IsHead: true}, nil
	case strings.HasPrefix(token, "tag: "):
		name := strings.TrimPrefix(token, "tag: ")
		name = strings.TrimPrefix(name, "refs/tags/")
		return DecorationRef{Kind: DecorationTag, Name: name}, nil
	case token == "refs/stash":
		// Only refs/stash itself is ever a commit decoration (it always names stash@{0}, the top
		// of the stack — deeper entries have no ref pointing at them directly), so Index is always
		// 0 here; the stash *list*'s own indices are G8's.
		return DecorationRef{Kind: DecorationStash, Index: 0}, nil
	case strings.HasPrefix(token, "refs/heads/"):
		return DecorationRef{Kind: DecorationBranch, Name: strings.TrimPrefix(token, "refs/heads/")}, nil
	case strings.HasPrefix(token, "refs/remotes/"):
		return DecorationRef{Kind: DecorationRemoteBranch, Name: strings.TrimPrefix(token, "refs/remotes/")}, nil
	case strings.HasPrefix(token, "refs/tags/"):
		return DecorationRef{Kind: DecorationTag, Name: strings.TrimPrefix(token, "refs/tags/")}, nil
	case strings.HasPrefix(token, "refs/"):
		return DecorationRef{Kind: DecorationBranch, Name: token}, nil
	default:
		return DecorationRef{}, fmt.Errorf("porcelain: unrecognised decoration token %q", token)
	}
}
