package porcelain

import (
	"bytes"
	"fmt"
	"strconv"
	"strings"
)

// StashFormat is stash.list's own five-field format string (probe 12): %gd (the stash@{N} reflog
// selector — read back as StashEntry.Index, decoupled from output order, since a stack mutation
// elsewhere can shift it between reads), %H (the stash commit's own sha), %P (every parent,
// space-separated — baseSha first, indexSha second, untrackedSha third iff -u was used, mirroring
// @kira/git-core's model/stash.ts "Parent 1/2/3" doc comments exactly), %at (push time), %gs (the
// REFLOG subject, NOT %s — see StashEntry.Message's own doc comment on why) — %gs is LAST, not
// fourth (F3): git keeps a literal 0x1f inside a hostile default stash message (it embeds the
// HEAD commit's own subject verbatim, e.g. "WIP on main: " + a subject containing 0x1f), which
// would otherwise shift %at into the message and corrupt every field after it — the same reason
// %s sits last in LogFormat.
const StashFormat = "%gd%x1f%H%x1f%P%x1f%at%x1f%gs"

const stashFormatFieldCount = 5

// StashListArgs builds `stash list -z --numstat -M -C --format=<StashFormat>` verbatim
// (contract.ts's own stash.list doc comment).
func StashListArgs() []string {
	return []string{"stash", "list", "-z", "--numstat", "-M", "-C", "--format=" + StashFormat}
}

// StashBaseSubjectArgs builds the batch `log --no-walk --format=%H%x1f%s -z <shas...>` spawn that
// resolves every distinct baseSha's own commit subject in one call — model/stash.ts's own doc
// comment states the mechanism directly: %gs cannot name a PARENT commit's subject, only the stash
// commit's own.
func StashBaseSubjectArgs(shas []string) []string {
	args := make([]string, 0, 4+len(shas))
	args = append(args, "log", "--no-walk", "--format=%H%x1f%s", "-z")
	return append(args, shas...)
}

// StashShowArgs is stash.show's own spawn pair — a thin wrapper over NumstatArgs/NameStatusArgs
// (already commit.detail's own pair, F9), from the stash's own base to the stash commit itself: a
// stash commit's own tree diffed against its base is exactly what a commit's fileDiff at
// parentIndex 0 already means.
func StashShowArgs(baseSha, sha string) (numstat, nameStatus []string) {
	return NumstatArgs(&baseSha, sha), NameStatusArgs(&baseSha, sha)
}

// StashUntrackedLsTreeArgs builds `ls-tree -r --name-only -z <untrackedSha>` — the untracked
// helper commit's own tree, each path folded into stash.show's FileChange list as FileAdded
// (untracked content by definition has no "before", contract.ts's own stash.show doc comment).
func StashUntrackedLsTreeArgs(sha string) []string {
	return []string{"ls-tree", "-r", "--name-only", "-z", sha}
}

// StashEntry mirrors @kira/git-ipc's own StashEntry field for field (D5's encoding rule):
// UntrackedSha is `string | undefined` (omitempty), Branch is `string | null` (present, no
// omitempty). G28 D12/D17 widens it by two fields rather than forking a parallel
// GlobalStashEntry type (the fork would touch StashDetailPane.vue, stash.show, PreflightStashPop,
// ClassifyStashPop, StashPopPreflight and every announcement helper for one field's worth of real
// difference): Scope discriminates "stack"/"global" (StashScopeStack/StashScopeGlobal below);
// Index becomes the sentinel -1 for a global entry, which has no stack position at all — guarded
// structurally, not by convention, since stashPop/stashDrop are never offered for a global entry
// (D12/D13) and stashBranch takes a sha-addressed arm for one instead of ever reading Index.
type StashEntry struct {
	Index             int     `json:"index"`
	Sha               string  `json:"sha"`
	BaseSha           string  `json:"baseSha"`
	BaseSubject       string  `json:"baseSubject"`
	IndexSha          string  `json:"indexSha"`
	UntrackedSha      *string `json:"untrackedSha,omitempty"`
	Message           string  `json:"message"`
	Branch            *string `json:"branch"`
	Timestamp         int64   `json:"timestamp"`
	FileCount         int     `json:"fileCount"`
	IncludedUntracked bool    `json:"includedUntracked"`
	// Scope is "stack" (an ordinary refs/stash entry, ParseStashList) or "global"
	// (refs/kira/globalstash/<sha>, ParseGlobalStashList) — G28 D17.
	Scope string `json:"scope"`
	// Ref is "" for a stack entry (addressed by position, never by ref) and the entry's own
	// gitops.GlobalStashRef(sha) for a global one — G28 D8/D17. Deliberately no `omitempty`: the
	// wire's own StashEntry.ref is `string`, always present (never `string | undefined`), so an
	// empty string must serialize as `"ref":""`, not be omitted from the JSON entirely.
	Ref string `json:"ref"`
}

// StashScopeStack and StashScopeGlobal are StashEntry.Scope's two legal values (G28 D17).
const (
	StashScopeStack  = "stack"
	StashScopeGlobal = "global"
)

// parseBranchFromMessage parses model/stash.ts's own "WIP on <b>: "/"On <b>: " reflog-subject
// prefix — nil for a detached-HEAD stash ("On (no branch): …") or a message with neither prefix (a
// `stash store`-restored entry, probe 9 — %gs is read for exactly this reason, not %s, since %s
// would not even survive a store restore the way the reflog subject does).
func parseBranchFromMessage(message string) *string {
	for _, prefix := range []string{"WIP on ", "On "} {
		rest, ok := strings.CutPrefix(message, prefix)
		if !ok {
			continue
		}
		idx := strings.Index(rest, ": ")
		if idx < 0 {
			continue
		}
		branch := rest[:idx]
		if branch == "(no branch)" {
			return nil
		}
		return &branch
	}
	return nil
}

// parseStashIndex extracts N out of a %gd field shaped "stash@{N}".
func parseStashIndex(gd string) (int, error) {
	if !strings.HasPrefix(gd, "stash@{") || !strings.HasSuffix(gd, "}") {
		return 0, fmt.Errorf("porcelain: stash list: malformed reflog selector %q", gd)
	}
	n := gd[len("stash@{") : len(gd)-1]
	idx, err := strconv.Atoi(n)
	if err != nil {
		return 0, fmt.Errorf("porcelain: stash list: reflog selector %q: %w", gd, err)
	}
	return idx, nil
}

// isStackStashHeader recognises a stack entry's own header record by %gd's "stash@{" prefix —
// unambiguous against any numstat row, which never starts with that literal.
func isStackStashHeader(rec []byte) bool {
	return bytes.HasPrefix(rec, []byte("stash@{"))
}

// isRenameNumstatRecord reports whether rec is a rename's own numstat header — %x1f is never
// involved here, this is diff-tree's own tab-separated "additions\tdeletions\tpath" numstat shape
// (ParseNumstatRecords' own framing) — with an EMPTY path field, meaning the next two records are
// its originalPath/path pair, not ordinary numstat continuations. first strips the leading "\n"
// probe 12's own log-shaped framing note describes (present only on the very first numstat record
// of a header's own diffstat block) before checking, since that record is otherwise
// indistinguishable in shape from any other.
func isRenameNumstatRecord(rec []byte, first bool) bool {
	if first {
		rec = bytes.TrimPrefix(rec, []byte("\n"))
	}
	fields := SplitLimitedFields(rec, '\t', 3)
	return len(fields) == 3 && len(fields[2]) == 0
}

// collectNumstatRecs gathers one header's own diffstat block — every record from i up to (but not
// including) the next header — and returns it along with the index to resume the outer walk from.
// A rename's own two path records are consumed structurally, by position (isRenameNumstatRecord),
// never tested against isHeader (F14): a renamed file whose own name happens to be header-shaped
// (literally "stash@{0}", or a bare 40-hex-character filename for the global bucket's own
// isGlobalStashHeader) would otherwise be mistaken for the next entry's header, misframing the
// list. Extracted out of parseStashRecords to keep that function's own cognitive complexity in
// check, no behaviour change.
func collectNumstatRecs(recs [][]byte, i int, isHeader func([]byte) bool) ([][]byte, int) {
	var numstatRecs [][]byte
	for i < len(recs) {
		rec := recs[i]
		if isRenameNumstatRecord(rec, len(numstatRecs) == 0) {
			if i+2 >= len(recs) {
				break // let ParseNumstatRecords report the truncated-rename error below.
			}
			numstatRecs = append(numstatRecs, rec, recs[i+1], recs[i+2])
			i += 3
			continue
		}
		if isHeader(rec) {
			break
		}
		numstatRecs = append(numstatRecs, rec)
		i++
	}
	return numstatRecs, i
}

// parseStashRecords is ParseStashList's own record walk (probe 12), extracted verbatim (G28 D9,
// no behaviour change) so ParseGlobalStashList can reuse it rather than hand-maintaining a second
// copy of one of this package's more subtle parsers (the leading "\n" on the first numstat record,
// untracked-only entries with zero numstat records, header detection against arbitrary paths).
// isHeader classifies one already-split record as a header vs. a numstat continuation —
// isStackStashHeader for the stack, "is 40 hex bytes" for the bucket (unambiguous against a
// numstat record, which begins with "\n" or a digit-tab, never 40 bare hex bytes). indexOf turns
// the header's own first field into StashEntry.Index — parseStashIndex ("stash@{N}" -> N) for the
// stack, a constant -1 (D17's sentinel — a global entry has no stack position) for the bucket.
// scope stamps every resulting entry's own Scope field. subjects supplies every entry's
// baseSubject, keyed by baseSha (StashBaseSubjectArgs' own batch read) — nil/absent resolves to ""
// rather than erroring (model/stash.ts's own "should never fail to render over a lookup gap" doc
// comment).
func parseStashRecords(
	recs [][]byte, isHeader func([]byte) bool, indexOf func(string) (int, error), scope string, subjects map[string]string,
) ([]StashEntry, error) {
	var out []StashEntry
	i := 0
	for i < len(recs) {
		header := recs[i]
		if !isHeader(header) {
			return nil, fmt.Errorf("porcelain: stash list: record %d is not a header: %q", i, header)
		}
		fields := SplitLimitedFields(header, fieldDelim, stashFormatFieldCount)
		if len(fields) != stashFormatFieldCount {
			return nil, fmt.Errorf("porcelain: stash list: header record has %d fields, want %d", len(fields), stashFormatFieldCount)
		}
		index, err := indexOf(string(fields[0]))
		if err != nil {
			return nil, err
		}
		sha := string(fields[1])
		parents := parseParents(fields[2])
		if len(parents) < 1 {
			return nil, fmt.Errorf("porcelain: stash list: entry %s has no parents", sha)
		}
		timestamp, err := parseUnixSeconds(fields[3])
		if err != nil {
			return nil, fmt.Errorf("porcelain: stash list: entry %s: timestamp: %w", sha, err)
		}
		message := string(fields[4])

		var indexSha string
		var untrackedSha *string
		if len(parents) > 1 {
			indexSha = parents[1]
		}
		if len(parents) > 2 {
			u := parents[2]
			untrackedSha = &u
		}

		i++
		numstatRecs, resumeAt := collectNumstatRecs(recs, i, isHeader)
		i = resumeAt
		if len(numstatRecs) > 0 {
			numstatRecs[0] = bytes.TrimPrefix(numstatRecs[0], []byte("\n"))
		}
		numstat, err := ParseNumstatRecords(numstatRecs)
		if err != nil {
			return nil, fmt.Errorf("porcelain: stash list: entry %s: %w", sha, err)
		}

		out = append(out, StashEntry{
			Index: index, Sha: sha, BaseSha: parents[0], BaseSubject: subjects[parents[0]],
			IndexSha: indexSha, UntrackedSha: untrackedSha, Message: message,
			Branch: parseBranchFromMessage(message), Timestamp: timestamp,
			FileCount: len(numstat), IncludedUntracked: untrackedSha != nil,
			Scope: scope,
		})
	}
	return out, nil
}

// ParseStashList parses StashListArgs' own raw -z output into StashEntry rows (probe 12) — a thin
// wrapper over parseStashRecords (G28 D9): every header record is followed by zero (no tracked
// changes at all — an untracked-only stash, confirmed against real git 2.43) or more numstat
// records for that entry, the FIRST of which carries a literal leading "\n" (stash list is
// log-shaped: the blank-line separator between a commit header and its diffstat survives even
// under -z, confirmed against real git output, not assumed) that parseStashRecords strips before
// the existing ParseNumstatRecords sees it; every record after that follows diff-tree's own -M -C
// -z framing exactly, so the same parser applies unchanged.
func ParseStashList(raw []byte, subjects map[string]string) ([]StashEntry, error) {
	splitter := NewRecordSplitter(0)
	recs, err := splitter.Push(raw)
	if err != nil {
		return nil, err
	}
	if flushed := splitter.Flush(); flushed != nil {
		return nil, fmt.Errorf("porcelain: stash list: unterminated trailing bytes: %q", flushed)
	}
	return parseStashRecords(recs, isStackStashHeader, parseStashIndex, StashScopeStack, subjects)
}

// GlobalStashFormat is StashFormat with %gd replaced by %H (there is no reflog selector for a
// namespace ref, probe P13) and %gs replaced by %s (the commit's own subject IS the message here,
// because stash create / commit-tree wrote it, probes P4/P23) — %s sits last for the same F3
// reason StashFormat's own %gs does. Field order otherwise identical, so parseStashRecords' own
// record walk is reused verbatim (G28 D9).
const GlobalStashFormat = "%H%x1f%H%x1f%P%x1f%at%x1f%s"

// GlobalStashLogArgs builds globalStash.list's own second spawn (D9, probe P12): `log --no-walk -m
// --first-parent -z --numstat -M -C --format=<GlobalStashFormat> <shas...>` — structurally
// identical to stash list's own header-then-numstat framing, so the shared record walk applies
// unchanged. Only called when the bucket is non-empty (globalStash.list's own first spawn,
// gitops.GlobalStashListRefsArgs, already answered at least one sha).
func GlobalStashLogArgs(shas []string) []string {
	args := make([]string, 0, 9+len(shas))
	args = append(args, "log", "--no-walk", "-m", "--first-parent", "-z", "--numstat", "-M", "-C", "--format="+GlobalStashFormat)
	return append(args, shas...)
}

// isGlobalStashHeader recognises a global-bucket entry's own header record: its first field (up to
// the first %x1f delimiter, or the whole record if none is present) is a full-length hex object id
// — unambiguous against a numstat record, which begins with "\n" or a digit-tab and is never a
// bare hex-only string of either width (probe P12/P13).
func isGlobalStashHeader(rec []byte) bool {
	first := rec
	if idx := bytes.IndexByte(rec, fieldDelim); idx >= 0 {
		first = rec[:idx]
	}
	return isHexObjectID(first)
}

// isHexObjectID reports whether b is exactly 40 (SHA-1) or 64 (SHA-256, F18) lowercase-hex bytes —
// the only two widths GlobalStashFormat's own leading %H field can ever take, depending on this
// repository's own object format (verified against real git --object-format=sha256: the id is a
// completely different-width hex string, never just a longer version of the same value).
func isHexObjectID(b []byte) bool {
	if len(b) != 40 && len(b) != 64 {
		return false
	}
	for _, c := range b {
		if !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) {
			return false
		}
	}
	return true
}

// globalStashIndex is ParseGlobalStashList's own indexOf: a global entry has no stack position at
// all, so this is the constant -1 sentinel (G28 D17), never a parse.
func globalStashIndex(string) (int, error) { return -1, nil }

// ParseGlobalStashList parses GlobalStashLogArgs' own raw -z output into StashEntry rows (G28 D9)
// — a thin wrapper over the same parseStashRecords walk ParseStashList uses, with
// isGlobalStashHeader/globalStashIndex/StashScopeGlobal in place of the stack's own three. refPrefix
// is gitops.GlobalStashRefPrefix, threaded in by the caller (this package does not import gitops —
// SPEC's own layering rule, porcelain sits below gitops) so every entry's own Ref is built from the
// single source of truth rather than a second hand-spelled "refs/kira/globalstash/" literal here.
func ParseGlobalStashList(raw []byte, subjects map[string]string, refPrefix string) ([]StashEntry, error) {
	splitter := NewRecordSplitter(0)
	recs, err := splitter.Push(raw)
	if err != nil {
		return nil, err
	}
	if flushed := splitter.Flush(); flushed != nil {
		return nil, fmt.Errorf("porcelain: global stash list: unterminated trailing bytes: %q", flushed)
	}
	entries, err := parseStashRecords(recs, isGlobalStashHeader, globalStashIndex, StashScopeGlobal, subjects)
	if err != nil {
		return nil, err
	}
	for i := range entries {
		entries[i].Ref = refPrefix + entries[i].Sha
	}
	return entries, nil
}

// ParseGlobalStashRefShas parses GlobalStashListRefsArgs' own for-each-ref output (one
// %(objectname) per line, newline-terminated) into the bucket's own sha set (D9). An empty bucket
// answers exit 0 with empty output (probe P10), which this returns as nil — globalStash.list's own
// signal to stop after the first spawn and skip the log spawn entirely.
func ParseGlobalStashRefShas(raw []byte) []string {
	text := strings.TrimSuffix(string(raw), "\n")
	if text == "" {
		return nil
	}
	return strings.Split(text, "\n")
}

// ParseStashBaseSubjects parses StashBaseSubjectArgs' own `%H%x1f%s -z` batch output into a
// sha -> subject map.
func ParseStashBaseSubjects(raw []byte) (map[string]string, error) {
	splitter := NewRecordSplitter(0)
	recs, err := splitter.Push(raw)
	if err != nil {
		return nil, err
	}
	if flushed := splitter.Flush(); flushed != nil {
		return nil, fmt.Errorf("porcelain: stash base subjects: unterminated trailing bytes: %q", flushed)
	}
	out := make(map[string]string, len(recs))
	for _, rec := range recs {
		fields := SplitLimitedFields(rec, fieldDelim, 2)
		if len(fields) != 2 {
			return nil, fmt.Errorf("porcelain: stash base subjects: record %q has %d fields, want 2", rec, len(fields))
		}
		out[string(fields[0])] = string(fields[1])
	}
	return out, nil
}
