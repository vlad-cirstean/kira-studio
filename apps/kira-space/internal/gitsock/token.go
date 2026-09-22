package gitsock

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
)

// D6's token shape: 32 crypto/rand bytes, base64url on the wire, sha256(salt‖token) at rest.
const (
	tokenBytes = 32
	saltBytes  = 16
)

// dummyHash/dummySalt give a non-existent client id something to compare against, so a missing
// row and a wrong token take an identical amount of work (D6) — verifyToken always runs, the
// result is simply discarded when there was no real row to check against.
var (
	dummyHash = make([]byte, sha256.Size)
	dummySalt = make([]byte, saltBytes)
)

// mintToken returns a fresh token in both forms D6 needs: plain (what crosses the wire and lands
// in the extension's context.secrets) and the salted hash pair (what git_clients stores at rest).
// A short read or any crypto/rand error is a hard failure — never a weaker token.
func mintToken() (plain string, hash, salt []byte, err error) {
	tok := make([]byte, tokenBytes)
	if _, err := rand.Read(tok); err != nil {
		return "", nil, nil, err
	}
	salt = make([]byte, saltBytes)
	if _, err := rand.Read(salt); err != nil {
		return "", nil, nil, err
	}
	return base64.RawURLEncoding.EncodeToString(tok), hashToken(tok, salt), salt, nil
}

func hashToken(tok, salt []byte) []byte {
	sum := sha256.Sum256(append(append([]byte{}, salt...), tok...))
	return sum[:]
}

// verifyToken recomputes sha256(salt‖presented) and compares against hash in constant time. An
// undecodable presented token fails like any other mismatch, after still doing the comparison
// against the dummy pair so its cost doesn't itself leak information.
func verifyToken(presented string, hash, salt []byte) bool {
	tok, err := base64.RawURLEncoding.DecodeString(presented)
	if err != nil {
		tok = nil
	}
	return subtle.ConstantTimeCompare(hashToken(tok, salt), hash) == 1
}
