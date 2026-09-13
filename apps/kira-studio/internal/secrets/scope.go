package secrets

// Scope is the kind of secret a ciphertext was sealed for. It is AES-GCM's additional
// authenticated data (P29), which is what makes a ciphertext refuse to decrypt anywhere but the
// kind of column it was written for — P21 round 2 architecture/security finding 10.
//
// These three strings are a storage format, not a label: changing one orphans every secret already
// stored under it, exactly the way changing envelopePrefix does. scope_test.go freezes them.
type Scope string

const (
	ScopeConnection      Scope = "connection"
	ScopeVariable        Scope = "variable"
	ScopeVariableHistory Scope = "variable-history"
)

func (s Scope) valid() bool {
	switch s {
	case ScopeConnection, ScopeVariable, ScopeVariableHistory:
		return true
	}
	return false
}

// aad is the scope qualified by the envelope prefix — "kira:v3:connection", etc. Including the
// prefix costs nothing and buys domain separation across format versions: a v3 ciphertext will not
// authenticate under a future kira:v4: even if both use the same scope string.
func (s Scope) aad() []byte { return []byte(envelopePrefix + string(s)) }
