package postmanstore

import (
	"encoding/binary"
	"fmt"
	"unicode/utf16"
)

// Chromium IndexedDB-over-LevelDB key encoding (content/browser/indexed_db/indexed_db_leveldb_
// coding.cc), reproduced here only as far as this package needs to read records — encoding (not
// decoding) key *ranges* for iteration is delegated to github.com/cions/leveldb-cli/indexeddb's
// Prefix(), which already implements the idb_cmp1 comparer's range-boundary rules; this file only
// builds the prefix bytes Prefix() consumes and decodes what comes back. See P2 plan §2.
const (
	globalMetadataTypeByte = 0

	// Global-metadata type bytes (keyPrefix{0,0,0} + this byte).
	databaseNameTypeByte = 201 // + stringWithLength(origin) + stringWithLength(dbName) -> value: database id

	// Database-metadata type bytes (keyPrefix{dbId,0,0} + this byte).
	objectStoreNamesTypeByte = 200 // + stringWithLength(storeName) -> value: object store id

	// Index ids within keyPrefix{dbId, storeId, indexId}.
	objectStoreDataIndexID = 1
)

// encodeKeyPrefix packs the (databaseId, objectStoreId, indexId) triple Chromium's own
// KeyPrefix::Encode writes: one header byte giving each field's byte width minus one, then the
// three fields as minimal little-endian integers.
func encodeKeyPrefix(databaseID, objectStoreID, indexID int64) []byte {
	dbBytes := minLEBytes(uint64(databaseID))
	storeBytes := minLEBytes(uint64(objectStoreID))
	idxBytes := minLEBytes(uint64(indexID))

	out := make([]byte, 0, 1+len(dbBytes)+len(storeBytes)+len(idxBytes))
	header := byte((len(dbBytes)-1)<<5 | (len(storeBytes)-1)<<2 | (len(idxBytes) - 1))
	out = append(out, header)
	out = append(out, dbBytes...)
	out = append(out, storeBytes...)
	out = append(out, idxBytes...)
	return out
}

// minLEBytes is Chromium's EncodeInt: the fewest little-endian bytes that hold v, at least one.
func minLEBytes(v uint64) []byte {
	var buf [8]byte
	binary.LittleEndian.PutUint64(buf[:], v)
	n := 8
	for n > 1 && buf[n-1] == 0 {
		n--
	}
	return buf[:n]
}

// decodeLEInt is the inverse of minLEBytes/EncodeInt — arbitrary-width little-endian, used for
// every plain integer *value* this package reads (database id, object store id).
func decodeLEInt(b []byte) (int64, error) {
	if len(b) == 0 || len(b) > 8 {
		return 0, fmt.Errorf("postmanstore: invalid integer encoding, %d bytes", len(b))
	}
	var v uint64
	for i, c := range b {
		v |= uint64(c) << (8 * i)
	}
	return int64(v), nil
}

// encodeVarInt/decodeVarInt: base-128, least-significant group first, continuation bit 0x80 — the
// same varint LevelDB's own coding uses throughout (lengths, string byte counts).
func encodeVarInt(v int64) []byte {
	x := uint64(v)
	var out []byte
	for {
		b := byte(x & 0x7f)
		x >>= 7
		if x != 0 {
			out = append(out, b|0x80)
			continue
		}
		out = append(out, b)
		return out
	}
}

func decodeVarInt(b []byte) (int64, []byte, error) {
	var v uint64
	for i := 0; i < len(b) && i < 9; i++ {
		v |= uint64(b[i]&0x7f) << (7 * i)
		if b[i]&0x80 == 0 {
			return int64(v), b[i+1:], nil
		}
	}
	return 0, nil, fmt.Errorf("postmanstore: truncated varint")
}

// encodeStringWithLength/decodeStringWithLength: a varint length in UTF-16 code units, followed
// by that many code units as big-endian uint16s — Chromium's own StringWithLength coding, used
// for both the (origin, database name) global-metadata key and object-store names.
func encodeStringWithLength(s string) []byte {
	units := utf16.Encode([]rune(s))
	out := encodeVarInt(int64(len(units)))
	for _, u := range units {
		out = append(out, byte(u>>8), byte(u))
	}
	return out
}

func decodeStringWithLength(b []byte) (string, []byte, error) {
	n, rest, err := decodeVarInt(b)
	if err != nil {
		return "", nil, err
	}
	byteLen := int(n) * 2
	if byteLen < 0 || byteLen > len(rest) {
		return "", nil, fmt.Errorf("postmanstore: truncated string-with-length")
	}
	units := make([]uint16, n)
	for i := range units {
		units[i] = binary.BigEndian.Uint16(rest[i*2:])
	}
	return string(utf16.Decode(units)), rest[byteLen:], nil
}

// encodeIDBStringKey encodes id as an IndexedDB primary key of type String (type byte 1 +
// stringWithLength) — every store this package reads (collections/folders/requests/environments)
// keys its records by a plain string `id`, per the record shapes in P2 plan §4.
func encodeIDBStringKey(id string) []byte {
	return append([]byte{indexedDBKeyStringTypeByte}, encodeStringWithLength(id)...)
}

const indexedDBKeyStringTypeByte = 1

// decodeIDBStringKey is encodeIDBStringKey's inverse, used to recover a record's own id from its
// LevelDB key when iterating an object store's data range.
func decodeIDBStringKey(b []byte) (string, error) {
	if len(b) == 0 || b[0] != indexedDBKeyStringTypeByte {
		return "", fmt.Errorf("postmanstore: expected a string IndexedDB key, got type byte %v", b)
	}
	s, _, err := decodeStringWithLength(b[1:])
	return s, err
}
