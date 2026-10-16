package importer

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"
)

// ChunkJSON splits a JSON document at element boundaries. Units are the top-level array's elements or
// the top-level object's members; one over Budget.Max splits into its children, an over-size string
// into text chunks. Elements stay raw bytes (key order and number spelling survive) and render with
// two-space indent. HeadingPath is the JSON path of the chunk's first unit. Invalid JSON is an error
// naming the byte, never a silent text fallback.
func ChunkJSON(src string, b Budget) ([]Chunk, error) {
	var top json.RawMessage
	if err := json.Unmarshal([]byte(src), &top); err != nil {
		return nil, invalidJSON(err)
	}
	var units []unit
	var err error
	switch firstByte(top) {
	case '[':
		var elems []json.RawMessage
		if elems, err = arrayElements(top); err == nil {
			for i, el := range elems {
				units = append(units, jsonUnits(fmt.Sprintf("$[%d]", i), nil, el, b)...)
			}
		}
	case '{':
		var members []jsonMember
		if members, err = objectMembers(top); err == nil {
			for _, m := range members {
				units = append(units, jsonUnits("$"+keyPath(m.key), &m.key, m.val, b)...)
			}
		}
	default:
		units = jsonUnits("$", nil, top, b)
	}
	if err != nil {
		return nil, invalidJSON(err)
	}
	return pack(units, b), nil
}

// ChunkJSONLines splits JSON Lines: one unit per non-blank line, an over-size line into its children.
// A line that is not JSON is an error naming it.
func ChunkJSONLines(src string, b Budget) ([]Chunk, error) {
	var units []unit
	for i, line := range strings.Split(src, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if !json.Valid([]byte(line)) {
			return nil, fmt.Errorf("Invalid JSON on line %d", i+1)
		}
		units = append(units, jsonUnits(fmt.Sprintf("line %d", i+1), nil, json.RawMessage(line), b)...)
	}
	return pack(units, b), nil
}

func invalidJSON(err error) error {
	var syn *json.SyntaxError
	if errors.As(err, &syn) {
		return fmt.Errorf("Invalid JSON at byte %d: %v", syn.Offset, err)
	}
	return fmt.Errorf("Invalid JSON: %v", err)
}

func firstByte(raw json.RawMessage) byte {
	t := bytes.TrimSpace(raw)
	if len(t) == 0 {
		return 0
	}
	return t[0]
}

type jsonMember struct {
	key string
	val json.RawMessage
}

func arrayElements(raw json.RawMessage) ([]json.RawMessage, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	if _, err := dec.Token(); err != nil {
		return nil, err
	}
	var out []json.RawMessage
	for dec.More() {
		var el json.RawMessage
		if err := dec.Decode(&el); err != nil {
			return nil, err
		}
		out = append(out, el)
	}
	return out, nil
}

func objectMembers(raw json.RawMessage) ([]jsonMember, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	if _, err := dec.Token(); err != nil {
		return nil, err
	}
	var out []jsonMember
	for dec.More() {
		keyTok, err := dec.Token()
		if err != nil {
			return nil, err
		}
		key, _ := keyTok.(string)
		var val json.RawMessage
		if err := dec.Decode(&val); err != nil && !errors.Is(err, io.EOF) {
			return nil, err
		}
		out = append(out, jsonMember{key: key, val: val})
	}
	return out, nil
}

var plainKey = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// keyPath is a key as a path segment: ".name" for identifier-like keys, else ["name"].
func keyPath(key string) string {
	if plainKey.MatchString(key) {
		return "." + key
	}
	q, _ := json.Marshal(key)
	return "[" + string(q) + "]"
}

// jsonUnits renders one value as a unit, or splits it when it exceeds the budget. key, when non-nil,
// is printed before the value (`"key": value`).
func jsonUnits(path string, key *string, raw json.RawMessage, b Budget) []unit {
	text := renderJSON(key, raw)
	if tokens := EstimateTokens(text); tokens <= b.Max {
		return []unit{{text: text, tokens: tokens, path: path}}
	}
	switch firstByte(raw) {
	case '[':
		elems, err := arrayElements(raw)
		if err != nil {
			break
		}
		var out []unit
		for i, el := range elems {
			out = append(out, jsonUnits(fmt.Sprintf("%s[%d]", path, i), nil, el, b)...)
		}
		return out
	case '{':
		members, err := objectMembers(raw)
		if err != nil {
			break
		}
		var out []unit
		for _, m := range members {
			out = append(out, jsonUnits(path+keyPath(m.key), &m.key, m.val, b)...)
		}
		return out
	case '"':
		var s string
		if json.Unmarshal(raw, &s) != nil {
			break
		}
		var out []unit
		for _, c := range ChunkText(s, b) {
			t := c.Text + "\n"
			out = append(out, unit{text: t, tokens: EstimateTokens(t), path: path})
		}
		if len(out) > 0 {
			return out
		}
	}
	return []unit{{text: text, tokens: EstimateTokens(text), path: path}}
}

// renderJSON indents raw with two spaces and ends it with a newline, prefixed by `"key": `.
func renderJSON(key *string, raw json.RawMessage) string {
	var buf bytes.Buffer
	if err := json.Indent(&buf, raw, "", "  "); err != nil {
		buf.Reset()
		buf.Write(raw)
	}
	if key == nil {
		return buf.String() + "\n"
	}
	q, _ := json.Marshal(*key)
	return string(q) + ": " + buf.String() + "\n"
}
