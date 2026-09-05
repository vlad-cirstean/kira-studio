// parse.go turns a Postman Collection v2.1 file into a Tree (P4 D3/D10). It is lenient on read
// and strict on write (Postel, and D10): real Postman files fail their own published schema
// routinely — `info` requires `schema`, which hand-written and SDK-generated collections omit;
// `header` requires `value`, which a valueless header row violates — so this never validates
// against the schema, it decodes the members it models and keeps every other byte (D5).
package postman

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// builderMethods is the seven-member vocabulary this app's request builder can show
// (HTTP_METHODS, packages/shared/domain/http.ts). Postman's own list is fifteen plus any custom
// string (F4); a method outside this set is stored verbatim and merely *counted* here — the
// coercion to GET happens at exactly one renderer boundary, and export restores the original from
// origin.
var builderMethods = map[string]bool{
	"GET": true, "POST": true, "PUT": true, "PATCH": true, "DELETE": true,
	"HEAD": true, "OPTIONS": true,
}

// Parse reads one collection. The only two refusals are "not a JSON object with an info block"
// and D10's version gate — everything else degrades and is reported.
func Parse(r io.Reader) (*Tree, error) {
	data, err := io.ReadAll(r)
	if err != nil {
		return nil, fmt.Errorf("postman: read: %w", err)
	}
	var doc map[string]json.RawMessage
	if err := json.Unmarshal(data, &doc); err != nil {
		return nil, fmt.Errorf("postman: not a JSON object: %w", err)
	}
	info := decodeObject(doc["info"])
	if info == nil {
		return nil, fmt.Errorf("postman: not a Postman collection: no info block")
	}
	if err := checkSchemaVersion(info); err != nil {
		return nil, err
	}

	name, _ := decodeString(info["name"])
	if strings.TrimSpace(name) == "" {
		name = "Imported collection"
	}

	// D5's origin capture for the collection itself: everything minus `item` (those become rows)
	// and minus `info.name` (that becomes a column).
	origin := cloneOrigin(doc)
	delete(origin, "item")
	infoOrigin := cloneOrigin(info)
	delete(infoOrigin, "name")
	origin["info"] = mustRaw(infoOrigin)

	tree := &Tree{Name: name, Origin: origin, Report: Report{Warnings: map[string]int{}}}
	// D15: the collection level is promoted, not inert — scripts and auth still count as inert
	// here, but `variable` does not go through countInertMembers at this one level.
	countScriptsAndAuth(doc, &tree.Report)
	tree.Variables = decodeVariables(doc["variable"])
	delete(tree.Origin, "variable")
	if len(tree.Variables) > 0 {
		tree.Report.warnN(WarnVariablesImported, len(tree.Variables))
	}
	walkItems(doc["item"], RootParent, tree)
	return tree, nil
}

// decodeVariables decodes a collection-level `variable[]` array (D15). `key` is the name (F2's
// own decodeScalarString, since Postman's variable.value is untyped); `type == "secret"` marks an
// entry secret, and the original `type` string is preserved per entry so an unrecognised one
// survives export unchanged.
func decodeVariables(raw json.RawMessage) []Variable {
	out := []Variable{}
	for _, entry := range decodeArray(raw) {
		obj := decodeObject(entry)
		if obj == nil {
			continue
		}
		name, ok := decodeScalarString(obj["key"])
		if !ok || name == "" {
			continue
		}
		value, _ := decodeScalarString(obj["value"])
		typ, _ := decodeString(obj["type"])
		description := decodeDescription(obj["description"])
		out = append(out, Variable{Name: name, Value: value, Secret: typ == "secret", Type: typ, Description: description})
	}
	return out
}

// checkSchemaVersion is D10: v2.1 parses, an absent or unrecognised `info.schema` parses anyway
// (refusing a file for a missing advisory URL is the validator mistake D1 declined), and a file
// that explicitly names v2.0.0 or v1 is refused with the version in the message. v2.0's `url` is
// string-only and it has no `options.raw.language` at all, so "supporting" it would mean a second
// translation table that is half-tested by construction.
func checkSchemaVersion(info map[string]json.RawMessage) error {
	schema, _ := decodeString(info["schema"])
	if schema == "" || strings.Contains(schema, "v2.1") {
		return nil
	}
	switch {
	case strings.Contains(schema, "v2.0"):
		return fmt.Errorf("postman: this is a Collection v2.0.0 file; only v2.1 is supported — re-export it from Postman as Collection v2.1")
	case strings.Contains(schema, "v1.0"), strings.Contains(schema, "/v1/"):
		return fmt.Errorf("postman: this is a Collection v1 file; only v2.1 is supported — convert it in Postman first, then export it as Collection v2.1")
	}
	return nil
}

// walkItems is D3: depth-first, in document order, with sort_order the index within this parent's
// own item[] array. The discriminator is structural, not a field (F1) — a folder has an `item`
// member, a request has a `request` member.
func walkItems(raw json.RawMessage, parent int, t *Tree) {
	order := 0
	for _, entry := range decodeArray(raw) {
		obj := decodeObject(entry)
		if obj == nil {
			t.Report.warn(WarnMalformedItem)
			continue
		}
		_, isFolder := obj["item"]
		_, isRequest := obj["request"]
		if !isFolder && !isRequest {
			// Ill-formed both ways round: neither a folder nor a request. Dropping-and-reporting
			// matches repos/saved_queries.go's own posture for a row it cannot classify; refusing
			// the whole file for one malformed item would be hostile.
			t.Report.warn(WarnMalformedItem)
			continue
		}

		origin := cloneOrigin(obj)
		delete(origin, "item")
		name, hasName := decodeString(obj["name"])
		idx := len(t.Items)

		if isFolder {
			// Both members present (ill-formed): `item` wins, and the `request` member survives
			// untouched in origin, so the export re-emits exactly what came in.
			if !hasName || strings.TrimSpace(name) == "" {
				name = "New Folder"
			}
			t.Items = append(t.Items, Item{
				Parent: parent, Kind: KindFolder, Name: name, Order: order, Origin: origin,
			})
			t.Report.Folders++
			countInertMembers(obj, &t.Report)
			walkItems(obj["item"], idx, t)
		} else {
			request := importRequest(obj["request"], &t.Report)
			if !hasName || strings.TrimSpace(name) == "" {
				name = defaultRequestName(request.URL)
			}
			t.Items = append(t.Items, Item{
				Parent: parent, Kind: KindRequest, Name: name, Order: order,
				Request: request, Origin: origin,
			})
			t.Report.Requests++
			countInertMembers(obj, &t.Report)
		}
		order++
	}
}

// countScriptsAndAuth is countInertMembers' shared half, used at every level including the
// document's own — scripts and auth blocks are preserved verbatim and never executed or applied,
// at any level, and the report says so exactly once so nobody believes otherwise.
func countScriptsAndAuth(obj map[string]json.RawMessage, rep *Report) {
	if events := decodeArray(obj["event"]); len(events) > 0 {
		rep.warnN(WarnScriptsInert, len(events))
	}
	if auth := decodeObject(obj["auth"]); auth != nil {
		rep.warn(WarnAuthInert)
	}
}

// countInertMembers is D9's report half for the folder and item levels — variables stay inert at
// these levels (D15 promotes only the collection level, walkItems' own two call sites below).
func countInertMembers(obj map[string]json.RawMessage, rep *Report) {
	countScriptsAndAuth(obj, rep)
	if vars := decodeArray(obj["variable"]); len(vars) > 0 {
		rep.warnN(WarnVariablesInert, len(vars))
	}
}

// defaultRequestName is D3's one place import *adds* a member the file lacked. A nameless item is
// legal (F1) and a nameless row in the tree is worse than a derived one.
func defaultRequestName(url string) string {
	trimmed := strings.TrimSpace(url)
	if trimmed == "" {
		return "Untitled request"
	}
	base := Split(trimmed).Base
	if i := strings.Index(base, "://"); i >= 0 {
		base = base[i+3:]
	}
	if i := strings.Index(base, "/"); i >= 0 && i+1 < len(base) {
		return base[i:]
	}
	return base
}

// importRequest handles F2's first row: `request` is oneOf [object, string], and the schema's own
// note says a string "is assumed to be the request URL and the method is assumed to be 'GET'".
func importRequest(raw json.RawMessage, rep *Report) model.SavedRequest {
	out := model.SavedRequest{Method: "GET", Headers: []model.SavedHeader{}}
	defaultBody().applyTo(&out)

	if url, ok := decodeString(raw); ok {
		out.URL = url
		return out
	}
	obj := decodeObject(raw)
	if obj == nil {
		return out
	}
	if method, ok := decodeString(obj["method"]); ok && method != "" {
		// Stored verbatim, never upper-cased: a custom method is a real shape (F4) and rewriting
		// its spelling would change the bytes an untouched export re-emits.
		out.Method = method
		if !builderMethods[strings.ToUpper(method)] && rep != nil {
			rep.warn(WarnUnsupportedMethod)
		}
	}
	out.URL = ImportURL(obj["url"])
	out.Headers = importHeaders(obj["header"])
	importBody(obj["body"], rep).applyTo(&out)
	return out
}

// importHeaders handles F2's second row: `header` is oneOf [header-list, string], and the string
// form is a raw "A: 1\nB: 2" block.
func importHeaders(raw json.RawMessage) []model.SavedHeader {
	out := []model.SavedHeader{}
	if block, ok := decodeString(raw); ok {
		for _, line := range strings.Split(block, "\n") {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			name, value, found := strings.Cut(line, ":")
			if !found {
				continue
			}
			out = append(out, model.SavedHeader{
				Name: strings.TrimSpace(name), Value: strings.TrimSpace(value), Enabled: true,
			})
		}
		return out
	}
	for _, entry := range decodeArray(raw) {
		row := decodeObject(entry)
		if row == nil {
			continue
		}
		name, _ := decodeScalarString(row["key"])
		// `value` is required by the schema and routinely absent in real files (D10's own
		// example) — a valueless header row imports as an empty value, not a dropped row.
		value, _ := decodeScalarString(row["value"])
		disabled, _ := decodeBool(row["disabled"])
		out = append(out, model.SavedHeader{Name: name, Value: value, Enabled: !disabled})
	}
	return out
}
