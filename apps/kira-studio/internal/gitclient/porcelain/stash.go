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
// @kira/git-core's model/stash.ts "Parent 1/2/3" doc comments exactly), %gs (the REFLOG subject,
// NOT %s — see StashEntry.Message's own doc comment on why), %at (push time).
const StashFormat = "%gd%x1f%H%x1f%P%x1f%gs%x1f%at"

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
	args := []string{"log", "--no-walk", "--format=%H%x1f%s", "-z"}
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
	// gitops.GlobalStashRef(sha) for a global one — G28 D8/D17.
	Ref string `json:"ref,omitempty"`
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
		message := string(fields[3])
		timestamp, err := parseUnixSeconds(fields[4])
		if err != nil {
			return nil, fmt.Errorf("porcelain: stash list: entry %s: timestamp: %w", sha, err)
		}

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
		var numstatRecs [][]byte
		for i < len(recs) && !isHeader(recs[i]) {
			numstatRecs = append(numstatRecs, recs[i])
			i++
		}
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
