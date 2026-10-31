// Package shortid generates short random ids (nanoid).
package shortid

import gonanoid "github.com/matoous/go-nanoid/v2"

// Alphabet is Crockford base32 lowercase: no i, l, o, u look-alikes.
const Alphabet = "0123456789abcdefghjkmnpqrstvwxyz"

// New returns a random id of n characters from Alphabet.
func New(n int) (string, error) { return gonanoid.Generate(Alphabet, n) }
