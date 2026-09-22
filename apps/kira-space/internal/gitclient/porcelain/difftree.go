package porcelain

import (
	"fmt"
	"strconv"
)

// NumstatArgs is one half of commit.detail's file-list pair (D5): `-M -C` on both invocations is
// what makes CombineFileChanges's own no-rename-branch join correct, and is what makes probe P1's
// rename framing (a true `+1 −1`, not `+10 −10`) show up at all. from == nil selects a root
// commit's own diff against the empty tree (`--root`), never a literal empty-tree sha.
func NumstatArgs(from *string, to string) []string {
	args := []string{"diff-tree", "-r", "--no-commit-id", "--numstat", "-M", "-C", "-z"}
	return appendRevPair(args, from, to)
}

// NameStatusArgs is NumstatArgs's twin, over `--name-status` — the source of Kind/OriginalPath/
// Similarity that CombineFileChanges joins onto NumstatArgs's own additions/deletions/isBinary.
func NameStatusArgs(from *string, to string) []string {
	args := []string{"diff-tree", "-r", "--no-commit-id", "--name-status", "-M", "-C", "-z"}
	return appendRevPair(args, from, to)
}

func appendRevPair(args []string, from *string, to string) []string {
	if from == nil {
		return append(args, "--root", to)
	}
	return append(args, *from, to)
}

// FileChangeKind mirrors @kira/git-ipc's own FileChangeKind union verbatim.
type FileChangeKind string

const (
	FileAdded       FileChangeKind = "added"
	FileModified    FileChangeKind = "modified"
	FileDeleted     FileChangeKind = "deleted"
	FileRenamed     FileChangeKind = "renamed"
	FileCopied      FileChangeKind = "copied"
	FileTypeChanged FileChangeKind = "typeChanged"
	FileUnmerged    FileChangeKind = "unmerged"
)

// FileChange is CombineFileChanges's own output row — structurally matches @kira/git-ipc's own
// FileChange (D5): OriginalPath/Similarity/Additions/Deletions are Go pointers with omitempty (the
// contract's `| undefined` fields), never present-and-null.
type FileChange struct {
	Kind         FileChangeKind `json:"kind"`
	Path         string         `json:"path"`
	OriginalPath *string        `json:"originalPath,omitempty"`
	Similarity   *int           `json:"similarity,omitempty"`
	Additions    *int           `json:"additions,omitempty"`
	Deletions    *int           `json:"deletions,omitempty"`
	IsBinary     bool           `json:"isBinary"`
}

// NumstatEntry is one parsed `--numstat` row, keyed by its *new* path (the join key
// CombineFileChanges uses) — intermediate, never crosses the wire on its own.
type NumstatEntry struct {
	Path         string
	OriginalPath string // set for a rename/copy row (probe P1's empty-third-field framing)
	IsBinary     bool
	Additions    int
	Deletions    int
}

// NameStatusEntry is one parsed `--name-status` row — intermediate, never crosses the wire on its
// own.
type NameStatusEntry struct {
	Kind         FileChangeKind
	Path         string
	OriginalPath string // set for renamed/copied
	Similarity   int    // meaningful only for renamed/copied
}

// ParseNumstatRecords parses records (already NUL-split by RecordSplitter) per probe P1: a normal
// row is one record, tab-limited to 3 fields; a binary row's counts are the literal string "-";
// a rename/copy row's own third (path) field is empty, which consumes the next two records as
// originalPath then path — the record set ending mid-rename is reported as an error, not a panic.
func ParseNumstatRecords(records [][]byte) ([]NumstatEntry, error) {
	var out []NumstatEntry
	for i := 0; i < len(records); i++ {
		fields := SplitLimitedFields(records[i], '\t', 3)
		if len(fields) != 3 {
			return nil, fmt.Errorf("porcelain: numstat record %q has %d tab fields, want 3", records[i], len(fields))
		}
		addStr, delStr, path := string(fields[0]), string(fields[1]), string(fields[2])

		if path == "" {
			if i+2 >= len(records) {
				return nil, fmt.Errorf("porcelain: numstat record set ends mid-rename at index %d", i)
			}
			entry := NumstatEntry{OriginalPath: string(records[i+1]), Path: string(records[i+2])}
			if err := fillCounts(&entry, addStr, delStr); err != nil {
				return nil, err
			}
			out = append(out, entry)
			i += 2
			continue
		}

		entry := NumstatEntry{Path: path}
		if err := fillCounts(&entry, addStr, delStr); err != nil {
			return nil, err
		}
		out = append(out, entry)
	}
	return out, nil
}

func fillCounts(entry *NumstatEntry, addStr, delStr string) error {
	if addStr == "-" && delStr == "-" {
		entry.IsBinary = true
		return nil
	}
	add, err := strconv.Atoi(addStr)
	if err != nil {
		return fmt.Errorf("porcelain: numstat additions %q: %w", addStr, err)
	}
	del, err := strconv.Atoi(delStr)
	if err != nil {
		return fmt.Errorf("porcelain: numstat deletions %q: %w", delStr, err)
	}
	entry.Additions, entry.Deletions = add, del
	return nil
}

// ParseNameStatusRecords parses records per `--name-status -M -C -z`'s own framing: the type
// letter (with an optional similarity score suffix for R/C) is its own record, followed by one
// path record (A/M/D/T/U) or two (R/C: originalPath, path). An unrecognised letter is an error.
func ParseNameStatusRecords(records [][]byte) ([]NameStatusEntry, error) {
	var out []NameStatusEntry
	for i := 0; i < len(records); i++ {
		code := string(records[i])
		if code == "" {
			return nil, fmt.Errorf("porcelain: empty name-status type record at index %d", i)
		}
		letter := code[0]
		switch letter {
		case 'A', 'M', 'D', 'T', 'U':
			if i+1 >= len(records) {
				return nil, fmt.Errorf("porcelain: name-status record set ends after %q at index %d", code, i)
			}
			out = append(out, NameStatusEntry{Kind: nameStatusKind(letter), Path: string(records[i+1])})
			i++
		case 'R', 'C':
			if i+2 >= len(records) {
				return nil, fmt.Errorf("porcelain: name-status record set ends mid-%c at index %d", letter, i)
			}
			score := 0
			if len(code) > 1 {
				s, err := strconv.Atoi(code[1:])
				if err != nil {
					return nil, fmt.Errorf("porcelain: name-status similarity %q: %w", code, err)
				}
				score = s
			}
			out = append(out, NameStatusEntry{
				Kind: nameStatusKind(letter), OriginalPath: string(records[i+1]), Path: string(records[i+2]), Similarity: score,
			})
			i += 2
		default:
			return nil, fmt.Errorf("porcelain: unrecognised name-status letter %q", code)
		}
	}
	return out, nil
}

func nameStatusKind(letter byte) FileChangeKind {
	switch letter {
	case 'A':
		return FileAdded
	case 'M':
		return FileModified
	case 'D':
		return FileDeleted
	case 'T':
		return FileTypeChanged
	case 'U':
		return FileUnmerged
	case 'R':
		return FileRenamed
	case 'C':
		return FileCopied
	}
	return ""
}

// CombineFileChanges joins numstat and nameStatus on the new path alone — both invocations run
// `-M -C`, so upstream's own rename-reconciliation branch is unneeded (D5). Ordering is
// nameStatus's own (D17: "the server's contribution to 'file tree' is a flat list, in
// --name-status order"); a numstat row with no matching name-status row (should not happen against
// real git output) is silently skipped rather than guessed at.
func CombineFileChanges(numstat []NumstatEntry, nameStatus []NameStatusEntry) []FileChange {
	byPath := make(map[string]NumstatEntry, len(numstat))
	for _, n := range numstat {
		byPath[n.Path] = n
	}

	out := make([]FileChange, 0, len(nameStatus))
	for _, ns := range nameStatus {
		n, ok := byPath[ns.Path]
		if !ok {
			continue
		}
		fc := FileChange{Kind: ns.Kind, Path: ns.Path, IsBinary: n.IsBinary}
		if ns.OriginalPath != "" {
			op := ns.OriginalPath
			fc.OriginalPath = &op
		}
		if ns.Kind == FileRenamed || ns.Kind == FileCopied {
			sim := ns.Similarity
			fc.Similarity = &sim
		}
		if !n.IsBinary {
			add, del := n.Additions, n.Deletions
			fc.Additions = &add
			fc.Deletions = &del
		}
		out = append(out, fc)
	}
	return out
}
