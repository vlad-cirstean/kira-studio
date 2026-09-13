// Package gitstore is the packing half of upstream's commitStore.ts (D12): a column-wise commit
// store built by appending porcelain.CommitRecord values in walk order, and a slice packer that
// produces the wire's PackedCommitChunk shape. Every mechanism that exists only for the renderer
// (lane layout, on-screen materialisation, resolving a parent to a row) is dropped — this store
// only ever appends and packs, so a parent's sha is stored directly and never resolved to a row
// (F11).
package gitstore

import (
	"math"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"
)

// Store is one walk's column-wise commit data, in append (walk) order.
type Store struct {
	shaWidth int // 20 (sha1) or 32 (sha256), fixed by the first appended record.

	shas []byte // rowCount * shaWidth

	parentOffsets []uint32 // rowCount+1 entries, CSR row pointers (cumulative parent count)
	parentShas    []byte   // CSR order, shaWidth bytes each — stored, never resolved to a row (F11)

	authorNameIDs, authorEmailIDs, committerNameIDs, committerEmailIDs []uint32
	authorTimes, committerTimes                                        []uint32

	subjectBytes   []byte
	subjectOffsets []uint32 // rowCount+1 entries, cumulative byte offset into subjectBytes

	decorations map[int][]porcelain.DecorationRef // absolute row -> refs, only for rows that have any

	interner *Interner

	rowCount int
}

// New constructs an empty Store.
func New() *Store {
	return &Store{
		parentOffsets:  []uint32{0},
		subjectOffsets: []uint32{0},
		decorations:    make(map[int][]porcelain.DecorationRef),
		interner:       NewInterner(),
	}
}

// clampTimestamp folds a signed unix-seconds value into the wire's uint32 column — clock-skewed
// histories are real (a commit dated before 1970, or one with a corrupted/absurd future date),
// and a Float64Array timestamp column for every repository to accommodate them is not the trade
// upstream made either (commitStore.ts:17-26, kept exactly).
func clampTimestamp(t int64) uint32 {
	if t < 0 {
		return 0
	}
	if t > math.MaxUint32 {
		return math.MaxUint32
	}
	return uint32(t)
}

// Append adds one commit record as the next row (walk order — callers append in the order a walk
// delivers records, never out of order).
func (s *Store) Append(rec porcelain.CommitRecord) {
	if s.shaWidth == 0 {
		s.shaWidth = len(rec.SHA) / 2
	}

	s.shas = append(s.shas, hexToBytes(rec.SHA)...)

	for _, p := range rec.Parents {
		s.parentShas = append(s.parentShas, hexToBytes(p)...)
	}
	s.parentOffsets = append(s.parentOffsets, s.parentOffsets[len(s.parentOffsets)-1]+uint32(len(rec.Parents)))

	s.authorNameIDs = append(s.authorNameIDs, s.interner.Intern(rec.Author.Name))
	s.authorEmailIDs = append(s.authorEmailIDs, s.interner.Intern(rec.Author.Email))
	s.committerNameIDs = append(s.committerNameIDs, s.interner.Intern(rec.Committer.Name))
	s.committerEmailIDs = append(s.committerEmailIDs, s.interner.Intern(rec.Committer.Email))
	s.authorTimes = append(s.authorTimes, clampTimestamp(rec.Author.Timestamp))
	s.committerTimes = append(s.committerTimes, clampTimestamp(rec.Committer.Timestamp))

	s.subjectBytes = append(s.subjectBytes, rec.Subject...)
	s.subjectOffsets = append(s.subjectOffsets, uint32(len(s.subjectBytes)))

	if len(rec.Decoration) > 0 {
		s.decorations[s.rowCount] = rec.Decoration
	}

	s.rowCount++
}

// RowCount is how many records have been appended.
func (s *Store) RowCount() int { return s.rowCount }

// Clear resets the store to empty — used when the walk it backs is invalidated (refsChanged,
// graph.refresh, D13) and must restart from row 0 with a fresh dictionary.
func (s *Store) Clear() {
	*s = *New()
}
