package gitsock

import (
	"crypto/sha256"

	"github.com/kirathecat/kira-studio/internal/tokenauth"
)

// D6's token shape: internal/tokenauth's 32 crypto/rand bytes, base64url on the wire,
// sha256(salt‖token) at rest (P107 I2-29).

// dummyHash/dummySalt give a non-existent client id something to compare against, so a missing
// row and a wrong token take an identical amount of work (D6) — verifyToken always runs, the
// result is simply discarded when there was no real row to check against.
var (
	dummyHash = make([]byte, sha256.Size)
	dummySalt = make([]byte, tokenauth.SaltBytes)
)

// mintToken returns a fresh token in both forms D6 needs: plain (what crosses the wire and lands
// in the extension's context.secrets) and the salted hash pair (what git_clients stores at rest).
func mintToken() (plain string, hash, salt []byte, err error) {
	return tokenauth.Mint()
}

// verifyToken recomputes sha256(salt‖presented) and compares against hash in constant time.
func verifyToken(presented string, hash, salt []byte) bool {
	return tokenauth.Verify(presented, hash, salt)
}
