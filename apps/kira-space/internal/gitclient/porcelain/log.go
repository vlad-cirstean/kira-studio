package porcelain

import (
	"fmt"
	"strconv"
	"strings"
)

// LogFormat is upstream's own ten-field format string, %x00-separated (F3, not %x1f): git keeps
// a literal 0x1f inside a hostile author/committer name or email (verified with
// GIT_AUTHOR_NAME=$'Mal\x1fory'), which would silently shift every field after it in a non-last
// position — %x1f is only ever safe in the SUBJECT, the one field that is already last. NUL is
// the one byte git guarantees can never appear inside any of its own field values, so it is the
// only field delimiter that is safe everywhere, not just in the last position — never reordered
// without also updating FieldCount and ParseLogRecord's own field indices below.
const LogFormat = "%H%x00%P%x00%an%x00%ae%x00%at%x00%cn%x00%ce%x00%ct%x00%D%x00%s"

// FieldCount is LogFormat's own field count.
const FieldCount = 10

// logBaseArgs is the walk's fixed argv prefix, shared by every consumer of LogFormat: decorate=
// full is load-bearing (short ref names cannot be classified — see parseDecorationToken),
// topo-order is what makes the graph's lanes meaningful, and -z terminates each record with the
// same NUL byte LogFormat's own %x00 already uses between fields (F3) — the format's own last
// field carries no trailing delimiter, so -z's automatic per-record NUL lands exactly once, right
// after it, with no double delimiter and nothing to strip. Field and record boundaries are the
// same byte here, which is exactly why porcelain.FieldGrouper groups a flat NUL-field stream by a
// fixed count rather than a distinguishable record delimiter. --decorate-refs-exclude (G32 round-3
// functional-correctness review, finding #5, the log-decoration half — HeadsRefsArgs' own doc
// comment covers the refs.list half) drops refs/remotes/<remote>/HEAD, the symbolic pointer every
// `git clone`d repo carries, from %D before parseDecorationToken ever sees it — without this the
// default branch's graph row carried a duplicate, phantom "origin/HEAD" badge alongside its real
// tracking badge.
// format is LogFormat for the paged walk (LogSessionArgs/LogSessionSkipArgs) and ScanFormat for
// the tail scan (LogScanArgs, H10, P115 Part 2) — the two walks' argv otherwise differ in exactly
// one token, LogScanArgs' own doc comment.
func logBaseArgs(format string) []string {
	return []string{
		"log", "--decorate=full", "--decorate-refs-exclude=refs/remotes/*/HEAD",
		"--topo-order", "-z", "--format=" + format,
	}
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
//
// G28 D15/F12/probe P11: `--all` lists EVERY ref under refs/, this app's own `refs/kira/*`
// namespace included, so the `--all` arm always excludes it first — `--exclude` must PRECEDE the
// `--all` it modifies (probe P11), and is a harmless no-op when nothing under that prefix exists
// yet. `--exclude=refs/stash` is added ADDITIONALLY when spec.ExcludeStash is set (the decidable
// "off" half of kiraSpace.stash.showInGraph, D15) — never for the `head` scope or a ranged walk,
// where RevSetArgs does not sweep `--all` at all and an exclusion would be meaningless.
func RevSetArgs(spec WalkSpec) []string {
	var args []string
	switch {
	case spec.Range != nil:
		args = append(args, RangeToken(*spec.Range))
	case spec.Scope == "head":
		args = append(args, "HEAD")
	default: // "all", or unset -- "all" is the server's own default scope (D14).
		args = append(args, "--exclude=refs/kira/*")
		if spec.ExcludeStash {
			args = append(args, "--exclude=refs/stash")
		}
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
	return append(logBaseArgs(LogFormat), WalkArgs(spec)...)
}

// LogSessionSkipArgs is LogSessionArgs with a `--skip` — the paged walk's resume-by-respawn argv
// (logsession's own reclaim path, D10).
func LogSessionSkipArgs(spec WalkSpec, skip int) []string {
	args := logBaseArgs(LogFormat)
	args = append(args, "--skip="+strconv.Itoa(skip))
	return append(args, WalkArgs(spec)...)
}

// ScanFormat is LogFormat plus the raw body — %x00-delimited same as every other field (F3), so a
// body containing a stray 0x1f, a raw newline, or any other byte except NUL itself stays harmless
// (G23 D1).
const ScanFormat = LogFormat + "%x00%b"

// ScanFieldCount is ScanFormat's own field count.
const ScanFieldCount = 11

// LogScanArgs is G23's tail-scan argv: the same log vocabulary and the same WalkArgs(spec) call
// LogSessionArgs makes, with ScanFormat in place of LogFormat — this is what makes upstream probe
// 11's ordering property hold: the paging walk and the scan are the same --topo-order walk over
// the same rev set, so the loaded rows are a PREFIX of the scan's sequence and git-ui's
// buildCommitHits can concatenate the two halves without sorting anything. --decorate=full (and
// its own --decorate-refs-exclude, logBaseArgs' own doc comment) is kept even though
// ParseScanRecord discards %D unparsed (D2) — dropping either would change %D's own *content*,
// and the whole point of this function is that its argv differs from LogSessionArgs' in exactly
// one token (the format string).
func LogScanArgs(spec WalkSpec) []string {
	return append(logBaseArgs(ScanFormat), WalkArgs(spec)...)
}

// parseIdentities parses LogFormat/ScanFormat's shared author/committer field block — fields[2:5]
// (name, email, unix-seconds timestamp) and fields[5:8] respectively — into a CommitIdentity pair.
// ParseLogRecord and ParseScanRecord's own identical parse (P107 I2-33).
func parseIdentities(fields [][]byte) (author, committer CommitIdentity, err error) {
	authorTime, err := parseUnixSeconds(fields[4])
	if err != nil {
		return CommitIdentity{}, CommitIdentity{}, fmt.Errorf("porcelain: author time: %w", err)
	}
	committerTime, err := parseUnixSeconds(fields[7])
	if err != nil {
		return CommitIdentity{}, CommitIdentity{}, fmt.Errorf("porcelain: committer time: %w", err)
	}
	author = CommitIdentity{Name: string(fields[2]), Email: string(fields[3]), Timestamp: authorTime}
	committer = CommitIdentity{Name: string(fields[5]), Email: string(fields[6]), Timestamp: committerTime}
	return author, committer, nil
}

// ParseLogRecord parses one LogFormat record, already split into exactly FieldCount fields (a
// porcelain.FieldGrouper's own output for a streaming caller, or ParseLogRecordFromRaw's for a
// one-shot buffer — F3: LogFormat's fields are NUL-delimited, so there is no absorb-the-last-field
// splitting left to do here, unlike the old %x1f design).
func ParseLogRecord(fields [][]byte) (CommitRecord, error) {
	if len(fields) != FieldCount {
		return CommitRecord{}, fmt.Errorf("porcelain: log record has %d fields, want %d", len(fields), FieldCount)
	}

	author, committer, err := parseIdentities(fields)
	if err != nil {
		return CommitRecord{}, err
	}
	decoration, err := parseDecoration(string(fields[8]))
	if err != nil {
		return CommitRecord{}, err
	}

	return CommitRecord{
		SHA:        string(fields[0]),
		Parents:    parseParents(fields[1]),
		Author:     author,
		Committer:  committer,
		Decoration: decoration,
		Subject:    string(fields[9]),
	}, nil
}

// ParseLogRecordFromRaw parses ONE ShowMetadataArgs-shaped raw stdout buffer (a single `-z`-
// terminated LogFormat record) directly, without a separate RecordSplitter pass — F3's NUL-fielded
// framing makes field and record delimiters the same byte, so the old "split on the next single
// delimiter occurrence, that's one record" contract no longer applies to this format; splitting by
// a fixed field count is exact instead (splitOneNULRecord).
func ParseLogRecordFromRaw(raw []byte) (CommitRecord, error) {
	fields, err := splitOneNULRecord(raw, FieldCount)
	if err != nil {
		return CommitRecord{}, err
	}
	return ParseLogRecord(fields)
}

// ScanRecord is one G23 tail-scan record: every field gitsearch matches on, and nothing else.
type ScanRecord struct {
	SHA       string
	Subject   string
	Body      string
	Author    CommitIdentity
	Committer CommitIdentity
}

// ParseScanRecord parses one ScanFormat record, already split into exactly ScanFieldCount NUL-
// delimited fields (F3). Deliberately leaner than ParseLogRecord: %P and %D are read positionally
// and then DROPPED unparsed, because this backend never walks refs/stash — WalkSpec.IncludeStash
// is false at every call site in this repo (G17 D1) — so there is nothing to filter and no reason
// to pay parseDecoration per record over a 100k-commit walk. The field INDICES still track
// LogFormat exactly (G23 D2).
func ParseScanRecord(fields [][]byte) (ScanRecord, error) {
	if len(fields) != ScanFieldCount {
		return ScanRecord{}, fmt.Errorf("porcelain: scan record has %d fields, want %d", len(fields), ScanFieldCount)
	}

	author, committer, err := parseIdentities(fields)
	if err != nil {
		return ScanRecord{}, err
	}

	// git emits a trailing "\n" before the record's own NUL terminator; trimmed here, exactly
	// once (upstream probe 11 / parseScanRecord.ts's own contract) — a body with a genuine
	// trailing blank line keeps every newline but the one git's own format machinery appended.
	body := string(fields[10])
	body = strings.TrimSuffix(body, "\n")

	return ScanRecord{
		SHA:       string(fields[0]),
		Subject:   string(fields[9]),
		Body:      body,
		Author:    author,
		Committer: committer,
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
		ref, keep, err := parseDecorationToken(token)
		if err != nil {
			return nil, err
		}
		if !keep {
			continue
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
// bucket for it. A bare token that matches none of HEAD/"HEAD -> "/"tag: "/"refs/" (F1: `grafted`
// in a `--depth`-shallow clone's boundary commit, `replaced` for a replace ref) is a real git
// annotation, not a ref — ignored rather than treated as a parse failure, since erroring here
// would fail the whole walk over one benign, non-ref decoration word.
func parseDecorationToken(token string) (ref DecorationRef, keep bool, err error) {
	switch {
	case token == "HEAD":
		return DecorationRef{Kind: DecorationHead}, true, nil
	case strings.HasPrefix(token, "HEAD -> "):
		name := strings.TrimPrefix(token, "HEAD -> ")
		name = strings.TrimPrefix(name, "refs/heads/")
		return DecorationRef{Kind: DecorationBranch, Name: name, IsHead: true}, true, nil
	case strings.HasPrefix(token, "tag: "):
		name := strings.TrimPrefix(token, "tag: ")
		name = strings.TrimPrefix(name, "refs/tags/")
		return DecorationRef{Kind: DecorationTag, Name: name}, true, nil
	case token == "refs/stash":
		// Only refs/stash itself is ever a commit decoration (it always names stash@{0}, the top
		// of the stack — deeper entries have no ref pointing at them directly), so Index is always
		// 0 here; the stash *list*'s own indices are G8's.
		return DecorationRef{Kind: DecorationStash, Index: 0}, true, nil
	case strings.HasPrefix(token, "refs/heads/"):
		return DecorationRef{Kind: DecorationBranch, Name: strings.TrimPrefix(token, "refs/heads/")}, true, nil
	case strings.HasPrefix(token, "refs/remotes/"):
		return DecorationRef{Kind: DecorationRemoteBranch, Name: strings.TrimPrefix(token, "refs/remotes/")}, true, nil
	case strings.HasPrefix(token, "refs/tags/"):
		return DecorationRef{Kind: DecorationTag, Name: strings.TrimPrefix(token, "refs/tags/")}, true, nil
	case strings.HasPrefix(token, "refs/"):
		return DecorationRef{Kind: DecorationBranch, Name: token}, true, nil
	default:
		return DecorationRef{}, false, nil
	}
}
