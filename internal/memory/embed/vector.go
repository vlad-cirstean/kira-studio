package embed

import (
	"encoding/binary"
	"fmt"
	"math"
)

// Encode packs v as little-endian float32.
func Encode(v []float32) []byte {
	b := make([]byte, 4*len(v))
	for i, x := range v {
		binary.LittleEndian.PutUint32(b[4*i:], math.Float32bits(x))
	}
	return b
}

// Decode unpacks a little-endian float32 vector of exactly dim elements.
func Decode(b []byte, dim int) ([]float32, error) {
	out := make([]float32, dim)
	if err := DecodeInto(out, b); err != nil {
		return nil, err
	}
	return out, nil
}

// DecodeInto unpacks b into dst, which fixes the expected dimension.
func DecodeInto(dst []float32, b []byte) error {
	if len(b) != 4*len(dst) {
		return fmt.Errorf("embed: vector is %d bytes, want %d", len(b), 4*len(dst))
	}
	for i := range dst {
		dst[i] = math.Float32frombits(binary.LittleEndian.Uint32(b[4*i:]))
	}
	return nil
}

// Dot is the dot product, which equals cosine similarity for L2-normalised vectors.
func Dot(a, b []float32) float32 {
	var s float32
	for i := range a {
		s += a[i] * b[i]
	}
	return s
}

// normalize scales v to unit length in place.
func normalize(v []float32) {
	var sum float64
	for _, x := range v {
		sum += float64(x) * float64(x)
	}
	if sum == 0 {
		return
	}
	inv := float32(1 / math.Sqrt(sum))
	for i := range v {
		v[i] *= inv
	}
}
