// Package i18n reads the shared message catalog (en.json) for Go-originated user text.
package i18n

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
)

//go:embed en.json
var catalogJSON []byte

var (
	loadOnce sync.Once
	messages map[string]string
)

func load() {
	var tree map[string]any
	if err := json.Unmarshal(catalogJSON, &tree); err != nil {
		panic(fmt.Sprintf("i18n: parse en.json: %v", err))
	}
	messages = make(map[string]string)
	flatten("", tree, messages)
}

func flatten(prefix string, node map[string]any, out map[string]string) {
	for k, v := range node {
		path := k
		if prefix != "" {
			path = prefix + "." + k
		}
		switch val := v.(type) {
		case string:
			out[path] = val
		case map[string]any:
			flatten(path, val, out)
		default:
			panic(fmt.Sprintf("i18n: %s is neither string nor object", path))
		}
	}
}

// T returns the message for key with each {name} replaced from args. It panics on an unknown key.
func T(key string, args map[string]string) string {
	loadOnce.Do(load)
	msg, ok := messages[key]
	if !ok {
		panic("i18n: unknown key " + key)
	}
	if len(args) == 0 {
		return msg
	}
	pairs := make([]string, 0, len(args)*2)
	for name, value := range args {
		pairs = append(pairs, "{"+name+"}", value)
	}
	return strings.NewReplacer(pairs...).Replace(msg)
}

// keys returns every catalog key. Test seam.
func keys() map[string]string {
	loadOnce.Do(load)
	return messages
}
