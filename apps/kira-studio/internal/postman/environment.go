package postman

import (
	"encoding/json"
	"errors"
	"io"
	"strings"
)

// Environment is one Postman environment export: a flat name plus its values.
type Environment struct {
	Name      string
	Variables []Variable
	// Disabled counts values skipped because Postman marks them `enabled: false`.
	Disabled int
	// Empty counts imported values that are "": Postman exports only shared values.
	Empty int
}

// File is what ParseFile found: exactly one of Collection and Environment is set.
type File struct {
	Collection  *Tree
	Environment *Environment
}

// ParseFile classifies one export by shape and parses it. A collection has an `info` block, an
// environment a `values` array. A globals export is refused: the app has no globals scope.
func ParseFile(r io.Reader) (*File, error) {
	doc, err := readDocument(r)
	if err != nil {
		return nil, err
	}
	if _, ok := doc["info"]; ok {
		tree, err := parseCollection(doc)
		if err != nil {
			return nil, err
		}
		return &File{Collection: tree}, nil
	}
	scope, _ := decodeString(doc["_postman_variable_scope"])
	if scope == "globals" {
		return nil, errors.New("postman: a globals export is not supported; export an environment instead")
	}
	if raw := doc["values"]; len(raw) > 0 && raw[0] == '[' {
		return &File{Environment: parseEnvironment(doc)}, nil
	}
	return nil, errors.New("postman: not a Postman collection or environment")
}

func parseEnvironment(doc map[string]json.RawMessage) *Environment {
	name, _ := decodeString(doc["name"])
	if strings.TrimSpace(name) == "" {
		name = "Imported environment"
	}
	env := &Environment{Name: name, Variables: []Variable{}}
	for _, entry := range decodeArray(doc["values"]) {
		obj := decodeObject(entry)
		if obj == nil {
			continue
		}
		v, ok, off := decodeVariableEntry(obj)
		switch {
		case !ok:
		case off:
			env.Disabled++
		default:
			if v.Value == "" {
				env.Empty++
			}
			env.Variables = append(env.Variables, v)
		}
	}
	return env
}
