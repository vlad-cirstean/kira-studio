package model

import "fmt"

// P4 D4: model.SavedRequest is what a saved collection request *is* — deliberately field-identical
// to the request half of packages/shared/domain/http.ts's httpRequestTabStateSchema, so the
// renderer can spread it straight into tab state. It is NOT tabs.state_json (the four UI-only
// pane fields stay out — saving them would make scrolling a pane mark a request dirty) and it is
// NOT httpclient.Body (the wire body drops disabled rows, which is the one thing a saved request
// must keep).
//
// Method is a plain string, not a closed enum: Postman's own method list is 15 values plus any
// custom string (F4), and a value this app's builder cannot show is coerced at exactly one
// renderer boundary, not silently rejected at the storage layer.
type SavedRequest struct {
	Method       string           `json:"method"`
	URL          string           `json:"url"`
	Headers      []SavedHeader    `json:"headers"`
	BodyMode     string           `json:"bodyMode"`
	Body         string           `json:"body"` // the `raw` mode's own buffer
	Code         string           `json:"code"` // the `code` mode's own buffer
	CodeLanguage string           `json:"codeLanguage"`
	URLEncoded   []SavedField     `json:"urlEncoded"`
	FormData     []SavedFormField `json:"formData"`
	BinaryFile   *SavedFile       `json:"binaryFile"`
}

// SavedHeader is one header row. `enabled` has no wire counterpart — it exists so the builder can
// keep an unchecked row instead of deleting it, which is the whole point of the checkbox.
type SavedHeader struct {
	Name    string `json:"name"`
	Value   string `json:"value"`
	Enabled bool   `json:"enabled"`
}

// SavedField is one urlencoded row.
type SavedField struct {
	Name    string `json:"name"`
	Value   string `json:"value"`
	Enabled bool   `json:"enabled"`
}

// SavedFormField is one form-data row. Kind == "file" means Path is a local path (never bytes)
// and Value is ignored; FileName/FileSize let the builder render `report.csv (1.2 MB)` with no
// round trip back to disk.
type SavedFormField struct {
	Name        string `json:"name"`
	Kind        string `json:"kind"`
	Value       string `json:"value"`
	Path        string `json:"path"`
	FileName    string `json:"fileName"`
	FileSize    int64  `json:"fileSize"`
	ContentType string `json:"contentType"`
	Enabled     bool   `json:"enabled"`
}

// SavedFile is the binary (Postman `file`) body's one chosen file — path only, never bytes.
type SavedFile struct {
	Path string `json:"path"`
	Name string `json:"name"`
	Size int64  `json:"size"`
}

// savedBodyModes mirrors HTTP_BODY_MODES (packages/shared/domain/http.ts) and
// httpclient.validBodyModes. Kept here rather than imported so this package keeps its
// standard-library-only dependency set (internal/postman imports it, and a cycle through
// httpclient would be gratuitous).
var savedBodyModes = map[string]bool{
	"none": true, "raw": true, "code": true, "urlencoded": true, "formdata": true, "file": true,
}

// savedCodeLanguages mirrors CODE_LANGUAGES (packages/shared/domain/http.ts).
var savedCodeLanguages = map[string]bool{
	"javascript": true, "json": true, "html": true, "xml": true,
}

// Validate checks what SQL cannot. A row failing it is dropped and logged on read
// (repos/saved_queries.go's posture) and refused on write (repos/tabs.go's).
func (r SavedRequest) Validate() error {
	if r.Method == "" {
		return fmt.Errorf("model: saved request: method is required")
	}
	if !savedBodyModes[r.BodyMode] {
		return fmt.Errorf("model: saved request: unrecognised body mode %q", r.BodyMode)
	}
	if !savedCodeLanguages[r.CodeLanguage] {
		return fmt.Errorf("model: saved request: unrecognised code language %q", r.CodeLanguage)
	}
	return nil
}
