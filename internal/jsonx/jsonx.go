// Package jsonx holds small encoding/json extensions shared by both apps and their adapters.
package jsonx

import (
	"bytes"
	"encoding/json"
)

// Pair is one name/value entry of an ordered JSON object.
type Pair struct {
	Name  string
	Value any
}

// MarshalOrderedObject marshals pairs as a JSON object in their given order. encoding/json's own
// map-based Marshal sorts keys alphabetically, which loses a wire-ordered value's own order —
// Kira Studio's own model.RowValues and the redis adapter's own streamFields both exist to
// preserve one (P107 I2-35).
func MarshalOrderedObject(pairs []Pair) ([]byte, error) {
	var buf bytes.Buffer
	buf.WriteByte('{')
	for i, p := range pairs {
		if i > 0 {
			buf.WriteByte(',')
		}
		key, err := json.Marshal(p.Name)
		if err != nil {
			return nil, err
		}
		buf.Write(key)
		buf.WriteByte(':')
		val, err := json.Marshal(p.Value)
		if err != nil {
			return nil, err
		}
		buf.Write(val)
	}
	buf.WriteByte('}')
	return buf.Bytes(), nil
}
