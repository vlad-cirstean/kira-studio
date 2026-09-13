package gitstore

import "github.com/kirathecat/kira-studio/apps/kira-studio/internal/gitclient/porcelain"

// RowDecorations is one row's decoration refs, chunk-relative — the same shape the wire's
// RowDecorations table carries.
type RowDecorations struct {
	Row  int // chunk-relative: absolute row minus PackedChunk.From
	Refs []porcelain.DecorationRef
}

// PackedChunk is PackSlice's output — Go-typed columns (the wire's [ubyte] columns as their real
// []uint32/[]byte shape; little-endian conversion happens in exactly one place, gitstore/encode.go).
type PackedChunk struct {
	From, To      int
	ShaWidthBytes uint8
	Shas          []byte
	// ParentOffsets has (To-From)+1 entries, CSR row pointers rebased to 0 at From.
	ParentOffsets []uint32
	ParentShas    []byte
	// IdentityIDs is 4 per row: authorName, authorEmail, committerName, committerEmail.
	IdentityIDs []uint32
	// Times is 2 per row: authorTime, committerTime.
	Times []uint32
	// SubjectBytes/SubjectOffsets: SubjectOffsets has (To-From)+1 entries, rebased to 0 at From.
	SubjectBytes   []byte
	SubjectOffsets []uint32
	// DictionaryBase is the first dictionary id this chunk's Dictionary defines — the receiver's
	// interner must be at exactly this size, or the chunk is out of order.
	DictionaryBase uint32
	// Dictionary carries only the strings interned since DictionaryBase — a delta, never the
	// whole dictionary.
	Dictionary  []string
	Decorations []RowDecorations
}

// PackSlice packs rows [from, to) — CSR rebasing for parents and subjects, the identity/time
// columns interleaved per row, the chunk-relative decoration list, and the dictionary delta from
// dictionaryBase.
func (s *Store) PackSlice(from, to, dictionaryBase int) PackedChunk {
	rows := to - from

	shas := append([]byte(nil), s.shas[from*s.shaWidth:to*s.shaWidth]...)

	parentBase := s.parentOffsets[from]
	parentOffsets := make([]uint32, rows+1)
	for i := 0; i <= rows; i++ {
		parentOffsets[i] = s.parentOffsets[from+i] - parentBase
	}
	parentShas := append([]byte(nil), s.parentShas[int(parentBase)*s.shaWidth:int(s.parentOffsets[to])*s.shaWidth]...)

	identityIDs := make([]uint32, 0, rows*4)
	times := make([]uint32, 0, rows*2)
	for r := from; r < to; r++ {
		identityIDs = append(identityIDs, s.authorNameIDs[r], s.authorEmailIDs[r], s.committerNameIDs[r], s.committerEmailIDs[r])
		times = append(times, s.authorTimes[r], s.committerTimes[r])
	}

	subjectBase := s.subjectOffsets[from]
	subjectOffsets := make([]uint32, rows+1)
	for i := 0; i <= rows; i++ {
		subjectOffsets[i] = s.subjectOffsets[from+i] - subjectBase
	}
	subjectBytes := append([]byte(nil), s.subjectBytes[subjectBase:s.subjectOffsets[to]]...)

	var decorations []RowDecorations
	for r := from; r < to; r++ {
		if refs, ok := s.decorations[r]; ok && len(refs) > 0 {
			decorations = append(decorations, RowDecorations{Row: r - from, Refs: refs})
		}
	}

	return PackedChunk{
		From: from, To: to,
		ShaWidthBytes:  uint8(s.shaWidth),
		Shas:           shas,
		ParentOffsets:  parentOffsets,
		ParentShas:     parentShas,
		IdentityIDs:    identityIDs,
		Times:          times,
		SubjectBytes:   subjectBytes,
		SubjectOffsets: subjectOffsets,
		DictionaryBase: uint32(dictionaryBase),
		Dictionary:     s.interner.ValuesFrom(dictionaryBase),
		Decorations:    decorations,
	}
}
