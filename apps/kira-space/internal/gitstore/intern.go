package gitstore

// Interner assigns each distinct string a stable, insertion-order uint32 id — the packer's own
// dictionary (ported from commitStore.ts's intern.ts).
type Interner struct {
	ids    map[string]uint32
	values []string
}

func NewInterner() *Interner {
	return &Interner{ids: make(map[string]uint32)}
}

// Intern returns s's id, minting a fresh one (the next insertion-order slot) the first time s is
// seen.
func (in *Interner) Intern(s string) uint32 {
	if id, ok := in.ids[s]; ok {
		return id
	}
	id := uint32(len(in.values))
	in.ids[s] = id
	in.values = append(in.values, s)
	return id
}

// Size is the number of distinct strings interned so far — the next id ValuesFrom would find.
func (in *Interner) Size() int { return len(in.values) }

// ValuesFrom returns the dictionary delta from base (inclusive) through the interner's current
// size — only the strings interned since base, never the whole dictionary (D12/upstream W3): a
// chunk's dictionary field is a delta keyed by dictionaryBase, not a running cursor.
func (in *Interner) ValuesFrom(base int) []string {
	if base < 0 {
		base = 0
	}
	if base >= len(in.values) {
		return nil
	}
	return in.values[base:]
}
