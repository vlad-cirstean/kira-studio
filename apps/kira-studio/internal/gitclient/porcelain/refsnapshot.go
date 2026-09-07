package porcelain

import "fmt"

// RefSnapshotArgs is the paged walk's own narrow ref snapshot (D9) — refname -> object id only,
// deliberately smaller than refs.list's own for-each-ref query (no upstream tracking, no
// worktree path, no tag annotation: those cost git a reachability computation per ref this
// comparison never needs). Used to detect "did any ref move" across a reclaimed session's
// --skip resume.
func RefSnapshotArgs() []string {
	return []string{"for-each-ref", "--format=%(refname)%x1f%(objectname)", "-z"}
}

// ParseRefSnapshot parses for-each-ref -z records (as RecordSplitter with delim 0 returns them)
// into a refname -> object id map.
func ParseRefSnapshot(records [][]byte) (map[string]string, error) {
	out := make(map[string]string, len(records))
	for _, rec := range records {
		fields := SplitLimitedFields(rec, fieldDelim, 2)
		if len(fields) != 2 {
			return nil, fmt.Errorf("porcelain: ref snapshot record has %d fields, want 2", len(fields))
		}
		out[string(fields[0])] = string(fields[1])
	}
	return out, nil
}
