package gitstore

import "encoding/hex"

// hexToBytes decodes a hex sha into raw bytes. A malformed sha reaching this point would be a
// bug in porcelain's own parser (git itself never emits one) — this panics the same way an
// internal invariant violation would, rather than threading a parse error through every Append
// call for something that should be structurally impossible.
func hexToBytes(s string) []byte {
	b, err := hex.DecodeString(s)
	if err != nil {
		panic("gitstore: malformed sha " + s + ": " + err.Error())
	}
	return b
}
