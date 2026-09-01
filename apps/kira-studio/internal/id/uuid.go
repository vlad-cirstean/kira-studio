// Package id generates the RFC 4122 version-4 UUIDs P53's repos need for filter_history and
// saved_queries rows (and P55's connections create/duplicate). A ~15-line generator over
// crypto/rand avoids adding a UUID library to P52 §2.2's deliberately short dependency list.
package id

import (
	"crypto/rand"
	"fmt"
)

// New returns a random UUID in the canonical 8-4-4-4-12 hex form, the same shape
// crypto.randomUUID() produces in the Electron build.
func New() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		// crypto/rand: a process that cannot get entropy has no business writing rows.
		panic(fmt.Sprintf("id: crypto/rand unavailable: %v", err))
	}
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variant 10

	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}
